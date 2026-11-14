-- tests-secure.sql
-- Locks the test tables. Before this, anyone with the public app key could
-- read every test's correct answers, change their own score, and read or
-- delete other students' submissions.
--
-- After this:
--  * Only lecturers can read or change tests, test links and submissions.
--  * Students get the open test through get_active_test() / get_test_link(),
--    which never include the correct answers or the marking guide.
--  * Students submit through submit_test(), which marks the paper on the
--    server, allows one attempt per phone and per matric number, and ignores
--    any score or theory mark sent from the phone.
-- Safe to run more than once. Run after security-fixes.sql (needs is_lecturer()).

alter table public.test_submissions add column if not exists device_id text;
alter table public.test_submissions add column if not exists integrity jsonb;
alter table public.test_submissions add column if not exists theory jsonb;

-- 1. Lecturers only on the tables ------------------------------------------
alter table public.test_configs     enable row level security;
alter table public.test_submissions enable row level security;
alter table public.test_links       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['test_configs','test_submissions','test_links'] loop
    execute format('drop policy if exists lecturer_all on public.%I', t);
    execute format('create policy lecturer_all on public.%I for all to authenticated using (public.is_lecturer()) with check (public.is_lecturer())', t);
  end loop;
end $$;

-- Dashboard look and feel: anyone may read it, only lecturers may change it
do $$
begin
  if to_regclass('public.dashboard_preferences') is not null then
    alter table public.dashboard_preferences enable row level security;
    drop policy if exists prefs_read on public.dashboard_preferences;
    drop policy if exists prefs_write on public.dashboard_preferences;
    create policy prefs_read on public.dashboard_preferences for select to anon, authenticated using (true);
    create policy prefs_write on public.dashboard_preferences for all to authenticated using (public.is_lecturer()) with check (public.is_lecturer());
  end if;
end $$;

-- 2. Questions without answers ------------------------------------------------
create or replace function public._student_questions(q jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(e.value - 'correctIndex' - 'modelAnswer' order by e.ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(q, '[]'::jsonb)) with ordinality as e(value, ord)
$$;

create or replace function public._student_test(t public.test_configs)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'title', t.title, 'course_code', t.course_code,
    'duration_minutes', t.duration_minutes, 'is_active', t.is_active,
    'created_at', t.created_at, 'test_type', t.test_type,
    'questions', public._student_questions(t.questions))
$$;

create or replace function public.get_active_test()
returns jsonb language sql stable security definer set search_path = public as $$
  select public._student_test(t) from public.test_configs t
  where t.is_active order by t.created_at desc limit 1
$$;

-- A test link: only while it is switched on and not expired
create or replace function public.get_test_link(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'link', jsonb_build_object('id', l.id, 'test_id', l.test_id, 'course_code', l.course_code,
      'title', l.title, 'token', l.token, 'is_active', l.is_active,
      'created_at', l.created_at, 'expires_at', l.expires_at),
    'test', public._student_test(t))
  from public.test_links l join public.test_configs t on t.id = l.test_id
  where l.token = p_token and l.is_active and (l.expires_at is null or l.expires_at > now())
  limit 1
$$;

-- 3. Has this phone already taken the test? (its own result only) -------------
create or replace function public.test_taken(p_test_id text, p_device_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'test_id', s.test_id, 'student_name', s.student_name,
    'matric_number', s.matric_number, 'level', s.level, 'score', s.score, 'total', s.total,
    'submitted_at', s.submitted_at, 'cheated', s.cheated, 'test_type', s.test_type,
    'device_id', s.device_id, 'answers', '[]'::jsonb)
  from public.test_submissions s
  where s.test_id = p_test_id and p_device_id is not null and length(p_device_id) >= 8
    and s.device_id = p_device_id
  limit 1
$$;

-- 4. Submit: marked on the server --------------------------------------------
create or replace function public.submit_test(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_test   public.test_configs;
  v_q      jsonb;
  v_ans    jsonb := coalesce(p->'answers', '[]'::jsonb);
  v_name   text := left(trim(coalesce(p->>'student_name', '')), 120);
  v_matric text := left(trim(coalesce(p->>'matric_number', '')), 40);
  v_device text := left(coalesce(p->>'device_id', ''), 100);
  v_score  int := 0;
  v_total  int := 0;
  v_correct jsonb := '[]'::jsonb;
  v_theory jsonb := '{}'::jsonb;
  v_t      jsonb;
  v_int    jsonb;
  v_id     text;
  i        int;
  a        text;
begin
  select * into v_test from public.test_configs where id = p->>'test_id';
  if not found then raise exception 'test_not_found'; end if;

  if not (v_test.is_active or exists (
      select 1 from public.test_links l where l.test_id = v_test.id and l.is_active
        and (l.expires_at is null or l.expires_at > now()))) then
    raise exception 'test_closed';
  end if;
  if length(v_name) < 2 or length(v_matric) < 3 then raise exception 'details_missing'; end if;

  if exists (select 1 from public.test_submissions s where s.test_id = v_test.id
             and ((length(v_device) >= 8 and s.device_id = v_device) or lower(s.matric_number) = lower(v_matric))) then
    raise exception 'already_taken';
  end if;

  for i in 0 .. coalesce(jsonb_array_length(v_test.questions), 0) - 1 loop
    v_q := v_test.questions -> i;
    if coalesce(v_q->>'kind', 'objective') = 'theory' then
      v_total := v_total + greatest(1, coalesce((v_q->>'marks')::int, 5));
      v_correct := v_correct || 'null'::jsonb;
      v_t := p->'theory'->(i::text);
      if v_t is not null and jsonb_typeof(v_t) = 'object' then
        -- keep only what the phone measured; never a mark sent from the phone
        v_theory := v_theory || jsonb_build_object(i::text, jsonb_build_object(
          'text', left(coalesce(v_t->>'text', ''), 12000),
          'typingMs', greatest(0, least(coalesce((v_t->>'typingMs')::bigint, 0), 100000000)),
          'keystrokes', greatest(0, least(coalesce((v_t->>'keystrokes')::int, 0), 1000000)),
          'bigInserts', greatest(0, least(coalesce((v_t->>'bigInserts')::int, 0), 10000)),
          'pasteAttempts', greatest(0, least(coalesce((v_t->>'pasteAttempts')::int, 0), 10000))));
      end if;
    else
      v_total := v_total + 1;
      v_correct := v_correct || to_jsonb((v_q->>'correctIndex')::int);
      a := v_ans ->> i;
      if a ~ '^[0-3]$' and a::int = (v_q->>'correctIndex')::int then v_score := v_score + 1; end if;
    end if;
  end loop;

  v_int := p->'integrity';
  if v_int is not null and jsonb_typeof(v_int) = 'object' then
    v_int := jsonb_build_object(
      'focusLost', greatest(0, least(coalesce((v_int->>'focusLost')::int, 0), 10000)),
      'splitScreen', greatest(0, least(coalesce((v_int->>'splitScreen')::int, 0), 10000)),
      'copyAttempts', greatest(0, least(coalesce((v_int->>'copyAttempts')::int, 0), 10000)));
  else
    v_int := null;
  end if;

  v_id := 'tsub-' || md5(random()::text || clock_timestamp()::text);
  insert into public.test_submissions (id, test_id, student_name, matric_number, level, answers,
    score, total, submitted_at, cheated, test_type, device_id, integrity, theory)
  values (v_id, v_test.id, v_name, v_matric, left(coalesce(p->>'level', ''), 10),
    case when jsonb_typeof(v_ans) = 'array' then v_ans else '[]'::jsonb end,
    v_score, v_total, now(), coalesce((p->>'cheated')::boolean, false), v_test.test_type,
    nullif(v_device, ''), v_int, case when v_theory = '{}'::jsonb then null else v_theory end);

  return jsonb_build_object('id', v_id, 'test_id', v_test.id, 'student_name', v_name,
    'matric_number', v_matric, 'level', left(coalesce(p->>'level', ''), 10), 'answers', v_ans,
    'score', v_score, 'total', v_total, 'submitted_at', now(),
    'cheated', coalesce((p->>'cheated')::boolean, false), 'test_type', v_test.test_type,
    'device_id', nullif(v_device, ''), 'integrity', v_int,
    'theory', case when v_theory = '{}'::jsonb then null else v_theory end,
    'correct', v_correct);
end $$;

revoke all on function public._student_questions(jsonb) from public;
revoke all on function public._student_test(public.test_configs) from public;
revoke all on function public.get_active_test() from public;
revoke all on function public.get_test_link(text) from public;
revoke all on function public.test_taken(text, text) from public;
revoke all on function public.submit_test(jsonb) from public;
grant execute on function public.get_active_test() to anon, authenticated;
grant execute on function public.get_test_link(text) to anon, authenticated;
grant execute on function public.test_taken(text, text) to anon, authenticated;
grant execute on function public.submit_test(jsonb) to anon, authenticated;

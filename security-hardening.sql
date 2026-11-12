-- ============================================================
-- Attendly — Security hardening
-- Run this whole file in: Supabase Dashboard → SQL Editor.
-- Safe to run more than once.
--
-- What it does
--  1. Students can no longer read, change or delete attendance directly.
--     They can only check in through submit_attendance(), which re-does
--     every check on the server (link open, room code, distance from the
--     lecturer, GPS accuracy, one phone / one matric per day, rate limit).
--  2. Only signed-in lecturers (Supabase Auth) can read records or manage
--     links and settings.
--  3. Each attendance link gets a secret; the projector room code is derived
--     from it every 30 s and is never sent to students.
--
-- Before students use the app again, create a lecturer account in
-- Authentication → Users → "Add user" (email + password).
-- ============================================================

create extension if not exists pgcrypto with schema extensions;
set search_path = public, extensions;

-- ── Lecturer-location columns (same as lecturer-location-migration.sql) ─────
alter table attendance_links add column if not exists anchor_lat double precision;
alter table attendance_links add column if not exists anchor_lng double precision;
alter table attendance_links add column if not exists anchor_accuracy double precision;
alter table attendance_links add column if not exists anchor_radius integer;
alter table attendance_links add column if not exists anchor_at timestamptz;

-- ── Per-link secret for the rotating room code ──────────────────────────────
create table if not exists attendance_link_secrets (
  link_id     text primary key references attendance_links(id) on delete cascade,
  code_secret text not null,
  created_at  timestamptz not null default now()
);
alter table attendance_link_secrets enable row level security;
-- No policies on purpose: nobody can read it through the API. Only the
-- SECURITY DEFINER functions below can.

create or replace function attendance_links_make_secret()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into attendance_link_secrets (link_id, code_secret)
  values (new.id, encode(gen_random_bytes(32), 'hex'))
  on conflict (link_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_attendance_links_secret on attendance_links;
create trigger trg_attendance_links_secret
  after insert on attendance_links
  for each row execute function attendance_links_make_secret();

-- Backfill secrets for links that already exist
insert into attendance_link_secrets (link_id, code_secret)
select id, encode(gen_random_bytes(32), 'hex') from attendance_links
on conflict (link_id) do nothing;

-- ── Failed-attempt log (rate limiting + lecturer review) ────────────────────
create table if not exists attendance_attempts (
  id         bigserial primary key,
  link_id    text,
  device_id  text,
  matric     text,
  reason     text not null,
  detail     text,
  lat        double precision,
  lng        double precision,
  accuracy   double precision,
  at         timestamptz not null default now()
);
create index if not exists idx_attempts_device_time on attendance_attempts (device_id, at desc);
create index if not exists idx_attempts_link_time   on attendance_attempts (link_id, at desc);
alter table attendance_attempts enable row level security;
drop policy if exists "lecturers read attempts" on attendance_attempts;
create policy "lecturers read attempts" on attendance_attempts
  for select to authenticated using (true);

-- ── Row level security ──────────────────────────────────────────────────────
alter table attendance_records enable row level security;
alter table attendance_links   enable row level security;
alter table admin_settings     enable row level security;
alter table attendance_sessions enable row level security;

-- attendance_records: lecturers only. Students insert via submit_attendance().
drop policy if exists "lecturers manage records" on attendance_records;
create policy "lecturers manage records" on attendance_records
  for all to authenticated using (true) with check (true);

-- attendance_links: anyone may read (students open links by token);
-- only lecturers may create / change / delete.
drop policy if exists "anyone reads links" on attendance_links;
create policy "anyone reads links" on attendance_links
  for select to anon, authenticated using (true);
drop policy if exists "lecturers manage links" on attendance_links;
create policy "lecturers manage links" on attendance_links
  for all to authenticated using (true) with check (true);

-- admin_settings and sessions: lecturers only.
drop policy if exists "lecturers manage settings" on admin_settings;
create policy "lecturers manage settings" on admin_settings
  for all to authenticated using (true) with check (true);
drop policy if exists "lecturers manage sessions" on attendance_sessions;
create policy "lecturers manage sessions" on attendance_sessions
  for all to authenticated using (true) with check (true);

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function haversine_m(lat1 double precision, lng1 double precision,
                                       lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- Room code for a given secret and 30-second slot. 4 characters from an
-- alphabet without O/I/0/1 so it is easy to read on a projector.
create or replace function room_code_for(secret text, slot bigint)
returns text language plpgsql immutable set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  mac bytea := hmac(slot::text, secret, 'sha256');
  out text := '';
  i int;
begin
  for i in 0..3 loop
    out := out || substr(alphabet, (get_byte(mac, i) % 32) + 1, 1);
  end loop;
  return out;
end $$;

create or replace function room_code_slot(at timestamptz default now())
returns bigint language sql immutable as $$
  select floor(extract(epoch from at) / 30)::bigint;
$$;

-- ── Lecturer: current room code for a link (needs a signed-in lecturer) ─────
create or replace function get_room_code(p_link_id text)
returns table (code text, seconds_left int, slot bigint)
language plpgsql security definer set search_path = public as $$
declare
  s text;
  cur bigint := room_code_slot();
begin
  if auth.uid() is null then
    raise exception 'not_authorised';
  end if;
  select code_secret into s from attendance_link_secrets where link_id = p_link_id;
  if s is null then
    raise exception 'not_found';
  end if;
  return query select room_code_for(s, cur),
                      (30 - (floor(extract(epoch from now()))::bigint % 30))::int,
                      cur;
end $$;
revoke all on function get_room_code(text) from public;
grant execute on function get_room_code(text) to authenticated;

-- ── Student: check in (all checks happen here) ──────────────────────────────
-- Raises an exception whose message is a code the app understands:
--   not_found | closed | locked | wrong_code | weak_gps:<m> | no_gps
--   out_of_range:<m>:<radius> | duplicate_device | duplicate_matric | invalid
create or replace function submit_attendance(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l          attendance_links%rowtype;
  s          text;
  v_token    text := p->>'token';
  v_device   text := left(coalesce(p->>'deviceId', ''), 80);
  v_matric   text := upper(trim(coalesce(p->>'matricNumber', '')));
  v_code     text := upper(trim(coalesce(p->>'roomCode', '')));
  v_lat      double precision := (p->>'lat')::double precision;
  v_lng      double precision := (p->>'lng')::double precision;
  v_acc      double precision := (p->>'accuracy')::double precision;
  v_day      text := to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM-DD');
  v_slot     bigint := room_code_slot();
  v_fail     int;
  v_dist     double precision := 0;
  v_radius   int;
  v_tol      double precision;
  v_anchor_lat double precision;
  v_anchor_lng double precision;
  v_anchor_acc double precision;
  v_settings jsonb;
  v_id       text := coalesce(p->>'id', gen_random_uuid()::text);
  v_class_code text;
  v_custom   jsonb := coalesce(p->'customFields', '{}'::jsonb);
begin
  -- Basic input checks
  if v_token is null or v_device = '' or v_matric = '' or coalesce(p->>'fullName','') = '' then
    raise exception 'invalid';
  end if;

  -- Rate limit: 5 failed attempts per phone in 5 minutes → locked
  select count(*) into v_fail from attendance_attempts
   where device_id = v_device and at > now() - interval '5 minutes';
  if v_fail >= 5 then
    raise exception 'locked';
  end if;

  select * into l from attendance_links where token = v_token;
  if l.id is null or coalesce(l.link_type, 'attendance') <> 'attendance' then
    raise exception 'not_found';
  end if;

  if not l.is_active or l.expires_at <= now() then
    insert into attendance_attempts (link_id, device_id, matric, reason) values (l.id, v_device, v_matric, 'closed');
    raise exception 'closed';
  end if;

  -- Room code: current slot or the previous one (students typing at the change-over)
  select code_secret into s from attendance_link_secrets where link_id = l.id;
  if s is null or v_code not in (room_code_for(s, v_slot), room_code_for(s, v_slot - 1)) then
    insert into attendance_attempts (link_id, device_id, matric, reason, detail, lat, lng, accuracy)
      values (l.id, v_device, v_matric, 'wrong_code', v_code, v_lat, v_lng, v_acc);
    raise exception 'wrong_code';
  end if;

  -- Location: the lecturer's verified spot on this link, else the class pin in settings
  v_anchor_lat := l.anchor_lat; v_anchor_lng := l.anchor_lng; v_anchor_acc := l.anchor_accuracy;
  v_radius := coalesce(l.anchor_radius, 100);
  if v_anchor_lat is null then
    select data into v_settings from admin_settings where id = 'default';
    v_anchor_lat := (v_settings->>'classLat')::double precision;
    v_anchor_lng := (v_settings->>'classLng')::double precision;
    v_anchor_acc := 0;
    v_radius := coalesce((v_settings->>'radiusMeters')::int, 100);
  end if;

  if v_anchor_lat is not null then
    if v_lat is null or v_lng is null then
      insert into attendance_attempts (link_id, device_id, matric, reason) values (l.id, v_device, v_matric, 'no_gps');
      raise exception 'no_gps';
    end if;
    if v_acc is null or v_acc > 150 then
      insert into attendance_attempts (link_id, device_id, matric, reason, detail, lat, lng, accuracy)
        values (l.id, v_device, v_matric, 'weak_gps', v_acc::text, v_lat, v_lng, v_acc);
      raise exception 'weak_gps:%', coalesce(round(v_acc)::text, '0');
    end if;
    v_dist := haversine_m(v_lat, v_lng, v_anchor_lat, v_anchor_lng);
    v_tol  := least(v_acc, 75) + least(coalesce(v_anchor_acc, 0), 50);
    if v_dist - v_tol > v_radius then
      insert into attendance_attempts (link_id, device_id, matric, reason, detail, lat, lng, accuracy)
        values (l.id, v_device, v_matric, 'out_of_range', round(v_dist)::text, v_lat, v_lng, v_acc);
      raise exception 'out_of_range:%:%', round(v_dist)::int, v_radius;
    end if;
  end if;

  -- One phone and one matric per course per day
  if exists (select 1 from attendance_records
              where device_id = v_device and course_code = l.course_code and day_key = v_day) then
    raise exception 'duplicate_device';
  end if;
  if exists (select 1 from attendance_records
              where upper(matric_number) = v_matric and course_code = l.course_code and day_key = v_day) then
    raise exception 'duplicate_matric';
  end if;

  -- Personal class code (reuse the student's existing one if they have it)
  if l.assign_class_code then
    select assigned_class_code into v_class_code from attendance_records
     where upper(matric_number) = v_matric and assigned_class_code is not null
     order by submitted_at desc limit 1;
    if v_class_code is null then
      select data into v_settings from admin_settings where id = 'default';
      loop
        v_class_code := coalesce(nullif(v_settings->>'classCode', ''), l.course_code) || '-' ||
                        lpad((floor(random() * 10000))::int::text, 4, '0');
        exit when not exists (select 1 from attendance_records where assigned_class_code = v_class_code);
      end loop;
    end if;
  end if;

  v_custom := v_custom || jsonb_build_object(
    'gpsAccuracy', v_acc, 'roomCodeOk', true, 'serverChecked', true,
    'checkedAt', now());

  insert into attendance_records (
    id, full_name, matric_number, department, phone, course_code, topic, level, gender,
    submitted_at, day_key, device_id, distance_meters, lat, lng, session_id,
    custom_fields, assigned_class_code, link_id)
  values (
    v_id, left(p->>'fullName', 120), v_matric, left(coalesce(p->>'department',''), 120),
    left(coalesce(p->>'phone',''), 30), l.course_code, left(coalesce(p->>'topic',''), 200),
    left(coalesce(p->>'level',''), 10), left(coalesce(p->>'gender','other'), 10),
    now(), v_day, v_device, round(v_dist), v_lat, v_lng, coalesce(p->>'sessionId',''),
    v_custom, v_class_code, l.id);

  return jsonb_build_object('id', v_id, 'distance', round(v_dist), 'classCode', v_class_code,
                            'dayKey', v_day, 'submittedAt', now());
end $$;
revoke all on function submit_attendance(jsonb) from public;
grant execute on function submit_attendance(jsonb) to anon, authenticated;

-- ── Student: has this phone already checked in today? ───────────────────────
create or replace function device_checked_in_today(p_device text, p_course text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from attendance_records
                  where device_id = p_device and course_code = p_course
                    and day_key = to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM-DD'));
$$;
grant execute on function device_checked_in_today(text, text) to anon, authenticated;

-- ── Student: look up own class code (home page "Get code") ──────────────────
create or replace function lookup_student(p_matric text)
returns table (full_name text, level text, matric_number text, assigned_class_code text)
language sql security definer set search_path = public as $$
  select full_name, level, matric_number, assigned_class_code
    from attendance_records
   where upper(matric_number) = upper(trim(p_matric))
   order by submitted_at desc limit 1;
$$;
grant execute on function lookup_student(text) to anon, authenticated;

-- ── Student: flag a wrong class-code attempt ────────────────────────────────
create or replace function flag_code_fraud(p_matric text, p_entered text)
returns void language sql security definer set search_path = public as $$
  update attendance_records
     set custom_fields = coalesce(custom_fields, '{}'::jsonb)
                         || jsonb_build_object('code_fraud', true, 'fraud_code_entered', left(p_entered, 40))
   where upper(matric_number) = upper(trim(p_matric));
$$;
grant execute on function flag_code_fraud(text, text) to anon, authenticated;

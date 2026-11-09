-- ============================================================
-- Attendly — Security fixes (run AFTER security-hardening.sql and
-- students-migration.sql). Safe to run more than once.
--
-- Fixes found by attacking a copy of the database:
--  1. Any self-signed-up Supabase account was treated as a lecturer
--     (could insert attendance, read the class code, move the lecturer's
--     location, create links). Now only users in the `lecturers` table are.
--  2. Check-ins that should be flagged (not registered, face mismatch,
--     different phone) crashed with "malformed array literal".
--  3. Links without a verified lecturer location skipped the location
--     check entirely. Now they are refused.
--  4. Students could read every link's token and the lecturer's exact GPS
--     position, and any registered student's phone number.
--  5. Failed attempts were never saved (the rejection rolled the log row
--     back), so the 5-failed-attempts lock and the "blocked attempts" list
--     never worked. Refusals are now returned as {"error": ...} so the log is
--     kept, and the lock also counts per matric number and per IP address.
--  6. A student could pre-mark their own flagged check-in as "approved".
--  7. NaN / out-of-range coordinates produced a confusing error.
--
-- AFTER RUNNING: also turn off public sign-ups in Supabase →
-- Authentication → Sign In / Providers → "Allow new users to sign up" (off).
-- ============================================================

-- ── 1. Lecturers allow-list ─────────────────────────────────────────────────
create table if not exists lecturers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table lecturers enable row level security;
drop policy if exists "lecturers read lecturers" on lecturers;

create or replace function is_lecturer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from lecturers where user_id = auth.uid());
$$;
revoke all on function is_lecturer() from public;
grant execute on function is_lecturer() to anon, authenticated;

create policy "lecturers read lecturers" on lecturers
  for select to authenticated using (is_lecturer());

-- The admin account created earlier. To add another lecturer later:
--   insert into lecturers (user_id) select id from auth.users where email = 'their@email.com';
insert into lecturers (user_id)
select id from auth.users where lower(email) = 'attendly@gmail.com'
on conflict do nothing;

-- Replace every "any signed-in user" rule with "lecturers only"
drop policy if exists "lecturers manage records"  on attendance_records;
create policy "lecturers manage records" on attendance_records
  for all to authenticated using (is_lecturer()) with check (is_lecturer());

drop policy if exists "anyone reads links"     on attendance_links;
drop policy if exists "lecturers manage links" on attendance_links;
create policy "lecturers manage links" on attendance_links
  for all to authenticated using (is_lecturer()) with check (is_lecturer());

drop policy if exists "lecturers manage settings" on admin_settings;
create policy "lecturers manage settings" on admin_settings
  for all to authenticated using (is_lecturer()) with check (is_lecturer());

drop policy if exists "lecturers manage sessions" on attendance_sessions;
create policy "lecturers manage sessions" on attendance_sessions
  for all to authenticated using (is_lecturer()) with check (is_lecturer());

drop policy if exists "lecturers read attempts" on attendance_attempts;
create policy "lecturers read attempts" on attendance_attempts
  for select to authenticated using (is_lecturer());

drop policy if exists "lecturers manage students" on students;
create policy "lecturers manage students" on students
  for all to authenticated using (is_lecturer()) with check (is_lecturer());

-- Class code: lecturers only
create or replace function get_room_code(p_link_id text)
returns table (code text, seconds_left int, slot bigint)
language plpgsql security definer set search_path = public as $$
declare
  s text;
  cur bigint := room_code_slot();
begin
  if not is_lecturer() then
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

-- ── 4. Students open a link by its token only, without the lecturer's GPS ──
create or replace function get_attendance_link(p_token text)
returns table (id text, course_code text, title text, token text, is_active boolean,
               created_by text, created_at timestamptz, expires_at timestamptz,
               assign_class_code boolean, link_type text, test_id text,
               has_location boolean, anchor_radius int)
language sql stable security definer set search_path = public as $$
  select l.id, l.course_code, l.title, l.token, l.is_active, l.created_by, l.created_at, l.expires_at,
         l.assign_class_code, l.link_type, l.test_id,
         l.anchor_lat is not null, l.anchor_radius
    from attendance_links l
   where l.token = p_token;
$$;
revoke all on function get_attendance_link(text) from public;
grant execute on function get_attendance_link(text) to anon, authenticated;

-- Profile for check-in: no phone number any more
drop function if exists get_student_profile(text);
create function get_student_profile(p_matric text)
returns table (matric_number text, full_name text, department text, level text,
               gender text, descriptor double precision[], status text)
language sql stable security definer set search_path = public as $$
  select matric_number, full_name, department, level, gender, descriptor, status
    from students where matric_number = upper(trim(p_matric));
$$;
revoke all on function get_student_profile(text) from public;
grant execute on function get_student_profile(text) to anon, authenticated;

-- ── 2, 3, 5, 6, 7. Check-in ─────────────────────────────────────────────────
alter table attendance_attempts add column if not exists ip text;
create index if not exists idx_attempts_matric_time on attendance_attempts (matric, at desc);
create index if not exists idx_attempts_ip_time on attendance_attempts (ip, at desc);

-- Caller's IP as passed by Supabase's API gateway (null when not available)
create or replace function request_ip()
returns text language sql stable as $$
  select nullif(split_part(coalesce(
    (nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for'),
    (nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip'), ''), ',', 1), '');
$$;

create or replace function submit_attendance(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l          attendance_links%rowtype;
  st         students%rowtype;
  s          text;
  v_token    text := p->>'token';
  v_device   text := left(coalesce(p->>'deviceId', ''), 80);
  v_matric   text := upper(trim(coalesce(p->>'matricNumber', '')));
  v_code     text := upper(trim(coalesce(p->>'roomCode', '')));
  v_ip       text := request_ip();
  v_lat      double precision;
  v_lng      double precision;
  v_acc      double precision;
  v_face     double precision;
  v_day      text := to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM-DD');
  v_slot     bigint := room_code_slot();
  v_dist     double precision := 0;
  v_radius   int;
  v_tol      double precision;
  v_anchor_lat double precision;
  v_anchor_lng double precision;
  v_anchor_acc double precision;
  v_settings jsonb;
  v_id       text := coalesce(p->>'id', gen_random_uuid()::text);
  v_class_code text;
  v_custom   jsonb;
  v_flags    text[] := '{}';
  v_name text; v_dept text; v_level text; v_gender text; v_phone text;
begin
  if v_token is null or v_device = '' or v_matric = '' then
    raise exception 'invalid';
  end if;

  -- Numbers must be real, finite numbers in range (NaN / Infinity / text → invalid)
  begin
    v_lat  := (p->>'lat')::double precision;
    v_lng  := (p->>'lng')::double precision;
    v_acc  := (p->>'accuracy')::double precision;
    v_face := (p->>'faceDistance')::double precision;
  exception when others then
    raise exception 'invalid';
  end;
  if (v_lat is not null and (v_lat = 'NaN' or v_lat not between -90 and 90))
     or (v_lng is not null and (v_lng = 'NaN' or v_lng not between -180 and 180))
     or (v_acc is not null and (v_acc = 'NaN' or v_acc < 0 or v_acc = 'Infinity'))
     or (v_face is not null and (v_face = 'NaN' or v_face < 0 or v_face = 'Infinity')) then
    raise exception 'invalid';
  end if;

  -- Rate limit: 5 failures in 5 minutes from the same phone, matric or IP → locked
  if (select count(*) from attendance_attempts
       where at > now() - interval '5 minutes'
         and (device_id = v_device or matric = v_matric or (v_ip is not null and ip = v_ip))) >= 5 then
    raise exception 'locked';
  end if;

  select * into l from attendance_links where token = v_token;
  if l.id is null or coalesce(l.link_type, 'attendance') <> 'attendance' then
    raise exception 'not_found';
  end if;
  if not l.is_active or l.expires_at <= now() then
    insert into attendance_attempts (link_id, device_id, matric, ip, reason) values (l.id, v_device, v_matric, v_ip, 'closed');
    return jsonb_build_object('error', 'closed');
  end if;

  select code_secret into s from attendance_link_secrets where link_id = l.id;
  if s is null or v_code not in (room_code_for(s, v_slot), room_code_for(s, v_slot - 1)) then
    insert into attendance_attempts (link_id, device_id, matric, ip, reason, detail, lat, lng, accuracy)
      values (l.id, v_device, v_matric, v_ip, 'wrong_code', left(v_code, 10), v_lat, v_lng, v_acc);
    return jsonb_build_object('error', 'wrong_code');
  end if;

  -- Location is required: the lecturer's verified spot, else the class pin in settings
  v_anchor_lat := l.anchor_lat; v_anchor_lng := l.anchor_lng; v_anchor_acc := l.anchor_accuracy;
  v_radius := coalesce(l.anchor_radius, 100);
  if v_anchor_lat is null then
    select data into v_settings from admin_settings where id = 'default';
    v_anchor_lat := (v_settings->>'classLat')::double precision;
    v_anchor_lng := (v_settings->>'classLng')::double precision;
    v_anchor_acc := 0;
    v_radius := coalesce((v_settings->>'radiusMeters')::int, 100);
  end if;
  if v_anchor_lat is null or v_anchor_lng is null then
    raise exception 'no_location';
  end if;
  if v_lat is null or v_lng is null then
    insert into attendance_attempts (link_id, device_id, matric, ip, reason) values (l.id, v_device, v_matric, v_ip, 'no_gps');
    return jsonb_build_object('error', 'no_gps');
  end if;
  if v_acc is null or v_acc > 150 then
    insert into attendance_attempts (link_id, device_id, matric, ip, reason, detail, lat, lng, accuracy)
      values (l.id, v_device, v_matric, v_ip, 'weak_gps', coalesce(round(v_acc)::text, ''), v_lat, v_lng, v_acc);
    return jsonb_build_object('error', 'weak_gps:' || coalesce(round(v_acc)::text, '0'));
  end if;
  v_dist := haversine_m(v_lat, v_lng, v_anchor_lat, v_anchor_lng);
  v_tol  := least(v_acc, 75) + least(greatest(coalesce(v_anchor_acc, 0), 0), 50);
  if v_dist - v_tol > v_radius then
    insert into attendance_attempts (link_id, device_id, matric, ip, reason, detail, lat, lng, accuracy)
      values (l.id, v_device, v_matric, v_ip, 'out_of_range', round(v_dist)::text, v_lat, v_lng, v_acc);
    return jsonb_build_object('error', 'out_of_range:' || least(round(v_dist), 2000000000)::bigint || ':' || v_radius);
  end if;

  if exists (select 1 from attendance_records
              where device_id = v_device and course_code = l.course_code and day_key = v_day) then
    raise exception 'duplicate_device';
  end if;
  if exists (select 1 from attendance_records
              where upper(matric_number) = v_matric and course_code = l.course_code and day_key = v_day) then
    raise exception 'duplicate_matric';
  end if;

  -- Registered profile wins over whatever was typed
  select * into st from students where matric_number = v_matric;
  if st.matric_number is not null then
    v_name := st.full_name; v_dept := st.department; v_level := st.level;
    v_gender := st.gender; v_phone := st.phone;
    if v_face is null then
      v_flags := array_append(v_flags, 'no_face_check');
    elsif v_face > 0.55 then
      v_flags := array_append(v_flags, 'face_mismatch');
    end if;
    if st.device_id <> v_device then
      v_flags := array_append(v_flags, 'different_phone');
    end if;
  else
    if coalesce(p->>'fullName', '') = '' then raise exception 'invalid'; end if;
    v_name := left(p->>'fullName', 120); v_dept := left(coalesce(p->>'department', ''), 120);
    v_level := left(coalesce(p->>'level', ''), 10); v_gender := left(coalesce(p->>'gender', 'other'), 10);
    v_phone := left(coalesce(p->>'phone', ''), 30);
    v_flags := array_append(v_flags, 'not_registered');
  end if;

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

  -- Only the photo fields come from the phone; everything the lecturer relies on is set here
  v_custom := coalesce(p->'customFields', '{}'::jsonb);
  if jsonb_typeof(v_custom) <> 'object' then v_custom := '{}'::jsonb; end if;
  v_custom := (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(v_custom)
                where key in ('photo', 'photoAddress', 'photoTemperatureC', 'photoWeather', 'photoTakenAt'));
  v_custom := v_custom || jsonb_build_object(
    'gpsAccuracy', v_acc, 'roomCodeOk', true, 'serverChecked', true, 'checkedAt', now(),
    'faceDistance', v_face, 'registered', st.matric_number is not null,
    'flags', array_to_string(v_flags, ','));

  insert into attendance_records (
    id, full_name, matric_number, department, phone, course_code, topic, level, gender,
    submitted_at, day_key, device_id, distance_meters, lat, lng, session_id,
    custom_fields, assigned_class_code, link_id)
  values (
    v_id, v_name, v_matric, v_dept, v_phone, l.course_code, left(coalesce(p->>'topic',''), 200),
    v_level, v_gender, now(), v_day, v_device, round(v_dist), v_lat, v_lng,
    left(coalesce(p->>'sessionId',''), 80), v_custom, v_class_code, l.id);

  return jsonb_build_object('id', v_id, 'distance', round(v_dist), 'classCode', v_class_code,
                            'dayKey', v_day, 'submittedAt', now(),
                            'flags', array_to_string(v_flags, ','));
end $$;
revoke all on function submit_attendance(jsonb) from public;
grant execute on function submit_attendance(jsonb) to anon, authenticated;

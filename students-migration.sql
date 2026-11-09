-- ============================================================
-- Attendly — Student registration with face verification
-- Run AFTER security-hardening.sql, in Supabase → SQL Editor.
-- Safe to run more than once.
--
-- Students register once (/register): details + a face "fingerprint"
-- (128 numbers, not a photo) + a small reference photo. At check-in the
-- phone compares the selfie with the registered fingerprint; the result
-- is saved with the record and anything doubtful is flagged for review,
-- never silently accepted.
-- ============================================================

create table if not exists students (
  matric_number text primary key,
  full_name     text not null,
  department    text not null default '',
  level         text not null default '',
  phone         text not null default '',
  gender        text not null default 'other',
  device_id     text not null,
  descriptor    double precision[] not null,
  photo         text,                       -- small JPEG data URL for the lecturer
  status        text not null default 'active',  -- active | reset_requested
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_students_device on students (device_id);

alter table students enable row level security;
drop policy if exists "lecturers manage students" on students;
create policy "lecturers manage students" on students
  for all to authenticated using (true) with check (true);
-- Students (anon) have no direct access; they go through the functions below.

-- Squared euclidean distance between two 128-number face descriptors
create or replace function face_distance(a double precision[], b double precision[])
returns double precision language sql immutable as $$
  select sqrt(coalesce(sum((x - y) * (x - y)), 1e9))
    from unnest(a, b) as t(x, y);
$$;

-- ── Student: register ───────────────────────────────────────────────────────
-- Errors: invalid | matric_taken | device_taken | face_exists:<matric-hint>
create or replace function register_student(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_matric text := upper(trim(coalesce(p->>'matricNumber', '')));
  v_device text := left(coalesce(p->>'deviceId', ''), 80);
  v_desc   double precision[];
  v_other  text;
begin
  if v_matric = '' or v_device = '' or coalesce(p->>'fullName', '') = '' or p->'descriptor' is null then
    raise exception 'invalid';
  end if;
  select array_agg(x::double precision) into v_desc from jsonb_array_elements_text(p->'descriptor') as t(x);
  if array_length(v_desc, 1) <> 128 then
    raise exception 'invalid';
  end if;

  if exists (select 1 from students where matric_number = v_matric) then
    raise exception 'matric_taken';
  end if;
  if exists (select 1 from students where device_id = v_device) then
    raise exception 'device_taken';
  end if;
  -- Same face already registered under another matric number?
  select matric_number into v_other from students
   where face_distance(descriptor, v_desc) < 0.45
   order by face_distance(descriptor, v_desc) limit 1;
  if v_other is not null then
    raise exception 'face_exists:%', left(v_other, 3) || '***' || right(v_other, 3);
  end if;

  insert into students (matric_number, full_name, department, level, phone, gender, device_id, descriptor, photo)
  values (v_matric, left(p->>'fullName', 120), left(coalesce(p->>'department', ''), 120),
          left(coalesce(p->>'level', ''), 10), left(coalesce(p->>'phone', ''), 30),
          left(coalesce(p->>'gender', 'other'), 10), v_device, v_desc, p->>'photo');
  return jsonb_build_object('matricNumber', v_matric, 'fullName', p->>'fullName');
end $$;
revoke all on function register_student(jsonb) from public;
grant execute on function register_student(jsonb) to anon, authenticated;

-- ── Student: own profile for check-in (details + fingerprint, no photo) ─────
create or replace function get_student_profile(p_matric text)
returns table (matric_number text, full_name text, department text, level text,
               phone text, gender text, descriptor double precision[], status text)
language sql security definer set search_path = public as $$
  select matric_number, full_name, department, level, phone, gender, descriptor, status
    from students where matric_number = upper(trim(p_matric));
$$;
grant execute on function get_student_profile(text) to anon, authenticated;

-- ── Student: ask for a reset (new phone) ────────────────────────────────────
create or replace function request_student_reset(p_matric text)
returns void language sql security definer set search_path = public as $$
  update students set status = 'reset_requested', updated_at = now()
   where matric_number = upper(trim(p_matric));
$$;
grant execute on function request_student_reset(text) to anon, authenticated;

-- ── submit_attendance: use the registered profile and record the face result ─
-- Same checks as security-hardening.sql, plus:
--   * if the matric is registered, name/department/level/gender come from the
--     profile (students can't type someone else's details)
--   * faceDistance from the phone is stored; > 0.55 or missing → faceFlag for review
--   * a registered student checking in from a different phone is flagged too
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
  v_lat      double precision := (p->>'lat')::double precision;
  v_lng      double precision := (p->>'lng')::double precision;
  v_acc      double precision := (p->>'accuracy')::double precision;
  v_face     double precision := (p->>'faceDistance')::double precision;
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
  v_flags    text[] := '{}';
  v_name text; v_dept text; v_level text; v_gender text; v_phone text;
begin
  if v_token is null or v_device = '' or v_matric = '' then
    raise exception 'invalid';
  end if;

  select count(*) into v_fail from attendance_attempts
   where device_id = v_device and at > now() - interval '5 minutes';
  if v_fail >= 5 then raise exception 'locked'; end if;

  select * into l from attendance_links where token = v_token;
  if l.id is null or coalesce(l.link_type, 'attendance') <> 'attendance' then
    raise exception 'not_found';
  end if;
  if not l.is_active or l.expires_at <= now() then
    insert into attendance_attempts (link_id, device_id, matric, reason) values (l.id, v_device, v_matric, 'closed');
    raise exception 'closed';
  end if;

  select code_secret into s from attendance_link_secrets where link_id = l.id;
  if s is null or v_code not in (room_code_for(s, v_slot), room_code_for(s, v_slot - 1)) then
    insert into attendance_attempts (link_id, device_id, matric, reason, detail, lat, lng, accuracy)
      values (l.id, v_device, v_matric, 'wrong_code', v_code, v_lat, v_lng, v_acc);
    raise exception 'wrong_code';
  end if;

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
      v_flags := v_flags || 'no_face_check';
    elsif v_face > 0.55 then
      v_flags := v_flags || 'face_mismatch';
    end if;
    if st.device_id <> v_device then
      v_flags := v_flags || 'different_phone';
    end if;
  else
    if coalesce(p->>'fullName', '') = '' then raise exception 'invalid'; end if;
    v_name := left(p->>'fullName', 120); v_dept := left(coalesce(p->>'department', ''), 120);
    v_level := left(coalesce(p->>'level', ''), 10); v_gender := left(coalesce(p->>'gender', 'other'), 10);
    v_phone := left(coalesce(p->>'phone', ''), 30);
    v_flags := v_flags || 'not_registered';
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
    coalesce(p->>'sessionId',''), v_custom, v_class_code, l.id);

  return jsonb_build_object('id', v_id, 'distance', round(v_dist), 'classCode', v_class_code,
                            'dayKey', v_day, 'submittedAt', now(),
                            'flags', array_to_string(v_flags, ','));
end $$;
revoke all on function submit_attendance(jsonb) from public;
grant execute on function submit_attendance(jsonb) to anon, authenticated;

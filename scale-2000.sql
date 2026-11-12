-- ============================================================
-- Attendly — Ready for big classes (2,000 students at once).
-- Run AFTER security-fixes.sql (and session-blocks.sql if you use it).
-- Safe to run more than once.
--
--  * Indexes so each check-in's duplicate checks stay instant as records grow.
--  * The attempt lock no longer locks a whole campus Wi-Fi network: phones and
--    matric numbers still lock after 5 failures, a shared IP only after 60.
--  * Suspicious-location flags (never block, only send to "To review"):
--      gps_too_still   GPS never moved or changed accuracy (fake-GPS apps)
--      gps_round       coordinates with 4 or fewer decimals (typed-in spot)
--      same_spot       exactly the same coordinates as another student
--      on_pin          exactly on the lecturer's pin
--      off_campus_net  not on a campus internet address (only when set)
-- ============================================================

create index if not exists idx_records_device_course_day on attendance_records (device_id, course_code, day_key);
create index if not exists idx_records_matric_course_day on attendance_records (upper(matric_number), course_code, day_key);
create index if not exists idx_records_matric_time       on attendance_records (upper(matric_number), submitted_at desc);
create index if not exists idx_records_class_code        on attendance_records (assigned_class_code);
create index if not exists idx_records_link              on attendance_records (link_id);
create index if not exists idx_records_submitted         on attendance_records (submitted_at desc);
create index if not exists idx_attempts_time             on attendance_attempts (at desc);

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
  v_gps      jsonb;
  v_prefixes text;
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
  -- Per phone or matric: 5 failures in 5 minutes. Per IP (campus Wi-Fi is
  -- shared by hundreds): only a flood of 60 failures in 5 minutes.
  if (select count(*) from attendance_attempts
       where at > now() - interval '5 minutes'
         and (device_id = v_device or matric = v_matric)) >= 5
     or (v_ip is not null and (select count(*) from attendance_attempts
       where at > now() - interval '5 minutes' and ip = v_ip) >= 60) then
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

  -- ── Suspicious-location checks (flag only) ──
  v_gps := case when jsonb_typeof(p->'gps') = 'object' then p->'gps' else '{}'::jsonb end;
  if coalesce((v_gps->>'n')::int, 0) >= 4
     and coalesce((v_gps->>'coordDistinct')::int, 0) = 1
     and coalesce((v_gps->>'accDistinct')::int, 0) = 1 then
    v_flags := array_append(v_flags, 'gps_too_still');
  end if;
  if abs(v_lat * 10000 - round(v_lat * 10000)) < 1e-6 and abs(v_lng * 10000 - round(v_lng * 10000)) < 1e-6 then
    v_flags := array_append(v_flags, 'gps_round');
  end if;
  if exists (select 1 from attendance_records o
              where o.link_id = l.id and o.device_id <> v_device
                and abs(o.lat - v_lat) < 1e-7 and abs(o.lng - v_lng) < 1e-7) then
    v_flags := array_append(v_flags, 'same_spot');
  end if;
  if v_dist < 0.5 then
    v_flags := array_append(v_flags, 'on_pin');
  end if;
  select data->>'campusIpPrefixes' into v_prefixes from admin_settings where id = 'default';
  if coalesce(trim(v_prefixes), '') <> '' and v_ip is not null
     and not exists (select 1 from unnest(string_to_array(v_prefixes, ',')) pre
                      where trim(pre) <> '' and v_ip like trim(pre) || '%') then
    v_flags := array_append(v_flags, 'off_campus_net');
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
    'gps', v_gps, 'ip', v_ip,
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

-- RUN-THESE-NOW.sql — paste all of this into Supabase → SQL Editor → Run.
-- It contains, in order: qr-checkin.sql, gps-zones.sql, active-attendance.sql, student-import.sql.
-- Safe to run more than once. Needs simple-checkin.sql to have been run before (you did that earlier).

-- ===================== qr-checkin.sql =====================
-- qr-checkin.sql
-- Scanning the projector QR fills in the projector code for the student.
-- The QR holds the live code. When the student opens it, the phone swaps that
-- code for a "room pass" that lasts 10 minutes on that phone only, so the code
-- changing every 30 seconds while they take a selfie doesn't matter.
-- Someone at home can't get a pass: they'd need the code on the screen right now.
-- Safe to run more than once. Run after simple-checkin.sql.

create table if not exists public.room_passes (
  id         uuid primary key default gen_random_uuid(),
  link_id    text not null,
  device_id  text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.room_passes enable row level security;
revoke all on public.room_passes from anon, authenticated;
create index if not exists room_passes_link_idx on public.room_passes (link_id, device_id);

-- Swap the code from the QR for a pass (code must be current or the previous one)
create or replace function public.claim_room_pass(p_token text, p_code text, p_device text)
returns uuid language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  l attendance_links%rowtype;
  s text;
  v_slot bigint := room_code_slot();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_dev  text := left(coalesce(p_device, ''), 80);
  v_id uuid;
begin
  if v_dev = '' then return null; end if;
  -- Same lock-out as check-in: 5 failures in 5 minutes from this phone
  if (select count(*) from attendance_attempts where at > now() - interval '5 minutes' and device_id = v_dev) >= 5 then
    return null;
  end if;
  select * into l from attendance_links where token = p_token;
  if l.id is null or not l.is_active or l.expires_at <= now() then return null; end if;
  select code_secret into s from attendance_link_secrets where link_id = l.id;
  if s is null or v_code not in (room_code_for(s, v_slot), room_code_for(s, v_slot - 1)) then
    insert into attendance_attempts (link_id, device_id, matric, ip, reason, detail)
      values (l.id, v_dev, '', request_ip(), 'wrong_code', 'qr:' || left(v_code, 10));
    return null;
  end if;
  delete from room_passes where expires_at < now() - interval '1 day';
  insert into room_passes (link_id, device_id) values (l.id, v_dev) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.claim_room_pass(text, text, text) from public;
grant execute on function public.claim_room_pass(text, text, text) to anon, authenticated;

create or replace function public.room_pass_ok(p_link text, p_pass text, p_device text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from room_passes
                  where id::text = coalesce(p_pass, '') and link_id = p_link
                    and device_id = coalesce(p_device, '') and expires_at > now());
$$;
revoke all on function public.room_pass_ok(text, text, text) from public;

-- Check-in: a valid room pass counts the same as typing the code
do $$
declare
  def text;
  old_check constant text := 'if not v_help and coalesce(l.require_room_code, false) and (s is null';
  new_check constant text := 'if not v_help and coalesce(l.require_room_code, false) and not room_pass_ok(l.id, p->>''roomPass'', v_device) and (s is null';
begin
  select pg_get_functiondef('public.submit_attendance(jsonb)'::regprocedure) into def;
  if position(new_check in def) > 0 then
    raise notice 'submit_attendance already accepts room passes';
  elsif position(old_check in def) = 0 then
    raise exception 'submit_attendance looks different than expected: run simple-checkin.sql first, then this file';
  else
    execute replace(def, old_check, new_check);
    raise notice 'submit_attendance updated: QR room pass accepted';
  end if;
end $$;

-- ===================== gps-zones.sql =====================
-- gps-zones.sql
-- Check-in no longer treats GPS as a plain yes or no. Each check-in lands in
-- one of three zones:
--   Green: GPS puts the phone inside the circle. Accepted, same reach as before.
--   Soft:  GPS is doubtful but the phone is on campus (within 1.5 km). Accepted
--          only with the code on the lecturer's screen (typed, or a room pass
--          from scanning the projector QR). Recorded with a "loc_code" flag, or
--          "loc_far" (goes to Review) beyond 500 m.
--   Hard:  no location, a fix worse than 1.5 km, or a phone over 1.5 km away.
--          Refused; only the lecturer scan gets past it.
-- Students with GPS trouble are no longer locked out for it, a whole class on
-- one Wi-Fi address can't lock each other out, and getting a room pass is never
-- blocked by GPS trouble. Wrong codes still lock a phone after 5 tries.
-- An out-of-date or mistyped code from the QR / "One more step" screen counts
-- against that phone only: it never pauses check-in for the other phones on the
-- same Wi-Fi address. Code guessing from one address is stopped separately
-- (1000 wrong codes in 5 minutes).
-- No table changes.
-- Run after gps-help.sql, simple-checkin.sql and qr-checkin.sql. Safe to run more than once,
-- and it brings a database that has an earlier copy of this file up to date.
-- (If gps-help.sql or scale-2000.sql is ever run again, re-run simple-checkin.sql,
--  qr-checkin.sql and this file, in that order.)

begin;

-- Swap the code from the QR for a pass (code must be current or the previous one).
-- Same as qr-checkin.sql, except only wrong codes count toward the lock-out, and
-- one address can't keep guessing by making up new phones.
create or replace function public.claim_room_pass(p_token text, p_code text, p_device text)
returns uuid language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  l attendance_links%rowtype;
  s text;
  v_slot bigint := room_code_slot();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_dev  text := left(coalesce(p_device, ''), 80);
  v_ip   text := request_ip();
  v_id uuid;
begin
  if v_dev = '' then return null; end if;
  -- Lock-out: 5 wrong codes in 5 minutes from this phone (GPS trouble doesn't count)
  if (select count(*) from attendance_attempts
       where at > now() - interval '5 minutes' and device_id = v_dev and reason = 'wrong_code') >= 5 then
    return null;
  end if;
  -- Guessing with made-up phones: 1000 wrong codes here in 5 minutes from one address.
  -- (High on purpose: a full hall shares one Wi-Fi address and each phone gets 5 tries.)
  if v_ip is not null and (select count(*) from attendance_attempts
       where at > now() - interval '5 minutes' and ip = v_ip
         and reason = 'wrong_code' and detail like 'qr:%') >= 1000 then
    return null;
  end if;
  select * into l from attendance_links where token = p_token;
  if l.id is null or not l.is_active or l.expires_at <= now() then return null; end if;
  select code_secret into s from attendance_link_secrets where link_id = l.id;
  if s is null or v_code not in (room_code_for(s, v_slot), room_code_for(s, v_slot - 1)) then
    insert into attendance_attempts (link_id, device_id, matric, ip, reason, detail)
      values (l.id, v_dev, '', v_ip, 'wrong_code', 'qr:' || left(v_code, 10));
    return null;
  end if;
  delete from room_passes where expires_at < now() - interval '1 day';
  insert into room_passes (link_id, device_id) values (l.id, v_dev) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.claim_room_pass(text, text, text) from public;
grant execute on function public.claim_room_pass(text, text, text) to anon, authenticated;

-- Check-in: replace the location section and loosen the locks for GPS trouble
do $$
declare
  def text; a int; b int;
  marker   constant text := '-- gps-zones v1';
  start_at constant text := 'if v_lat is null or v_lng is null then';
  end_at   constant text := 'v_gps := case when jsonb_typeof';
  old_lock constant text := 'and (device_id = v_device or matric = v_matric)) >= 5';
  new_lock constant text := 'and (device_id = v_device or matric = v_matric)
         and reason not in (''no_gps'', ''weak_gps'', ''need_room_code'')) >= 5
     or (not v_help and (select count(*) from attendance_attempts
       where at > now() - interval ''5 minutes'' and device_id = v_device) >= 20)';
  old_ip   constant text := 'and ip = v_ip) >= 60';
  -- What the first copy of this file put in: wrong codes sent to claim_room_pass
  -- (logged with detail 'qr:...') still counted against everyone on the address
  ip_v1    constant text := 'and ip = v_ip
         and reason not in (''no_gps'', ''weak_gps'', ''need_room_code'')) >= 60';
  new_ip   constant text := 'and ip = v_ip
         and reason not in (''no_gps'', ''weak_gps'', ''need_room_code'')
         and not (reason = ''wrong_code'' and coalesce(detail, '''') like ''qr:%'')) >= 60';
  section  constant text := $sec$-- gps-zones v1
  -- GPS alone passes only inside the circle (same ceiling as before, honest floors).
  -- A doubtful fix on campus needs the code / QR on the lecturer's screen.
  -- No fix, a fix worse than 1.5 km, or a phone over 1.5 km away is refused.
  declare
    v_proof boolean := false;
  begin
    v_radius := greatest(coalesce(v_radius, 100), 100);
    if v_help then
      v_dist := 0;
    elsif v_lat is null or v_lng is null then
      insert into attendance_attempts (link_id, device_id, matric, ip, reason)
        values (l.id, v_device, v_matric, v_ip, 'no_gps');
      return jsonb_build_object('error', 'no_gps');
    elsif v_acc is null or v_acc > 1500 then
      insert into attendance_attempts (link_id, device_id, matric, ip, reason, detail, lat, lng, accuracy)
        values (l.id, v_device, v_matric, v_ip, 'weak_gps', coalesce(round(v_acc)::text, ''), v_lat, v_lng, v_acc);
      return jsonb_build_object('error', 'weak_gps:' || least(round(coalesce(v_acc, 0)), 2000000000)::bigint);
    else
      v_dist := haversine_m(v_lat, v_lng, v_anchor_lat, v_anchor_lng);
      v_tol  := least(greatest(v_acc, 25), 75) + least(greatest(coalesce(v_anchor_acc, 0), 30), 50);
      if v_acc <= 150 and v_dist <= v_radius + v_tol then
        null;  -- green: GPS alone is enough
      elsif v_dist > 1500 then
        insert into attendance_attempts (link_id, device_id, matric, ip, reason, detail, lat, lng, accuracy)
          values (l.id, v_device, v_matric, v_ip, 'out_of_range', round(v_dist)::text, v_lat, v_lng, v_acc);
        return jsonb_build_object('error', 'out_of_range:far');
      else
        v_proof := room_pass_ok(l.id, p->>'roomPass', v_device)
                   or (s is not null and v_code <> ''
                       and v_code in (room_code_for(s, v_slot), room_code_for(s, v_slot - 1)));
        if not v_proof then
          insert into attendance_attempts (link_id, device_id, matric, ip, reason, detail, lat, lng, accuracy)
            values (l.id, v_device, v_matric, v_ip,
                    case when v_code <> '' then 'wrong_code' else 'need_room_code' end,
                    case when v_code <> '' then 'soft:' || left(v_code, 10) else round(v_dist)::text end,
                    v_lat, v_lng, v_acc);
          return jsonb_build_object('error', 'need_room_code',
                                    'why', case when v_acc > 150 then 'weak' else 'far' end);
        end if;
        v_flags := array_append(v_flags,
                     case when v_dist > 500 or v_acc > 500 then 'loc_far' else 'loc_code' end);
      end if;
    end if;
  end;

  -- Suspicious-location checks (flag only; not for lecturer-scanned help)
  if not v_help then
  $sec$;
begin
  select pg_get_functiondef('public.submit_attendance(jsonb)'::regprocedure) into def;
  if position(marker in def) > 0 then
    if position(new_ip in def) > 0 then
      raise notice 'submit_attendance already has gps-zones v1'; return;
    end if;
    -- Patched by the first copy of this file: only the shared-address count changes
    if position(ip_v1 in def) = 0 then
      raise exception 'submit_attendance looks different than expected: nothing was changed';
    end if;
    execute replace(def, ip_v1, new_ip);
    raise notice 'submit_attendance updated: gps-zones v1, shared-address count fixed'; return;
  end if;
  if position('v_help' in def) = 0 or position('room_pass_ok(l.id' in def) = 0 then
    raise exception 'run gps-help.sql, simple-checkin.sql and qr-checkin.sql first';
  end if;
  a := position(start_at in def); b := position(end_at in def);
  if a = 0 or b = 0 or b <= a or position(old_lock in def) = 0 or position(old_ip in def) = 0 then
    raise exception 'submit_attendance looks different than expected: nothing was changed';
  end if;
  def := substr(def, 1, a - 1) || section || substr(def, b);
  def := replace(def, old_lock, new_lock);
  def := replace(def, old_ip, new_ip);
  execute def;
  raise notice 'submit_attendance updated: gps-zones v1';
end $$;

commit;

-- ===================== active-attendance.sql =====================
-- active-attendance.sql
-- Lets the student Attendance page show a "Mark attendance now" button while a
-- check-in is open. Returns only open attendance links (course, title, link
-- token, closing time). Location, projector code and one-per-phone rules still
-- apply when the student checks in. Safe to run more than once.

create or replace function public.get_active_attendance()
returns table (token text, course_code text, title text, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.token, l.course_code, l.title, l.expires_at
    from attendance_links l
   where l.is_active and l.expires_at > now()
     and coalesce(l.link_type, 'attendance') = 'attendance'
   order by l.created_at desc
   limit 5;
$$;
revoke all on function public.get_active_attendance() from public;
grant execute on function public.get_active_attendance() to anon, authenticated;

-- ===================== student-import.sql =====================
-- student-import.sql
-- Lets a lecturer upload the student list collected with a Google Form
-- (full name, UTME reg number, department, WhatsApp, hostel, next of kin,
-- optional next-of-kin number, passport photo). Imported students check in
-- straight away with their UTME reg number, without registering.
--
-- When a student gets a matric number it is ADDED to the same record, by the
-- student (from the phone they already check in with) or by the lecturer
-- (one at a time, or a CSV of UTME reg number + matric number). After that
-- both numbers work at check-in, and every past record moves to the matric
-- number so the student's history stays together.
--
-- Private details (WhatsApp, hostel, next of kin) are readable by lecturers
-- only. Safe to run more than once. Run after students-migration.sql,
-- security-fixes.sql and gps-zones.sql.

begin;

-- 1. New details on each student -------------------------------------------
alter table public.students add column if not exists utme_reg_no      text;
alter table public.students add column if not exists whatsapp         text not null default '';
alter table public.students add column if not exists hostel           text not null default '';
alter table public.students add column if not exists next_of_kin      text not null default '';
alter table public.students add column if not exists next_of_kin_phone text not null default '';
-- registered = did the face scan in the app; imported = from the lecturer's list
alter table public.students add column if not exists source           text not null default 'registered';
-- How the matric number got there: student | lecturer | csv (null = never added)
alter table public.students add column if not exists matric_source    text;
alter table public.students add column if not exists matric_added_at  timestamptz;
create unique index if not exists students_utme_unique on public.students (utme_reg_no) where utme_reg_no is not null;

-- 2. Which record a typed number belongs to ---------------------------------
-- The record's key is the matric number once known, else the UTME reg number.
create or replace function public.resolve_student_key(p_id text)
returns text language sql stable security definer set search_path = public as $$
  select s.matric_number from students s
   where s.matric_number = upper(trim(coalesce(p_id, '')))
      or s.utme_reg_no   = upper(trim(coalesce(p_id, '')))
   limit 1;
$$;
revoke all on function public.resolve_student_key(text) from public;

-- 3. Student profile at check-in: by matric OR UTME number ------------------
-- Now also says whether the student still needs to add a matric number.
drop function if exists public.get_student_profile(text);
create function public.get_student_profile(p_matric text)
returns table (matric_number text, full_name text, department text, level text, gender text,
               descriptor double precision[], status text, utme_reg_no text, needs_matric boolean)
language sql stable security definer set search_path = public as $$
  select s.matric_number, s.full_name, s.department, s.level, s.gender, s.descriptor, s.status,
         s.utme_reg_no,
         (s.utme_reg_no is not null and s.matric_number = s.utme_reg_no)
    from students s
   where s.matric_number = public.resolve_student_key(p_matric);
$$;
revoke all on function public.get_student_profile(text) from public;
grant execute on function public.get_student_profile(text) to anon, authenticated;

create or replace function public.lookup_student(p_matric text)
returns table (full_name text, level text, matric_number text, assigned_class_code text)
language sql stable security definer set search_path = public as $$
  select full_name, level, matric_number, null::text
    from attendance_records
   where upper(matric_number) = coalesce(public.resolve_student_key(p_matric), upper(trim(p_matric)))
   order by submitted_at desc limit 1;
$$;

-- 4. Move a student's key to their new matric number ------------------------
-- Internal: renames the record and every row that points at it.
create or replace function public._move_student_key(p_old text, p_new text, p_source text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update students set matric_number = p_new, matric_source = p_source,
         matric_added_at = now(), updated_at = now()
   where matric_number = p_old;
  update attendance_records set matric_number = p_new where upper(matric_number) = p_old;
  update test_submissions   set matric_number = p_new where upper(matric_number) = p_old;
  update material_purchases set matric_number = p_new where upper(matric_number) = p_old;
  update session_blocks     set matric = p_new where upper(matric) = p_old;
  update push_subscriptions set matric = p_new where upper(matric) = p_old;
end $$;
revoke all on function public._move_student_key(text, text, text) from public, anon, authenticated;

-- Shared checks for a new matric number. Errors: not_found | has_matric | matric_taken | invalid
create or replace function public._check_new_matric(p_id text, p_matric text, out v_key text, out v_new text)
language plpgsql stable security definer set search_path = public as $$
declare st students%rowtype;
begin
  v_new := upper(regexp_replace(trim(coalesce(p_matric, '')), '\s+', '', 'g'));
  if length(v_new) < 5 or length(v_new) > 40 then raise exception 'invalid'; end if;
  select * into st from students where matric_number = resolve_student_key(p_id);
  if st.matric_number is null then raise exception 'not_found'; end if;
  if st.utme_reg_no is null or st.matric_number <> st.utme_reg_no then raise exception 'has_matric'; end if;
  if exists (select 1 from students where (matric_number = v_new or utme_reg_no = v_new)
                                     and matric_number <> st.matric_number) then
    raise exception 'matric_taken';
  end if;
  v_key := st.matric_number;
end $$;
revoke all on function public._check_new_matric(text, text) from public, anon, authenticated;

-- 5. Student adds their own matric number -----------------------------------
-- Allowed only from the phone this student already checks in with, so nobody
-- can attach a number to someone else's record. Shown to the lecturer.
create or replace function public.add_my_matric(p_id text, p_matric text, p_device text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c record; st students%rowtype;
begin
  select * into c from _check_new_matric(p_id, p_matric);
  select * into st from students where matric_number = c.v_key;
  if coalesce(st.device_id, '') = '' or st.device_id <> left(coalesce(p_device, ''), 80) then
    raise exception 'wrong_phone';
  end if;
  perform _move_student_key(c.v_key, c.v_new, 'student');
  return jsonb_build_object('matricNumber', c.v_new);
end $$;
revoke all on function public.add_my_matric(text, text, text) from public;
grant execute on function public.add_my_matric(text, text, text) to anon, authenticated;

-- 6. Lecturer sets matric numbers: one, or a whole department list ----------
-- p_rows: [{"utme":"…","matric":"…"}, …]. Returns per-row results.
create or replace function public.set_matric_numbers(p_rows jsonb, p_source text default 'csv')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r jsonb; c record; ok int := 0; out jsonb := '[]'::jsonb; v_err text;
begin
  if not is_lecturer() then raise exception 'not_authorised'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      select * into c from _check_new_matric(r->>'utme', r->>'matric');
      perform _move_student_key(c.v_key, c.v_new, case when p_source = 'lecturer' then 'lecturer' else 'csv' end);
      ok := ok + 1;
    exception when others then
      v_err := sqlerrm;
      out := out || jsonb_build_array(jsonb_build_object('utme', r->>'utme', 'matric', r->>'matric', 'error', v_err));
    end;
  end loop;
  return jsonb_build_object('updated', ok, 'problems', out);
end $$;
revoke all on function public.set_matric_numbers(jsonb, text) from public;
grant execute on function public.set_matric_numbers(jsonb, text) to authenticated;

-- 7. Check-in: accept the UTME number, and lock the record to the first phone
do $$
declare
  def text;
  marker   constant text := '-- student-import v1';
  start_at constant text := 'if v_token is null or v_device = '''' or v_matric = '''' then';
  old_dev  constant text := 'if st.device_id <> v_device then';
  new_dev  constant text := 'if coalesce(st.device_id, '''') = '''' then
      -- Imported student''s first check-in: this phone becomes theirs
      update students set device_id = v_device, updated_at = now() where matric_number = st.matric_number;
    elsif st.device_id <> v_device then';
begin
  select pg_get_functiondef('public.submit_attendance(jsonb)'::regprocedure) into def;
  if position(marker in def) > 0 then
    raise notice 'submit_attendance already has student-import v1';
    return;
  end if;
  if position(start_at in def) = 0 or position(old_dev in def) = 0 then
    raise exception 'submit_attendance looks different than expected: nothing was changed';
  end if;
  def := replace(def, start_at, marker || E'\n  -- A UTME reg number or a matric number: use the student''s record key\n  v_matric := coalesce(resolve_student_key(v_matric), v_matric);\n  ' || start_at);
  def := replace(def, old_dev, new_dev);
  execute def;
  raise notice 'submit_attendance updated: student-import v1';
end $$;

-- Imported students have no phone yet: allow an empty device id
alter table public.students alter column device_id set default '';

-- 8. Imported students add their own face (no registration) ----------------
-- Only while the record has no face yet, and only from the student's own
-- phone once one is linked. The lecturer sees "Face added by student".
alter table public.students add column if not exists face_source text;   -- import | student | registered

drop function if exists public.get_student_profile(text);
create function public.get_student_profile(p_matric text)
returns table (matric_number text, full_name text, department text, level text, gender text,
               descriptor double precision[], status text, utme_reg_no text, needs_matric boolean,
               has_face boolean)
language sql stable security definer set search_path = public as $$
  select s.matric_number, s.full_name, s.department, s.level, s.gender, s.descriptor, s.status,
         s.utme_reg_no,
         (s.utme_reg_no is not null and s.matric_number = s.utme_reg_no),
         coalesce(array_length(s.descriptor, 1), 0) = 128
    from students s
   where s.matric_number = public.resolve_student_key(p_matric);
$$;
revoke all on function public.get_student_profile(text) from public;
grant execute on function public.get_student_profile(text) to anon, authenticated;

-- Errors: not_found | has_face | wrong_phone | invalid | face_exists
create or replace function public.add_my_face(p_id text, p_device text, p_descriptor jsonb, p_photo text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare st students%rowtype; v_desc double precision[]; v_dev text := left(coalesce(p_device, ''), 80); v_other text;
begin
  select * into st from students where matric_number = resolve_student_key(p_id);
  if st.matric_number is null then raise exception 'not_found'; end if;
  if coalesce(array_length(st.descriptor, 1), 0) = 128 then raise exception 'has_face'; end if;
  if v_dev = '' then raise exception 'invalid'; end if;
  if coalesce(st.device_id, '') <> '' and st.device_id <> v_dev then raise exception 'wrong_phone'; end if;
  select array_agg(x::double precision) into v_desc from jsonb_array_elements_text(p_descriptor) as t(x);
  if coalesce(array_length(v_desc, 1), 0) <> 128 then raise exception 'invalid'; end if;
  select matric_number into v_other from students
   where matric_number <> st.matric_number and coalesce(array_length(descriptor, 1), 0) = 128
     and face_distance(descriptor, v_desc) < 0.45
   order by face_distance(descriptor, v_desc) limit 1;
  if v_other is not null then raise exception 'face_exists'; end if;
  update students set descriptor = v_desc, photo = left(coalesce(p_photo, ''), 200000),
         device_id = v_dev, face_source = 'student', status = 'active', updated_at = now()
   where matric_number = st.matric_number;
  return jsonb_build_object('matricNumber', st.matric_number, 'fullName', st.full_name);
end $$;
revoke all on function public.add_my_face(text, text, jsonb, text) from public;
grant execute on function public.add_my_face(text, text, jsonb, text) to anon, authenticated;

commit;

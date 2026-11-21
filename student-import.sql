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

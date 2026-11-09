-- ============================================================
-- Attendly — Students can correct their name, matric number and
-- department. Run AFTER security-fixes.sql. Safe to run more than once.
--
-- Rules
--  * Only the phone that submitted (its device id) can edit. Students
--    never see other students' records.
--  * Live photo, location, time and class-code result never change.
--  * A new matric number is refused if it's registered to someone else or
--    already checked in for the same class on the same day (stops "check
--    in, swap matric to an absent friend, check in again").
--  * Every edit is kept (old → new) on the record for the lecturer, and a
--    matric change sends the check-in back to the lecturer's To review list.
-- ============================================================

-- Edit log (separate from failed check-ins so edits never count toward the check-in lock)
create table if not exists student_edit_log (
  id        bigserial primary key,
  device_id text not null,
  old_matric text not null,
  new_matric text not null,
  at        timestamptz not null default now()
);
create index if not exists idx_edit_log_device_time on student_edit_log (device_id, at desc);
alter table student_edit_log enable row level security;
drop policy if exists "lecturers read edit log" on student_edit_log;
create policy "lecturers read edit log" on student_edit_log
  for select to authenticated using (is_lecturer());

-- ── What this phone submitted (and its registered profile, if any) ──────────
create or replace function get_my_attendance(p_device text, p_matric text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_device text := left(coalesce(p_device, ''), 80);
  v_matric text := upper(trim(coalesce(p_matric, '')));
  v_profile jsonb;
begin
  if v_device = '' then raise exception 'invalid'; end if;

  select jsonb_build_object('matricNumber', matric_number, 'fullName', full_name,
                            'department', department, 'level', level, 'photo', photo)
    into v_profile
    from students where matric_number = v_matric and device_id = v_device;

  return jsonb_build_object(
    'profile', v_profile,
    'records', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'courseCode', r.course_code, 'submittedAt', r.submitted_at,
               'fullName', r.full_name, 'matricNumber', r.matric_number, 'department', r.department,
               'distanceMeters', r.distance_meters,
               'photo', r.custom_fields->>'photo',
               'flags', coalesce(r.custom_fields->>'flags', ''),
               'reviewed', r.custom_fields->>'reviewed',
               'edited', jsonb_array_length(coalesce(r.custom_fields->'edits', '[]'::jsonb)) > 0)
             order by r.submitted_at desc)
        from attendance_records r
       where r.device_id = v_device), '[]'::jsonb));
end $$;
revoke all on function get_my_attendance(text, text) from public;
grant execute on function get_my_attendance(text, text) to anon, authenticated;

-- ── Correct name / matric / department ──────────────────────────────────────
-- p: { deviceId, matricNumber (current), fullName, newMatricNumber, department }
-- Errors: invalid | not_owner | matric_taken | matric_conflict | too_many_edits
create or replace function update_my_details(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_device  text := left(coalesce(p->>'deviceId', ''), 80);
  v_old     text := upper(trim(coalesce(p->>'matricNumber', '')));
  v_new     text := upper(trim(coalesce(p->>'newMatricNumber', '')));
  v_name    text := trim(coalesce(p->>'fullName', ''));
  v_dept    text := trim(coalesce(p->>'department', ''));
  v_reg     boolean;
  v_changed boolean;
  v_edits   int;
  v_count   int;
begin
  if v_device = '' or v_old = '' or v_new = '' or v_name = '' or v_dept = ''
     or length(v_name) > 120 or length(v_new) > 40 or length(v_dept) > 120 then
    raise exception 'invalid';
  end if;
  v_changed := v_new <> v_old;

  -- Ownership: the registered phone for this matric, or the phone that submitted these check-ins
  v_reg := exists (select 1 from students where matric_number = v_old and device_id = v_device);
  if not v_reg and not exists (select 1 from attendance_records
                                where device_id = v_device and upper(matric_number) = v_old) then
    raise exception 'not_owner';
  end if;

  -- At most 5 edits per phone per day
  select count(*) into v_edits from student_edit_log
   where device_id = v_device and at > now() - interval '1 day';
  if v_edits >= 5 then raise exception 'too_many_edits'; end if;

  if v_changed then
    -- Someone else already registered that matric
    if exists (select 1 from students where matric_number = v_new) then
      raise exception 'matric_taken';
    end if;
    -- That matric is already present for a class on a day this phone checked in
    if exists (
      select 1 from attendance_records mine
        join attendance_records other
          on other.course_code = mine.course_code and other.day_key = mine.day_key
       where mine.device_id = v_device and upper(mine.matric_number) = v_old
         and upper(other.matric_number) = v_new and other.id <> mine.id) then
      raise exception 'matric_conflict';
    end if;
  end if;

  if v_reg then
    update students
       set matric_number = v_new, full_name = left(v_name, 120), department = left(v_dept, 120), updated_at = now()
     where matric_number = v_old and device_id = v_device;
  end if;

  -- Records submitted from this phone under the old matric; photo, location,
  -- time and checks are left exactly as they were.
  update attendance_records r
     set full_name = left(v_name, 120),
         matric_number = v_new,
         department = left(v_dept, 120),
         custom_fields = (coalesce(r.custom_fields, '{}'::jsonb)
           || jsonb_build_object(
                'edits', coalesce(r.custom_fields->'edits', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                  'at', now(),
                  'from', jsonb_build_object('fullName', r.full_name, 'matricNumber', r.matric_number, 'department', r.department),
                  'to',   jsonb_build_object('fullName', left(v_name, 120), 'matricNumber', v_new, 'department', left(v_dept, 120)))),
                'flags', case
                  when v_changed and position('matric_changed' in coalesce(r.custom_fields->>'flags', '')) = 0
                    then concat_ws(',', nullif(r.custom_fields->>'flags', ''), 'matric_changed')
                  else coalesce(r.custom_fields->>'flags', '') end))
           - case when v_changed then 'reviewed' else '' end
   where r.device_id = v_device and upper(r.matric_number) = v_old;
  get diagnostics v_count = row_count;

  insert into student_edit_log (device_id, old_matric, new_matric) values (v_device, v_old, v_new);

  return jsonb_build_object('matricNumber', v_new, 'recordsUpdated', v_count, 'profileUpdated', v_reg);
end $$;
revoke all on function update_my_details(jsonb) from public;
grant execute on function update_my_details(jsonb) to anon, authenticated;

-- ============================================================
-- Attendly — Personal class codes, issued by the server.
-- Run AFTER security-fixes.sql. Safe to run more than once.
--
-- A student asks for their code with matric + name + level. The server
-- checks those against their attendance record, then returns the code they
-- already have, or creates a unique one and saves it on their records.
-- Asking again (any phone, any time) always returns the same code.
-- ============================================================

create or replace function claim_class_code(p_matric text, p_name text, p_level text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_matric   text := upper(trim(coalesce(p_matric, '')));
  v_name     text := lower(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'));
  v_level    text := trim(coalesce(p_level, ''));
  r          attendance_records%rowtype;
  v_code     text;
  v_settings jsonb;
  v_prefix   text;
  v_format   text;
  v_try      int := 0;
begin
  if v_matric = '' or v_name = '' then
    return jsonb_build_object('error', 'invalid');
  end if;

  select * into r from attendance_records
   where upper(matric_number) = v_matric
   order by submitted_at desc limit 1;
  if r.id is null then
    return jsonb_build_object('error', 'not_signed');
  end if;

  -- The registered profile (if any) is the source of truth for the name
  if lower(regexp_replace(trim(coalesce(
       (select full_name from students where matric_number = v_matric), r.full_name)), '\s+', ' ', 'g')) <> v_name then
    return jsonb_build_object('error', 'name_mismatch');
  end if;
  if v_level <> '' and coalesce(r.level, '') <> '' and r.level <> v_level then
    return jsonb_build_object('error', 'level_mismatch');
  end if;

  -- Already has a code: always the same one
  select assigned_class_code into v_code from attendance_records
   where upper(matric_number) = v_matric and assigned_class_code is not null
   order by submitted_at desc limit 1;
  if v_code is not null then
    return jsonb_build_object('code', v_code, 'existing', true);
  end if;

  select data into v_settings from admin_settings where id = 'default';
  if coalesce((v_settings->>'classCodeEnabled')::boolean, false) is not true then
    return jsonb_build_object('error', 'disabled');
  end if;
  v_prefix := coalesce(nullif(trim(v_settings->>'classCode'), ''), nullif(r.course_code, ''), 'CLASS');
  v_format := coalesce(v_settings->>'classCodeFormat', 'numbers');

  loop
    v_try := v_try + 1;
    v_code := v_prefix || '-' || case
      when v_format = 'id' then upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4))
      else (1000 + floor(random() * 9000))::int::text end;
    exit when not exists (select 1 from attendance_records where assigned_class_code = v_code);
    if v_try > 40 then
      v_code := v_prefix || '-' || upper(substr(md5(v_matric || clock_timestamp()::text), 1, 6));
      exit;
    end if;
  end loop;

  update attendance_records set assigned_class_code = v_code where upper(matric_number) = v_matric;
  return jsonb_build_object('code', v_code, 'existing', false);
end $$;
revoke all on function claim_class_code(text, text, text) from public;
grant execute on function claim_class_code(text, text, text) to anon, authenticated;

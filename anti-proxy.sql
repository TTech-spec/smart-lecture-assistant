-- anti-proxy.sql
-- Stops one student marking attendance for a friend from another browser.
--
-- Every check-in now sends the selfie's face fingerprint (128 numbers, not the
-- photo). The server compares it with:
--   * everyone already checked in on this link today: the same face under a
--     different name is refused ("same_face"); a close-but-unsure match is
--     flagged for review;
--   * every other student's face on file: a selfie that looks like someone
--     else's registered face is flagged ("face_is_other_student").
-- Switching browser changes the phone ID, but not the face.
--
-- Also: an imported student with no face on file is no longer tied to the
-- first phone that checks in as them (a friend's phone could have claimed
-- them), and a face can't be added to a record if it matches someone else's
-- check-in selfie.
--
-- Safe to run more than once. Run after student-import.sql.

begin;

alter table public.attendance_records add column if not exists selfie_descriptor double precision[];

do $$
declare
  def text;
  marker   constant text := '-- anti-proxy v1';
  decl_at  constant text := '  v_custom   jsonb;';
  start_at constant text := '  -- Registered profile wins over whatever was typed';
  old_bind constant text := 'if coalesce(st.device_id, '''') = '''' then';
  new_bind constant text := 'if coalesce(st.device_id, '''') = '''' and coalesce(array_length(st.descriptor, 1), 0) = 128 then';
  old_cols constant text := 'custom_fields, assigned_class_code, link_id)';
  new_cols constant text := 'custom_fields, assigned_class_code, link_id, selfie_descriptor)';
  old_vals constant text := 'v_custom, v_class_code, l.id);';
  new_vals constant text := 'v_custom, v_class_code, l.id, v_sdesc);';
  block    constant text := $blk$  -- anti-proxy v1: the same face can't check in under two names
  if not v_help then
    begin
      select array_agg(x::double precision) into v_sdesc
        from jsonb_array_elements_text(case when jsonb_typeof(p->'faceDescriptor') = 'array' then p->'faceDescriptor' else '[]'::jsonb end) as t(x);
    exception when others then v_sdesc := null;
    end;
    if coalesce(array_length(v_sdesc, 1), 0) <> 128 then
      v_sdesc := null;
    else
      declare
        v_other_name text; v_other_d double precision;
      begin
        -- Someone already checked in on this link with this face?
        select r.full_name, face_distance(r.selfie_descriptor, v_sdesc) into v_other_name, v_other_d
          from attendance_records r
         where r.link_id = l.id and upper(r.matric_number) <> v_matric
           and coalesce(array_length(r.selfie_descriptor, 1), 0) = 128
         order by face_distance(r.selfie_descriptor, v_sdesc) limit 1;
        if v_other_d is not null and v_other_d < 0.38 then
          insert into attendance_attempts (link_id, device_id, matric, ip, reason, detail, lat, lng, accuracy)
            values (l.id, v_device, v_matric, v_ip, 'same_face', left(v_other_name, 60), v_lat, v_lng, v_acc);
          return jsonb_build_object('error', 'same_face');
        elsif v_other_d is not null and v_other_d < 0.48 then
          v_flags := array_append(v_flags, 'same_face_maybe');
        end if;
        -- Looks like another student's face on file?
        v_other_name := null; v_other_d := null;
        select s.full_name, face_distance(s.descriptor, v_sdesc) into v_other_name, v_other_d
          from students s
         where s.matric_number <> v_matric and coalesce(array_length(s.descriptor, 1), 0) = 128
         order by face_distance(s.descriptor, v_sdesc) limit 1;
        if v_other_d is not null and v_other_d < 0.42 then
          v_flags := array_append(v_flags, 'face_is_other_student');
        end if;
      end;
    end if;
  end if;

$blk$;
begin
  select pg_get_functiondef('public.submit_attendance(jsonb)'::regprocedure) into def;
  if position(marker in def) > 0 then
    raise notice 'submit_attendance already has anti-proxy v1';
    return;
  end if;
  if position('student-import v1' in def) = 0 then
    raise exception 'run student-import.sql first';
  end if;
  if position(decl_at in def) = 0 or position(start_at in def) = 0 or position(old_bind in def) = 0
     or position(old_cols in def) = 0 or position(old_vals in def) = 0 then
    raise exception 'submit_attendance looks different than expected: nothing was changed';
  end if;
  def := replace(def, decl_at, decl_at || E'\n  v_sdesc    double precision[];');
  def := replace(def, start_at, block || start_at);
  def := replace(def, old_bind, new_bind);
  def := replace(def, old_cols, new_cols);
  def := replace(def, old_vals, new_vals);
  execute def;
  raise notice 'submit_attendance updated: anti-proxy v1';
end $$;

-- No face on file and no phone linked yet: don't call every phone "different"
do $$
declare
  def text;
  old_dev constant text := 'elsif st.device_id <> v_device then';
  new_dev constant text := 'elsif coalesce(st.device_id, '''') <> '''' and st.device_id <> v_device then';
begin
  select pg_get_functiondef('public.submit_attendance(jsonb)'::regprocedure) into def;
  if position(new_dev in def) > 0 then raise notice 'different-phone check already fixed'; return; end if;
  if position(old_dev in def) = 0 then raise exception 'submit_attendance looks different than expected: nothing was changed'; end if;
  execute replace(def, old_dev, new_dev);
  raise notice 'different-phone check fixed';
end $$;

-- A face can't be added to a record when it matches another student's check-in selfie
do $$
declare
  def text;
  marker  constant text := '-- anti-proxy v1';
  anchor  constant text := '  if v_other is not null then raise exception ''face_exists''; end if;';
  extra   constant text := $x$  -- anti-proxy v1: same face as someone else's check-in selfie
  if v_other is null then
    select r.matric_number into v_other from attendance_records r
     where upper(r.matric_number) <> st.matric_number and coalesce(array_length(r.selfie_descriptor, 1), 0) = 128
       and face_distance(r.selfie_descriptor, v_desc) < 0.40
     limit 1;
  end if;
$x$;
begin
  select pg_get_functiondef('public.add_my_face(text, text, jsonb, text)'::regprocedure) into def;
  if position(marker in def) > 0 then
    raise notice 'add_my_face already has anti-proxy v1';
    return;
  end if;
  if position(anchor in def) = 0 then
    raise exception 'add_my_face looks different than expected: nothing was changed';
  end if;
  def := replace(def, anchor, extra || anchor);
  execute def;
  raise notice 'add_my_face updated: anti-proxy v1';
end $$;

commit;

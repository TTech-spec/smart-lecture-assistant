-- simple-checkin.sql
-- Students no longer type a room code. They enter their matric number, their
-- details and personal class code fill in, they take a live selfie and submit.
-- Being in the hall is proved by live GPS; being the right person by the face match.
-- A lecturer can still switch the projector code on for a link ("Ask for the projector code").
-- Safe to run more than once. Run after gps-help.sql.

alter table public.attendance_links add column if not exists require_room_code boolean not null default false;

-- Students' link lookup also says whether a projector code is needed
drop function if exists public.get_attendance_link(text);
create function public.get_attendance_link(p_token text)
returns table (id text, course_code text, title text, token text, is_active boolean,
               created_by text, created_at timestamptz, expires_at timestamptz,
               assign_class_code boolean, link_type text, test_id text,
               has_location boolean, anchor_radius int, require_room_code boolean)
language sql stable security definer set search_path = public as $$
  select l.id, l.course_code, l.title, l.token, l.is_active, l.created_by, l.created_at, l.expires_at,
         l.assign_class_code, l.link_type, l.test_id,
         l.anchor_lat is not null, l.anchor_radius, l.require_room_code
    from attendance_links l
   where l.token = p_token;
$$;
revoke all on function public.get_attendance_link(text) from public;
grant execute on function public.get_attendance_link(text) to anon, authenticated;

-- Check-in: only check the projector code when the link asks for it
do $$
declare
  def text;
  old_check constant text := 'if not v_help and (s is null or v_code not in (';
  new_check constant text := 'if not v_help and coalesce(l.require_room_code, false) and (s is null or v_code not in (';
begin
  select pg_get_functiondef('public.submit_attendance(jsonb)'::regprocedure) into def;
  if position(new_check in def) > 0 then
    raise notice 'submit_attendance already updated';
  elsif position(old_check in def) = 0 then
    raise exception 'submit_attendance looks different than expected: run gps-help.sql first, then this file';
  else
    execute replace(def, old_check, new_check);
    raise notice 'submit_attendance updated: projector code only when the link asks for it';
  end if;
end $$;

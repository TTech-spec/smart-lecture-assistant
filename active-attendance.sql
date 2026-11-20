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

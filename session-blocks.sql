-- ============================================================
-- Attendly — Block / unblock a student for one check-in session.
-- Run AFTER security-fixes.sql. Safe to run more than once.
--
-- A lecturer blocks a matric number for a session (e.g. a student sent out
-- of class). The server then refuses that student's check-in for that
-- session, wherever they are. Unblocking deletes the row.
-- ============================================================

create table if not exists session_blocks (
  link_id    text not null,
  matric     text not null,          -- stored upper-case
  reason     text,
  blocked_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (link_id, matric)
);

alter table session_blocks enable row level security;
drop policy if exists "lecturers manage blocks" on session_blocks;
create policy "lecturers manage blocks" on session_blocks
  for all to authenticated using (is_lecturer()) with check (is_lecturer());

-- Students never touch the table; the check runs inside the insert that
-- submit_attendance() makes, so it can't be skipped.
create or replace function refuse_blocked_student()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.link_id is not null and exists (
    select 1 from session_blocks b
     where b.link_id = new.link_id and b.matric = upper(trim(new.matric_number))
  ) then
    raise exception 'blocked';
  end if;
  return new;
end $$;

drop trigger if exists trg_refuse_blocked_student on attendance_records;
create trigger trg_refuse_blocked_student
  before insert on attendance_records
  for each row execute function refuse_blocked_student();

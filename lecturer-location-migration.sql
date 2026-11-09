-- Lecturer-verified location for attendance links.
-- Run once in the Supabase SQL Editor. Safe to run more than once.
alter table attendance_links add column if not exists anchor_lat double precision;
alter table attendance_links add column if not exists anchor_lng double precision;
alter table attendance_links add column if not exists anchor_accuracy double precision;
alter table attendance_links add column if not exists anchor_radius integer;
alter table attendance_links add column if not exists anchor_at timestamptz;

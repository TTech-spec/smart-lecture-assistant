-- ============================================================
-- Attendly — Test Device Lock Migration
-- Run this in: Supabase Dashboard → SQL Editor
-- This is ADDITIVE — it does not drop or rename any existing tables/columns.
--
-- Attendance already enforces "one device per course per day" via the
-- device_id column on attendance_records (see attendance-links-migration.sql).
-- Tests had no equivalent — a student could retake a test from the same
-- phone just by entering a different matric number. This adds the same
-- device-level lock to test_submissions.
-- ============================================================

ALTER TABLE test_submissions
  ADD COLUMN IF NOT EXISTS device_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_test_submissions_device_test
  ON test_submissions (device_id, test_id);

-- Same pattern as every other table in this project: RLS disabled, anon key
-- has full access.
ALTER TABLE test_submissions DISABLE ROW LEVEL SECURITY;

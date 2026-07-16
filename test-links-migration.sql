-- ============================================================
-- Attendly — Test Links Migration
-- Run this in: Supabase Dashboard → SQL Editor
-- This is ADDITIVE — it does not drop or rename any existing tables/columns.
-- ============================================================

-- ── Add link_type and test_id columns to attendance_links table ─────────────────
-- Safe to run even if the columns already exist.
ALTER TABLE attendance_links
  ADD COLUMN IF NOT EXISTS link_type TEXT DEFAULT 'attendance',
  ADD COLUMN IF NOT EXISTS test_id TEXT DEFAULT NULL;

-- ── New table: test_links ───────────────────────────────────────────────────────
-- Represents a shareable URL specifically for taking tests.
-- Links to a specific test in test_configs table.
CREATE TABLE IF NOT EXISTS test_links (
  id          TEXT        PRIMARY KEY,
  test_id     TEXT        NOT NULL,
  course_code TEXT        NOT NULL DEFAULT '',
  title       TEXT        NOT NULL DEFAULT '',
  token       TEXT        NOT NULL UNIQUE,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_test_links_token      ON test_links (token);
CREATE INDEX IF NOT EXISTS idx_test_links_test_id    ON test_links (test_id);
CREATE INDEX IF NOT EXISTS idx_test_links_course     ON test_links (course_code);
CREATE INDEX IF NOT EXISTS idx_test_links_is_active  ON test_links (is_active);

-- ── Row Level Security ─────────────────────────────────────────────────────────
-- Following the same pattern as attendance_links (RLS disabled for anon key access)
ALTER TABLE test_links DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Notes:
-- 1. This migration enables lecturers to create shareable links specifically for tests
-- 2. Students can access tests via /test/{token} URL
-- 3. Each test link is associated with a specific test from test_configs table
-- 4. Test links have expiration dates and can be disabled
-- ============================================================

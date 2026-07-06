-- ============================================================
-- Attendly — Attendance Links Migration
-- Run this in: Supabase Dashboard → SQL Editor
-- This is ADDITIVE — it does not drop or rename any existing tables/columns.
-- ============================================================

-- ── New table: attendance_links ───────────────────────────────────────────────
-- Represents a shareable URL the lecturer generates for a class session.
-- Distinct from attendance_sessions (which tracks form open/close events).
CREATE TABLE IF NOT EXISTS attendance_links (
  id          TEXT        PRIMARY KEY,
  course_code TEXT        NOT NULL DEFAULT '',
  title       TEXT        NOT NULL DEFAULT '',
  token       TEXT        NOT NULL UNIQUE,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by  TEXT        NOT NULL DEFAULT 'admin',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_links_token      ON attendance_links (token);
CREATE INDEX IF NOT EXISTS idx_attendance_links_course     ON attendance_links (course_code);
CREATE INDEX IF NOT EXISTS idx_attendance_links_is_active  ON attendance_links (is_active);

-- ── Extend attendance_records: add link_id column ─────────────────────────────
-- References which shareable link the student used to mark attendance.
-- Nullable so all existing records (marked before this feature) remain valid.
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS link_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_records_link_id ON attendance_records (link_id);

-- ── Row Level Security ─────────────────────────────────────────────────────────
-- The existing tables all have RLS DISABLED (anon key has full access).
-- We follow the same pattern for attendance_links so the app continues to work
-- with the anon key. If you later enable Supabase Auth, you can enable these
-- policies to tighten access.

ALTER TABLE attendance_links DISABLE ROW LEVEL SECURITY;

-- ── Optional: enable RLS with policies (uncomment if you add Supabase Auth) ───
--
-- ALTER TABLE attendance_links ENABLE ROW LEVEL SECURITY;
--
-- -- Only authenticated users can read links for their own course
-- CREATE POLICY "links_select" ON attendance_links
--   FOR SELECT USING (auth.role() = 'authenticated');
--
-- -- Only the creator can insert a link
-- CREATE POLICY "links_insert" ON attendance_links
--   FOR INSERT WITH CHECK (auth.uid()::text = created_by);
--
-- -- Only the creator can update (disable) a link
-- CREATE POLICY "links_update" ON attendance_links
--   FOR UPDATE USING (auth.uid()::text = created_by);
--
-- -- Students can insert their own attendance_record only if the referenced
-- -- link is active and not yet expired
-- CREATE POLICY "records_insert_via_link" ON attendance_records
--   FOR INSERT WITH CHECK (
--     link_id IS NULL OR EXISTS (
--       SELECT 1 FROM attendance_links al
--       WHERE al.id = link_id
--         AND al.is_active = TRUE
--         AND al.expires_at > NOW()
--     )
--   );

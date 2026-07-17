-- ============================================================
-- Attendly — Dashboard Preferences Migration
-- Run this in: Supabase Dashboard → SQL Editor
-- This is ADDITIVE — it does not drop or rename any existing tables/columns.
--
-- src/lib/dashboard-preferences.ts reads/writes this table. It backs two
-- lecturer-facing features:
--   1. Dashboard color theme — synced here (not localStorage) so the same
--      theme shows on every device the lecturer signs into.
--   2. Developer access — the email address the lecturer enters to grant a
--      developer access, submitted straight to this table.
-- Singleton row (id = 'default'), same pattern as admin_settings.
-- ============================================================

CREATE TABLE IF NOT EXISTS dashboard_preferences (
  id                  TEXT        PRIMARY KEY DEFAULT 'default',
  theme_id            TEXT        NOT NULL DEFAULT 'default',
  dev_access_enabled  BOOLEAN     NOT NULL DEFAULT FALSE,
  dev_access_email    TEXT        DEFAULT NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Same pattern as every other table in this project: RLS disabled, anon key
-- has full access (src/lib/supabase.ts uses the anon key for all reads/writes).
ALTER TABLE dashboard_preferences DISABLE ROW LEVEL SECURITY;

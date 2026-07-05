-- ============================================================
-- Attendly — Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Attendance records submitted by students
CREATE TABLE IF NOT EXISTS attendance_records (
  id              TEXT        PRIMARY KEY,
  full_name       TEXT        NOT NULL,
  matric_number   TEXT        NOT NULL,
  department      TEXT        NOT NULL,
  phone           TEXT        DEFAULT '',
  course_code     TEXT        NOT NULL,
  topic           TEXT        DEFAULT '',
  level           TEXT        DEFAULT '',
  gender          TEXT        NOT NULL,
  submitted_at    TIMESTAMPTZ NOT NULL,
  day_key         TEXT        NOT NULL,
  device_id       TEXT        NOT NULL,
  distance_meters FLOAT       DEFAULT 0,
  lat             FLOAT,
  lng             FLOAT,
  session_id      TEXT        DEFAULT '',
  custom_fields   JSONB       DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Test / quiz configurations uploaded by the lecturer
CREATE TABLE IF NOT EXISTS test_configs (
  id               TEXT        PRIMARY KEY,
  title            TEXT        NOT NULL,
  course_code      TEXT        NOT NULL,
  duration_minutes INTEGER     NOT NULL DEFAULT 30,
  is_active        BOOLEAN     DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL,
  questions        JSONB       NOT NULL DEFAULT '[]',
  test_type        TEXT        NOT NULL DEFAULT 'C1'
);

ALTER TABLE test_configs ADD COLUMN IF NOT EXISTS test_type TEXT NOT NULL DEFAULT 'C1';

-- Student test submissions
CREATE TABLE IF NOT EXISTS test_submissions (
  id             TEXT        PRIMARY KEY,
  test_id        TEXT        NOT NULL REFERENCES test_configs(id) ON DELETE CASCADE,
  student_name   TEXT        NOT NULL,
  matric_number  TEXT        NOT NULL,
  level          TEXT        DEFAULT '',
  answers        JSONB       NOT NULL DEFAULT '[]',
  score          INTEGER     NOT NULL DEFAULT 0,
  total          INTEGER     NOT NULL DEFAULT 0,
  submitted_at   TIMESTAMPTZ NOT NULL,
  cheated        BOOLEAN     DEFAULT FALSE,
  test_type      TEXT        DEFAULT 'C1'
);

ALTER TABLE test_submissions ADD COLUMN IF NOT EXISTS level TEXT DEFAULT '';
ALTER TABLE test_submissions ADD COLUMN IF NOT EXISTS test_type TEXT DEFAULT 'C1';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_day_key     ON attendance_records (day_key);
CREATE INDEX IF NOT EXISTS idx_attendance_course_code ON attendance_records (course_code);
CREATE INDEX IF NOT EXISTS idx_attendance_matric      ON attendance_records (matric_number);
CREATE INDEX IF NOT EXISTS idx_test_configs_active    ON test_configs (is_active);
CREATE INDEX IF NOT EXISTS idx_test_submissions_test  ON test_submissions (test_id);

-- Admin settings (single-row singleton)
CREATE TABLE IF NOT EXISTS admin_settings (
  id   TEXT PRIMARY KEY DEFAULT 'default',
  data JSONB NOT NULL DEFAULT '{}'
);

-- Attendance sessions (form-open events)
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id          TEXT        PRIMARY KEY,
  course_code TEXT        DEFAULT '',
  level       TEXT        DEFAULT '',
  topic       TEXT        DEFAULT '',
  opened_at   TIMESTAMPTZ NOT NULL,
  closed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_opened ON attendance_sessions (opened_at);

-- Study materials uploaded by the lecturer for students to read ahead of exams/tests
CREATE TABLE IF NOT EXISTS materials (
  id           TEXT        PRIMARY KEY,
  title        TEXT        NOT NULL,
  description  TEXT        DEFAULT '',
  file_type    TEXT        NOT NULL DEFAULT 'link',
  access_type  TEXT        NOT NULL DEFAULT 'free',
  price        FLOAT       DEFAULT 0,
  currency     TEXT        DEFAULT 'NGN',
  url          TEXT        NOT NULL,
  course_code  TEXT        DEFAULT '',
  topic        TEXT        DEFAULT '',
  uploaded_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_materials_course_code ON materials (course_code);
CREATE INDEX IF NOT EXISTS idx_materials_access_type ON materials (access_type);

-- Payment records for OPay transactions
CREATE TABLE IF NOT EXISTS payment_records (
  id              TEXT        PRIMARY KEY,
  order_id        TEXT        NOT NULL UNIQUE,
  material_id     TEXT        NOT NULL,
  material_title  TEXT        NOT NULL,
  amount          FLOAT       NOT NULL,
  currency        TEXT        NOT NULL DEFAULT 'NGN',
  status          TEXT        NOT NULL DEFAULT 'pending',
  customer_email  TEXT        NOT NULL,
  customer_name   TEXT        NOT NULL,
  customer_phone  TEXT        NOT NULL,
  pay_method      TEXT        DEFAULT 'BankCard',
  transaction_id  TEXT,
  reference       TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_records_material_id ON payment_records (material_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_customer_email ON payment_records (customer_email);
CREATE INDEX IF NOT EXISTS idx_payment_records_status ON payment_records (status);

-- Row Level Security (disabled — anon key has full access)
ALTER TABLE attendance_records   DISABLE ROW LEVEL SECURITY;
ALTER TABLE test_configs         DISABLE ROW LEVEL SECURITY;
ALTER TABLE test_submissions     DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin_settings       DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_sessions  DISABLE ROW LEVEL SECURITY;
ALTER TABLE materials            DISABLE ROW LEVEL SECURITY;
ALTER TABLE payment_records      DISABLE ROW LEVEL SECURITY;

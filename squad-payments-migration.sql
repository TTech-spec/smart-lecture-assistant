-- ============================================================
-- Attendly — Squad Payments Migration
-- Run this in: Supabase Dashboard → SQL Editor
-- This is ADDITIVE — it does not drop or rename any existing tables/columns.
--
-- src/lib/squad.ts (client) and src/lib/squad-webhook.server.ts (webhook)
-- both read/write this table. Without it, Squad payment records only ever
-- persist to localStorage — the Supabase sync silently fails (caught and
-- logged, never thrown) and the payment webhook has nothing to update.
-- ============================================================

CREATE TABLE IF NOT EXISTS squad_payment_records (
  id                       TEXT        PRIMARY KEY,
  transaction_ref          TEXT        NOT NULL UNIQUE,
  material_id              TEXT        NOT NULL,
  material_title           TEXT        NOT NULL,
  charged_amount           FLOAT       NOT NULL,
  lecturer_amount          FLOAT       NOT NULL,
  platform_fee             FLOAT       NOT NULL,
  transfer_fee             FLOAT       NOT NULL,
  squad_fee                FLOAT       NOT NULL,
  currency                 TEXT        NOT NULL DEFAULT 'NGN',
  status                   TEXT        NOT NULL DEFAULT 'pending',
  customer_email           TEXT        NOT NULL,
  customer_name            TEXT        NOT NULL,
  customer_phone           TEXT        NOT NULL,
  lecturer_account_number  TEXT        DEFAULT NULL,
  lecturer_bank_code       TEXT        DEFAULT NULL,
  lecturer_account_name    TEXT        DEFAULT NULL,
  payout_ref               TEXT        DEFAULT NULL,
  payout_status            TEXT        DEFAULT NULL,
  created_at               TIMESTAMPTZ NOT NULL,
  updated_at               TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_squad_payment_records_transaction_ref ON squad_payment_records (transaction_ref);
CREATE INDEX IF NOT EXISTS idx_squad_payment_records_material_id     ON squad_payment_records (material_id);
CREATE INDEX IF NOT EXISTS idx_squad_payment_records_status          ON squad_payment_records (status);

-- Same pattern as every other table in this project: RLS disabled, anon key
-- has full access. The webhook (src/lib/squad-webhook.server.ts) also uses
-- the anon key, so it needs the same access this table already grants the
-- browser client in src/lib/squad.ts.
ALTER TABLE squad_payment_records DISABLE ROW LEVEL SECURITY;

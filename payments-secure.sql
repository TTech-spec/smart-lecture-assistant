-- ============================================================
-- Attendly — Secure payments (run AFTER security-fixes.sql).
-- Safe to run more than once.
--
-- Before: prices, fees, payout bank accounts and "paid" status were set in
-- the browser and stored in tables anyone could edit, and paid files sat in a
-- public bucket. After:
--  * Only lecturers can read or change materials (incl. bank details),
--    payment records and purchases. Students list materials through
--    list_materials(), which never returns the link to a paid file.
--  * Payment records and purchases are written only by the server (service
--    role key), after Squad confirms the payment and the amount.
--  * A purchase gets a random access token; the server hands out a
--    short-lived link to the paid file only for a valid token.
--  * Paid files go in a private storage bucket, "materials-paid".
-- ============================================================

-- ── Materials: lecturers only; students use list_materials() ────────────────
alter table materials enable row level security;
drop policy if exists "lecturers manage materials" on materials;
create policy "lecturers manage materials" on materials
  for all to authenticated using (is_lecturer()) with check (is_lecturer());

create or replace function list_materials()
returns table (id text, title text, description text, file_type text, access_type text,
               price double precision, currency text, url text, course_code text,
               topic text, uploaded_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.description, m.file_type, m.access_type,
         m.price, m.currency,
         case when m.access_type = 'paid' then '' else m.url end,  -- paid links only via the server
         m.course_code, m.topic, m.uploaded_at
    from materials m
   order by m.uploaded_at desc;
$$;
revoke all on function list_materials() from public;
grant execute on function list_materials() to anon, authenticated;

-- ── Payment records: server writes, lecturers read ──────────────────────────
alter table squad_payment_records enable row level security;
alter table squad_payment_records add column if not exists lecturer_paid boolean not null default false;
drop policy if exists "lecturers read payments" on squad_payment_records;
create policy "lecturers read payments" on squad_payment_records
  for select to authenticated using (is_lecturer());

-- ── Purchases: server writes, lecturers read; random access token ───────────
alter table material_purchases enable row level security;
alter table material_purchases add column if not exists access_token text;
alter table material_purchases add column if not exists transaction_ref text;
create unique index if not exists idx_material_purchases_token on material_purchases (access_token);
create unique index if not exists idx_material_purchases_txref on material_purchases (transaction_ref);
drop policy if exists "lecturers read purchases" on material_purchases;
create policy "lecturers read purchases" on material_purchases
  for select to authenticated using (is_lecturer());

-- ── Payout log (every transfer the server attempts) ─────────────────────────
create table if not exists payouts (
  id              bigserial primary key,
  kind            text not null,          -- 'sale' | 'retry' | 'platform'
  transaction_ref text,                   -- the sale it belongs to
  transfer_ref    text not null unique,
  amount          double precision not null,
  account_number  text,
  bank_code       text,
  status          text not null,          -- 'sent' | 'failed'
  message         text,
  created_at      timestamptz not null default now()
);
alter table payouts enable row level security;
drop policy if exists "lecturers read payouts" on payouts;
create policy "lecturers read payouts" on payouts
  for select to authenticated using (is_lecturer());

-- ── Private bucket for paid files (only when Supabase Storage exists) ───────
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('materials-paid', 'materials-paid', false)
    on conflict (id) do update set public = false;

    execute 'drop policy if exists "lecturers upload paid files" on storage.objects';
    execute 'create policy "lecturers upload paid files" on storage.objects
               for insert to authenticated with check (bucket_id = ''materials-paid'' and public.is_lecturer())';
    execute 'drop policy if exists "lecturers delete paid files" on storage.objects';
    execute 'create policy "lecturers delete paid files" on storage.objects
               for delete to authenticated using (bucket_id = ''materials-paid'' and public.is_lecturer())';
    execute 'drop policy if exists "lecturers read paid files" on storage.objects';
    execute 'create policy "lecturers read paid files" on storage.objects
               for select to authenticated using (bucket_id = ''materials-paid'' and public.is_lecturer())';
  end if;
end $$;

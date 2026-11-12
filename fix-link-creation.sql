-- ============================================================
-- Attendly — Fix "can't create attendance link" on Supabase.
-- Run once, any time after security-hardening.sql. Safe to run again.
--
-- Supabase keeps pgcrypto (gen_random_bytes, hmac) in the "extensions"
-- schema. The class-code functions only searched "public", so creating a
-- link failed with "function gen_random_bytes(integer) does not exist" and
-- the projector code could not be worked out. This lets them find it.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

alter function attendance_links_make_secret() set search_path = public, extensions;
alter function room_code_for(text, bigint)     set search_path = public, extensions;

-- Give every existing link a secret (links made while this was broken have none)
insert into attendance_link_secrets (link_id, code_secret)
select id, encode(extensions.gen_random_bytes(32), 'hex') from attendance_links
on conflict (link_id) do nothing;

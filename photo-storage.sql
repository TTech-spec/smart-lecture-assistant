-- ============================================================
-- Attendly — Store check-in selfies as files instead of inside each record.
-- Run once (safe to run again). Then run gps-help.sql (or scale-2000.sql)
-- again so check-ins accept the small "photoThumb" picture too.
--
-- Before: every selfie (~60 KB of text) lived inside its attendance record,
-- so the Records page downloaded all of them every time. Now the phone
-- uploads the selfie and a small thumbnail to the "checkin-photos" bucket and
-- the record keeps only their links. Files have random names that can't be
-- guessed or listed; only .jpg images up to 400 KB are accepted.
-- ============================================================

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Supabase Storage not found; skipping.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('checkin-photos', 'checkin-photos', true, 409600, array['image/jpeg'])
  on conflict (id) do update
    set public = true, file_size_limit = 409600, allowed_mime_types = array['image/jpeg'];

  -- Students (signed out) may only ADD new files under checkins/ ; nobody can
  -- list, change or delete them through the API except lecturers.
  execute 'drop policy if exists "students upload checkin photos" on storage.objects';
  execute $p$create policy "students upload checkin photos" on storage.objects
             for insert to anon, authenticated
             with check (bucket_id = 'checkin-photos' and name like 'checkins/%' and name ~ '^checkins/[0-9-]{10}/[a-f0-9-]{36}(_t)?\.jpg$')$p$;
  execute 'drop policy if exists "lecturers manage checkin photos" on storage.objects';
  execute $p$create policy "lecturers manage checkin photos" on storage.objects
             for all to authenticated
             using (bucket_id = 'checkin-photos' and public.is_lecturer())
             with check (bucket_id = 'checkin-photos' and public.is_lecturer())$p$;
end $$;

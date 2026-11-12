-- Saves the test "integrity" flags (focus lost, split screen, copy attempts)
alter table public.test_submissions add column if not exists integrity jsonb;

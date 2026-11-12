-- Saves the test "integrity" flags (focus lost, split screen, copy attempts)
alter table public.test_submissions add column if not exists integrity jsonb;
-- Theory (written) answers, how they were typed, and the lecturer's marks
alter table public.test_submissions add column if not exists theory jsonb;

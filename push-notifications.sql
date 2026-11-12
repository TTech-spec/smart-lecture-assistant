-- ============================================================
-- Attendly — Notifications on students' phones.
-- Run AFTER security-fixes.sql. Safe to run more than once.
--
-- Students who tap "Turn on notifications" save their phone's push address
-- here. A lecturer writes a notice ("CSC401 check-in is open"); the server
-- wakes every phone, and each phone fetches the newest notice to show it.
-- The keys that sign these wake-ups are made by the server on first use and
-- kept in app_keys, which only the server (service role) can read.
-- ============================================================

create table if not exists push_subscriptions (
  endpoint    text primary key,
  p256dh      text,
  auth        text,
  matric      text,
  device_id   text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
alter table push_subscriptions enable row level security;
drop policy if exists "lecturers read subscriptions" on push_subscriptions;
create policy "lecturers read subscriptions" on push_subscriptions for select to authenticated using (is_lecturer());

create table if not exists notices (
  id          bigserial primary key,
  title       text not null,
  body        text not null default '',
  url         text not null default '/',
  course_code text,
  created_at  timestamptz not null default now(),
  created_by  uuid
);
alter table notices enable row level security;
drop policy if exists "lecturers manage notices" on notices;
create policy "lecturers manage notices" on notices for all to authenticated using (is_lecturer()) with check (is_lecturer());

create table if not exists app_keys (
  name  text primary key,
  value text not null
);
alter table app_keys enable row level security;   -- no policies: server (service role) only

-- Student: save this phone's push address (any student, no login)
create or replace function save_push_subscription(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_endpoint text := left(coalesce(p->>'endpoint', ''), 1000);
begin
  if v_endpoint !~ '^https://' then raise exception 'invalid'; end if;
  insert into push_subscriptions (endpoint, p256dh, auth, matric, device_id)
  values (v_endpoint, left(p->>'p256dh', 200), left(p->>'auth', 100),
          nullif(upper(trim(coalesce(p->>'matric', ''))), ''), left(coalesce(p->>'deviceId', ''), 80))
  on conflict (endpoint) do update
    set matric = coalesce(excluded.matric, push_subscriptions.matric),
        device_id = excluded.device_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
revoke all on function save_push_subscription(jsonb) from public;
grant execute on function save_push_subscription(jsonb) to anon, authenticated;

-- Student: turn notifications off on this phone
create or replace function remove_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint;
$$;
revoke all on function remove_push_subscription(text) from public;
grant execute on function remove_push_subscription(text) to anon, authenticated;

-- Phones: the newest notice, shown when a wake-up arrives (notices are public announcements)
create or replace function latest_notice()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'title', title, 'body', body, 'url', url, 'createdAt', created_at)
    from notices order by created_at desc limit 1;
$$;
revoke all on function latest_notice() from public;
grant execute on function latest_notice() to anon, authenticated;

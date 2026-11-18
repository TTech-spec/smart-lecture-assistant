-- qr-checkin.sql
-- Scanning the projector QR fills in the projector code for the student.
-- The QR holds the live code. When the student opens it, the phone swaps that
-- code for a "room pass" that lasts 10 minutes on that phone only, so the code
-- changing every 30 seconds while they take a selfie doesn't matter.
-- Someone at home can't get a pass: they'd need the code on the screen right now.
-- Safe to run more than once. Run after simple-checkin.sql.

create table if not exists public.room_passes (
  id         uuid primary key default gen_random_uuid(),
  link_id    text not null,
  device_id  text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.room_passes enable row level security;
revoke all on public.room_passes from anon, authenticated;
create index if not exists room_passes_link_idx on public.room_passes (link_id, device_id);

-- Swap the code from the QR for a pass (code must be current or the previous one)
create or replace function public.claim_room_pass(p_token text, p_code text, p_device text)
returns uuid language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  l attendance_links%rowtype;
  s text;
  v_slot bigint := room_code_slot();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_dev  text := left(coalesce(p_device, ''), 80);
  v_id uuid;
begin
  if v_dev = '' then return null; end if;
  -- Same lock-out as check-in: 5 failures in 5 minutes from this phone
  if (select count(*) from attendance_attempts where at > now() - interval '5 minutes' and device_id = v_dev) >= 5 then
    return null;
  end if;
  select * into l from attendance_links where token = p_token;
  if l.id is null or not l.is_active or l.expires_at <= now() then return null; end if;
  select code_secret into s from attendance_link_secrets where link_id = l.id;
  if s is null or v_code not in (room_code_for(s, v_slot), room_code_for(s, v_slot - 1)) then
    insert into attendance_attempts (link_id, device_id, matric, ip, reason, detail)
      values (l.id, v_dev, '', request_ip(), 'wrong_code', 'qr:' || left(v_code, 10));
    return null;
  end if;
  delete from room_passes where expires_at < now() - interval '1 day';
  insert into room_passes (link_id, device_id) values (l.id, v_dev) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.claim_room_pass(text, text, text) from public;
grant execute on function public.claim_room_pass(text, text, text) to anon, authenticated;

create or replace function public.room_pass_ok(p_link text, p_pass text, p_device text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from room_passes
                  where id::text = coalesce(p_pass, '') and link_id = p_link
                    and device_id = coalesce(p_device, '') and expires_at > now());
$$;
revoke all on function public.room_pass_ok(text, text, text) from public;

-- Check-in: a valid room pass counts the same as typing the code
do $$
declare
  def text;
  old_check constant text := 'if not v_help and coalesce(l.require_room_code, false) and (s is null';
  new_check constant text := 'if not v_help and coalesce(l.require_room_code, false) and not room_pass_ok(l.id, p->>''roomPass'', v_device) and (s is null';
begin
  select pg_get_functiondef('public.submit_attendance(jsonb)'::regprocedure) into def;
  if position(new_check in def) > 0 then
    raise notice 'submit_attendance already accepts room passes';
  elsif position(old_check in def) = 0 then
    raise exception 'submit_attendance looks different than expected: run simple-checkin.sql first, then this file';
  else
    execute replace(def, old_check, new_check);
    raise notice 'submit_attendance updated: QR room pass accepted';
  end if;
end $$;

-- gps-zones.sql
-- Check-in no longer treats GPS as a plain yes or no. Each check-in lands in
-- one of three zones:
--   Green: GPS puts the phone inside the circle. Accepted, same reach as before.
--   Soft:  GPS is doubtful but the phone is on campus (within 1.5 km). Accepted
--          only with the code on the lecturer's screen (typed, or a room pass
--          from scanning the projector QR). Recorded with a "loc_code" flag, or
--          "loc_far" (goes to Review) beyond 500 m.
--   Hard:  no location, a fix worse than 1.5 km, or a phone over 1.5 km away.
--          Refused; only the lecturer scan gets past it.
-- Students with GPS trouble are no longer locked out for it, a whole class on
-- one Wi-Fi address can't lock each other out, and getting a room pass is never
-- blocked by GPS trouble. Wrong codes still lock a phone after 5 tries.
-- No table changes.
-- Run after gps-help.sql, simple-checkin.sql and qr-checkin.sql. Safe to run more than once.
-- (If gps-help.sql or scale-2000.sql is ever run again, re-run simple-checkin.sql,
--  qr-checkin.sql and this file, in that order.)

begin;

-- Swap the code from the QR for a pass (code must be current or the previous one).
-- Same as qr-checkin.sql, except only wrong codes count toward the lock-out.
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
  -- Lock-out: 5 wrong codes in 5 minutes from this phone (GPS trouble doesn't count)
  if (select count(*) from attendance_attempts
       where at > now() - interval '5 minutes' and device_id = v_dev and reason = 'wrong_code') >= 5 then
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

-- Check-in: replace the location section and loosen the locks for GPS trouble
do $$
declare
  def text; a int; b int;
  marker   constant text := '-- gps-zones v1';
  start_at constant text := 'if v_lat is null or v_lng is null then';
  end_at   constant text := 'v_gps := case when jsonb_typeof';
  old_lock constant text := 'and (device_id = v_device or matric = v_matric)) >= 5';
  new_lock constant text := 'and (device_id = v_device or matric = v_matric)
         and reason not in (''no_gps'', ''weak_gps'', ''need_room_code'')) >= 5
     or (not v_help and (select count(*) from attendance_attempts
       where at > now() - interval ''5 minutes'' and device_id = v_device) >= 20)';
  old_ip   constant text := 'and ip = v_ip) >= 60';
  new_ip   constant text := 'and ip = v_ip
         and reason not in (''no_gps'', ''weak_gps'', ''need_room_code'')) >= 60';
  section  constant text := $sec$-- gps-zones v1
  -- GPS alone passes only inside the circle (same ceiling as before, honest floors).
  -- A doubtful fix on campus needs the code / QR on the lecturer's screen.
  -- No fix, a fix worse than 1.5 km, or a phone over 1.5 km away is refused.
  declare
    v_proof boolean := false;
  begin
    v_radius := greatest(coalesce(v_radius, 100), 100);
    if v_help then
      v_dist := 0;
    elsif v_lat is null or v_lng is null then
      insert into attendance_attempts (link_id, device_id, matric, ip, reason)
        values (l.id, v_device, v_matric, v_ip, 'no_gps');
      return jsonb_build_object('error', 'no_gps');
    elsif v_acc is null or v_acc > 1500 then
      insert into attendance_attempts (link_id, device_id, matric, ip, reason, detail, lat, lng, accuracy)
        values (l.id, v_device, v_matric, v_ip, 'weak_gps', coalesce(round(v_acc)::text, ''), v_lat, v_lng, v_acc);
      return jsonb_build_object('error', 'weak_gps:' || least(round(coalesce(v_acc, 0)), 2000000000)::bigint);
    else
      v_dist := haversine_m(v_lat, v_lng, v_anchor_lat, v_anchor_lng);
      v_tol  := least(greatest(v_acc, 25), 75) + least(greatest(coalesce(v_anchor_acc, 0), 30), 50);
      if v_acc <= 150 and v_dist <= v_radius + v_tol then
        null;  -- green: GPS alone is enough
      elsif v_dist > 1500 then
        insert into attendance_attempts (link_id, device_id, matric, ip, reason, detail, lat, lng, accuracy)
          values (l.id, v_device, v_matric, v_ip, 'out_of_range', round(v_dist)::text, v_lat, v_lng, v_acc);
        return jsonb_build_object('error', 'out_of_range:far');
      else
        v_proof := room_pass_ok(l.id, p->>'roomPass', v_device)
                   or (s is not null and v_code <> ''
                       and v_code in (room_code_for(s, v_slot), room_code_for(s, v_slot - 1)));
        if not v_proof then
          insert into attendance_attempts (link_id, device_id, matric, ip, reason, detail, lat, lng, accuracy)
            values (l.id, v_device, v_matric, v_ip,
                    case when v_code <> '' then 'wrong_code' else 'need_room_code' end,
                    case when v_code <> '' then 'soft:' || left(v_code, 10) else round(v_dist)::text end,
                    v_lat, v_lng, v_acc);
          return jsonb_build_object('error', 'need_room_code',
                                    'why', case when v_acc > 150 then 'weak' else 'far' end);
        end if;
        v_flags := array_append(v_flags,
                     case when v_dist > 500 or v_acc > 500 then 'loc_far' else 'loc_code' end);
      end if;
    end if;
  end;

  -- Suspicious-location checks (flag only; not for lecturer-scanned help)
  if not v_help then
  $sec$;
begin
  select pg_get_functiondef('public.submit_attendance(jsonb)'::regprocedure) into def;
  if position(marker in def) > 0 then
    raise notice 'submit_attendance already has gps-zones v1'; return;
  end if;
  if position('v_help' in def) = 0 or position('room_pass_ok(l.id' in def) = 0 then
    raise exception 'run gps-help.sql, simple-checkin.sql and qr-checkin.sql first';
  end if;
  a := position(start_at in def); b := position(end_at in def);
  if a = 0 or b = 0 or b <= a or position(old_lock in def) = 0 or position(old_ip in def) = 0 then
    raise exception 'submit_attendance looks different than expected: nothing was changed';
  end if;
  def := substr(def, 1, a - 1) || section || substr(def, b);
  def := replace(def, old_lock, new_lock);
  def := replace(def, old_ip, new_ip);
  execute def;
  raise notice 'submit_attendance updated: gps-zones v1';
end $$;

commit;

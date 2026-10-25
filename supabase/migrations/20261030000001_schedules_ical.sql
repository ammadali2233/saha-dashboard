-- Phase 2b: expected payments created automatically, and iCal URLs settable by the owner.

-- ---------------------------------------------------------------- payment schedule (rules 8 and 9)
-- Platform bookings: one payout expected on check-in + payout lag, for the booking's net.
-- Direct bookings: advance % of net due on confirmation, the rest at check-in, deposit % at check-in.
-- Creates what is missing; re-aligns amounts and dates of rows not yet received.
create function public.ensure_payment_schedule(p_booking uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  f record;
  s record;
  v_paid numeric;
  v_advance numeric;
begin
  select * into f from public.booking_financials where booking_id = p_booking;
  if not found or f.status not in ('tentative', 'confirmed', 'in_house', 'completed') or coalesce(f.net, 0) <= 0 then
    return;
  end if;
  select * into s from public.settings limit 1;

  if f.channel_code in ('airbnb', 'booking_com') then
    if not exists (select 1 from public.payments where booking_id = p_booking and deleted_at is null
                   and kind in ('airbnb_payout', 'booking_com_payout')) then
      insert into public.payments (booking_id, kind, currency, amount_due, due_date, status, notes)
      values (p_booking, case when f.channel_code = 'airbnb' then 'airbnb_payout' else 'booking_com_payout' end::public.payment_kind,
              f.currency, f.net, f.check_in + s.airbnb_payout_lag_days, 'scheduled', 'Expected payout');
    else
      update public.payments set amount_due = f.net, due_date = f.check_in + s.airbnb_payout_lag_days
      where booking_id = p_booking and deleted_at is null and kind in ('airbnb_payout', 'booking_com_payout')
        and status in ('scheduled', 'due', 'overdue') and currency = f.currency;
    end if;
    return;
  end if;

  if f.channel_code <> 'direct' or f.currency <> 'PKR' then
    return;
  end if;

  if not exists (select 1 from public.payments where booking_id = p_booking and deleted_at is null
                 and kind in ('advance', 'balance', 'full')) then
    v_advance := round(f.net * s.advance_pct / 100, 2);
    insert into public.payments (booking_id, kind, currency, amount_due, due_date, status)
    select p_booking, k::public.payment_kind, 'PKR', a, d, 'scheduled'
    from (values ('advance', v_advance, least(coalesce(f.booked_at, public.pk_today()), f.check_in)),
                 ('balance', f.net - v_advance, f.check_in)) x(k, a, d)
    where a > 0;
  else
    -- keep the balance equal to what is still owed after any money received
    select coalesce(sum(amount_received), 0) into v_paid from public.payments
    where booking_id = p_booking and deleted_at is null and status = 'received' and kind in ('advance', 'balance', 'full');
    update public.payments set amount_due = greatest(f.net - v_paid
        - coalesce((select sum(amount_due) from public.payments where booking_id = p_booking and deleted_at is null
                    and kind = 'advance' and status <> 'received'), 0), 0)
    where booking_id = p_booking and deleted_at is null and kind = 'balance' and status in ('scheduled', 'due', 'overdue');
  end if;

  if s.deposit_pct > 0 and not exists (select 1 from public.payments where booking_id = p_booking and deleted_at is null and kind = 'deposit_in') then
    insert into public.payments (booking_id, kind, currency, amount_due, due_date, status, notes)
    values (p_booking, 'deposit_in', 'PKR', round(f.net * s.deposit_pct / 100, 2), f.check_in, 'scheduled',
            'Refundable security deposit');
  end if;
end;
$$;
revoke execute on function public.ensure_payment_schedule(uuid) from public, anon;
grant execute on function public.ensure_payment_schedule(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- save_booking now also schedules payments
create or replace function public.save_booking(p_booking jsonb, p_lines jsonb, p_guest jsonb default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_booking ->> 'id', '')::uuid;
  v_guest uuid := nullif(p_booking ->> 'guest_id', '')::uuid;
  v_channel uuid := (p_booking ->> 'channel_id')::uuid;
  v_check_in date := (p_booking ->> 'check_in')::date;
  v_ref text := nullif(trim(p_booking ->> 'ref'), '');
  v_keep uuid[];
  v_currencies int;
  l jsonb;
begin
  if not public.is_member() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select count(distinct x ->> 'currency') into v_currencies from jsonb_array_elements(p_lines) x;
  if v_currencies > 1 then
    raise exception 'All line items in a booking must use the same currency.' using errcode = 'P0001';
  end if;

  -- guest: pick an existing one, or create from name/phone/email
  if v_guest is null and p_guest is not null and nullif(trim(p_guest ->> 'name'), '') is not null then
    insert into public.guests (name, phone, email, source)
    values (trim(p_guest ->> 'name'), nullif(trim(p_guest ->> 'phone'), ''),
            nullif(lower(trim(p_guest ->> 'email')), ''), nullif(p_guest ->> 'source', ''))
    returning id into v_guest;
  end if;

  -- direct bookings without a channel code get D-YYYY-NNN
  if v_ref is null and v_id is null
     and (select code from public.channels where id = v_channel) = 'direct' then
    v_ref := public.next_doc_number('D', extract(year from v_check_in)::int);
  end if;

  if v_id is null then
    insert into public.bookings (
      ref, channel_id, guest_id, check_in, check_out, guest_count, booking_type, status,
      booked_at, checkin_notes, notes, needs_details
    ) values (
      v_ref, v_channel, v_guest, v_check_in, (p_booking ->> 'check_out')::date,
      nullif(p_booking ->> 'guest_count', '')::int,
      coalesce(nullif(p_booking ->> 'booking_type', ''), 'standard')::public.booking_type,
      coalesce(nullif(p_booking ->> 'status', ''), 'confirmed')::public.booking_status,
      coalesce(nullif(p_booking ->> 'booked_at', '')::date, public.pk_today()),
      nullif(p_booking ->> 'checkin_notes', ''), nullif(p_booking ->> 'notes', ''), false
    ) returning id into v_id;
  else
    update public.bookings set
      ref = coalesce(v_ref, ref),
      channel_id = v_channel,
      guest_id = v_guest,
      check_in = v_check_in,
      check_out = (p_booking ->> 'check_out')::date,
      guest_count = nullif(p_booking ->> 'guest_count', '')::int,
      booking_type = coalesce(nullif(p_booking ->> 'booking_type', ''), 'standard')::public.booking_type,
      status = coalesce(nullif(p_booking ->> 'status', ''), status::text)::public.booking_status,
      booked_at = coalesce(nullif(p_booking ->> 'booked_at', '')::date, booked_at),
      checkin_notes = nullif(p_booking ->> 'checkin_notes', ''),
      notes = nullif(p_booking ->> 'notes', ''),
      needs_details = false
    where id = v_id and deleted_at is null;
    if not found then
      raise exception 'Booking not found.' using errcode = 'P0002';
    end if;
  end if;

  -- lines
  select coalesce(array_agg((x ->> 'id')::uuid), '{}') into v_keep
  from jsonb_array_elements(p_lines) x where nullif(x ->> 'id', '') is not null;

  update public.booking_lines set deleted_at = now()
  where booking_id = v_id and deleted_at is null and not (id = any (v_keep));

  for l in select * from jsonb_array_elements(p_lines) loop
    if nullif(l ->> 'id', '') is not null then
      update public.booking_lines set
        kind = (l ->> 'kind')::public.line_kind,
        discount_subtype = nullif(l ->> 'discount_subtype', '')::public.discount_subtype,
        label = l ->> 'label',
        qty = (l ->> 'qty')::numeric,
        unit_amount = (l ->> 'unit_amount')::numeric,
        amount = (l ->> 'amount')::numeric,
        currency = (l ->> 'currency')::public.currency_code,
        is_actual_fee = (l ->> 'kind') = 'platform_fee',
        sort_order = coalesce((l ->> 'sort_order')::int, 0)
      where id = (l ->> 'id')::uuid and booking_id = v_id;
    else
      insert into public.booking_lines (booking_id, kind, discount_subtype, label, qty, unit_amount, amount,
                                        currency, is_actual_fee, sort_order)
      values (v_id, (l ->> 'kind')::public.line_kind, nullif(l ->> 'discount_subtype', '')::public.discount_subtype,
              l ->> 'label', (l ->> 'qty')::numeric, (l ->> 'unit_amount')::numeric, (l ->> 'amount')::numeric,
              (l ->> 'currency')::public.currency_code, (l ->> 'kind') = 'platform_fee',
              coalesce((l ->> 'sort_order')::int, 0));
    end if;
  end loop;

  perform public.ensure_payment_schedule(v_id);
  return v_id;
end;
$$;
revoke execute on function public.save_booking(jsonb, jsonb, jsonb) from anon, public;
grant execute on function public.save_booking(jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- iCal import URLs (secret)
-- The owner sets a channel's iCal URL from the app; nobody can read it back (only the sync function).
create function public.set_channel_ical_url(p_channel uuid, p_url text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change calendar links.' using errcode = '42501';
  end if;
  if p_url is not null and p_url !~ '^https://' then
    raise exception 'The calendar link must start with https://' using errcode = 'P0001';
  end if;
  insert into public.channel_secrets (channel_id, ical_url, updated_at) values (p_channel, nullif(trim(p_url), ''), now())
  on conflict (channel_id) do update set ical_url = excluded.ical_url, updated_at = now();
  update public.channels set ical_configured = nullif(trim(p_url), '') is not null where id = p_channel;
end;
$$;
revoke execute on function public.set_channel_ical_url(uuid, text) from public, anon;
grant execute on function public.set_channel_ical_url(uuid, text) to authenticated;

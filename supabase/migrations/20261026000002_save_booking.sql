-- Save a booking, its guest and its line items in one transaction. Runs as the caller (RLS applies).
-- Lines missing from p_lines are soft-deleted; lines with an id are updated; the rest are inserted.

create function public.save_booking(p_booking jsonb, p_lines jsonb, p_guest jsonb default null)
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

  return v_id;
end;
$$;
revoke execute on function public.save_booking(jsonb, jsonb, jsonb) from anon, public;
grant execute on function public.save_booking(jsonb, jsonb, jsonb) to authenticated;

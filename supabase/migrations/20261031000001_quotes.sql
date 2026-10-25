-- Phase 2c: quotes (save, public share link, accept -> booking) and inquiry follow-up alerts.

-- ---------------------------------------------------------------- save a quote with its lines
create function public.save_quote(p_quote jsonb, p_lines jsonb) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_quote ->> 'id', '')::uuid;
  v_check_in date := (p_quote ->> 'check_in')::date;
  l jsonb;
  i int := 0;
begin
  if not public.is_member() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_id is null then
    insert into public.quotes (number, inquiry_id, guest_id, prepared_for, issue_date, check_in, check_out, scope, guest_count,
                               currency, advance_pct, deposit_amount, valid_until, status, notes)
    values (public.next_doc_number('Q', extract(year from coalesce(nullif(p_quote ->> 'issue_date', '')::date, public.pk_today()))::int),
            nullif(p_quote ->> 'inquiry_id', '')::uuid, nullif(p_quote ->> 'guest_id', '')::uuid, p_quote ->> 'prepared_for',
            coalesce(nullif(p_quote ->> 'issue_date', '')::date, public.pk_today()), v_check_in, (p_quote ->> 'check_out')::date,
            coalesce(nullif(p_quote ->> 'scope', ''), 'full_house')::public.stay_scope, nullif(p_quote ->> 'guest_count', '')::int,
            'PKR', coalesce(nullif(p_quote ->> 'advance_pct', '')::numeric, 30), coalesce(nullif(p_quote ->> 'deposit_amount', '')::numeric, 0),
            nullif(p_quote ->> 'valid_until', '')::date, 'draft', nullif(p_quote ->> 'notes', ''))
    returning id into v_id;
  else
    update public.quotes set
      prepared_for = p_quote ->> 'prepared_for',
      guest_id = nullif(p_quote ->> 'guest_id', '')::uuid,
      issue_date = coalesce(nullif(p_quote ->> 'issue_date', '')::date, issue_date),
      check_in = v_check_in,
      check_out = (p_quote ->> 'check_out')::date,
      scope = coalesce(nullif(p_quote ->> 'scope', ''), 'full_house')::public.stay_scope,
      guest_count = nullif(p_quote ->> 'guest_count', '')::int,
      advance_pct = coalesce(nullif(p_quote ->> 'advance_pct', '')::numeric, advance_pct),
      deposit_amount = coalesce(nullif(p_quote ->> 'deposit_amount', '')::numeric, deposit_amount),
      valid_until = nullif(p_quote ->> 'valid_until', '')::date,
      notes = nullif(p_quote ->> 'notes', '')
    where id = v_id and status in ('draft', 'sent') and deleted_at is null;
    if not found then
      raise exception 'Only draft or sent quotes can be edited.' using errcode = 'P0001';
    end if;
    update public.quote_lines set deleted_at = now() where quote_id = v_id and deleted_at is null;
  end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into public.quote_lines (quote_id, kind, discount_subtype, label, qty, unit_amount, amount, sort_order)
    values (v_id, (l ->> 'kind')::public.line_kind, nullif(l ->> 'discount_subtype', '')::public.discount_subtype, l ->> 'label',
            (l ->> 'qty')::numeric, (l ->> 'unit_amount')::numeric, (l ->> 'amount')::numeric, i);
  end loop;

  -- the inquiry moves to "quoted" once it has a quote
  update public.inquiries set quote_id = v_id, status = case when status = 'new' then 'quoted' else status end
  where id = nullif(p_quote ->> 'inquiry_id', '')::uuid;
  return v_id;
end;
$$;
revoke execute on function public.save_quote(jsonb, jsonb) from public, anon;
grant execute on function public.save_quote(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- public read-only link
-- Anyone with the token sees the quote (and nothing else). Only the token's SHA-256 is stored.
create function public.get_public_quote(p_token text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'number', q.number, 'issue_date', q.issue_date, 'prepared_for', q.prepared_for,
    'check_in', q.check_in, 'check_out', q.check_out, 'scope', q.scope, 'guest_count', q.guest_count,
    'currency', q.currency, 'advance_pct', q.advance_pct, 'deposit_amount', q.deposit_amount,
    'valid_until', q.valid_until, 'status', q.status, 'notes', q.notes,
    'property_name', s.property_name, 'brand', s.brand, 'check_in_time', s.check_in_time, 'check_out_time', s.check_out_time,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'label', l.label, 'qty', l.qty,
                                                           'unit_amount', l.unit_amount, 'amount', l.amount) order by l.sort_order)
                       from public.quote_lines l where l.quote_id = q.id and l.deleted_at is null), '[]'::jsonb))
  from public.quotes q, public.settings s
  where q.share_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and q.deleted_at is null and q.status <> 'draft'
$$;
revoke execute on function public.get_public_quote(text) from public;
grant execute on function public.get_public_quote(text) to anon, authenticated;

-- ---------------------------------------------------------------- accept: quote -> confirmed booking
-- One step: guest, booking with the quote's lines, payment schedule from the quote's terms,
-- tasks (trigger), inquiry won, quote accepted. Refuses if the dates are no longer free.
create function public.accept_quote(p_quote uuid) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  q record;
  v_guest uuid;
  v_booking uuid;
  v_net numeric;
  v_advance numeric;
  v_lines jsonb;
begin
  select * into q from public.quotes where id = p_quote and deleted_at is null for update;
  if not found then raise exception 'Quote not found.' using errcode = 'P0002'; end if;
  if q.status not in ('draft', 'sent') then
    raise exception 'This quote is already %.', q.status using errcode = 'P0001';
  end if;

  v_guest := q.guest_id;
  if v_guest is null and q.inquiry_id is not null then
    select guest_id into v_guest from public.inquiries where id = q.inquiry_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'discount_subtype', discount_subtype, 'label', label, 'qty', qty,
                                               'unit_amount', unit_amount, 'amount', amount, 'currency', 'PKR') order by sort_order), '[]'::jsonb),
         coalesce(sum(amount), 0)
    into v_lines, v_net
  from public.quote_lines where quote_id = p_quote and deleted_at is null and kind not in ('tax');

  -- payments first (from the quote's own terms), so save_booking's schedule step only fills gaps
  v_booking := public.save_booking(
    jsonb_build_object('channel_id', (select id from public.channels where code = 'direct'), 'guest_id', v_guest,
                       'check_in', q.check_in, 'check_out', q.check_out, 'guest_count', q.guest_count,
                       'status', 'confirmed', 'booked_at', public.pk_today(),
                       'notes', 'From quote ' || q.number),
    '[]'::jsonb,
    case when v_guest is null then jsonb_build_object('name', q.prepared_for) else null end);

  v_advance := round(v_net * q.advance_pct / 100, 2);
  insert into public.payments (booking_id, kind, currency, amount_due, due_date, status, notes)
  select v_booking, k::public.payment_kind, 'PKR', a, d, 'scheduled', n
  from (values ('advance', v_advance, public.pk_today(), 'To confirm the booking (quote ' || q.number || ')'),
               ('balance', v_net - v_advance, q.check_in, 'At check-in'),
               ('deposit_in', q.deposit_amount, q.check_in, 'Refundable security deposit')) x(k, a, d, n)
  where a > 0;

  -- now the lines (the schedule exists, so nothing is duplicated)
  perform public.save_booking(
    jsonb_build_object('id', v_booking, 'channel_id', (select id from public.channels where code = 'direct'),
                       'guest_id', (select guest_id from public.bookings where id = v_booking),
                       'check_in', q.check_in, 'check_out', q.check_out, 'guest_count', q.guest_count, 'status', 'confirmed',
                       'notes', 'From quote ' || q.number),
    v_lines);

  update public.quotes set status = 'accepted', booking_id = v_booking where id = p_quote;
  if q.inquiry_id is not null then
    update public.inquiries set status = 'won', booking_id = v_booking where id = q.inquiry_id;
  end if;
  return v_booking;
end;
$$;
revoke execute on function public.accept_quote(uuid) from public, anon;
grant execute on function public.accept_quote(uuid) to authenticated;

-- ---------------------------------------------------------------- follow-ups in the alerts list
create or replace view public.alerts with (security_invoker = true) as
select * from (
  select a.kind, a.severity, a.title, a.detail, a.alert_date, a.booking_id, a.link from (
    with s as (select overdue_threshold_days, default_usd_pkr from public.settings limit 1),
    deposits as (
      select booking_id,
             sum(amount_received) filter (where kind = 'deposit_in')
               - coalesce(sum(amount_received) filter (where kind in ('deposit_refund', 'deposit_withheld')), 0) as held
      from public.payments
      where deleted_at is null and status = 'received' and kind in ('deposit_in', 'deposit_refund', 'deposit_withheld')
      group by booking_id
    )
    select 'needs_details'::text as kind, 'warning'::text as severity, 'Add guest and charges'::text as title,
           coalesce(f.ref, f.channel_name) || ', ' || to_char(f.check_in, 'FMDD Mon') as detail,
           f.check_in as alert_date, f.booking_id, '/bookings/' || f.booking_id || '/edit' as link
    from public.booking_financials f
    where f.needs_details and f.status in ('tentative', 'confirmed', 'in_house')
    union all
    select 'possibly_cancelled', 'warning', 'Possibly cancelled: please confirm',
           coalesce(f.guest_name, f.ref, 'Booking') || ', ' || to_char(f.check_in, 'FMDD Mon'),
           f.check_in, f.booking_id, '/bookings/' || f.booking_id
    from public.booking_financials f
    where f.possibly_cancelled_at is not null and f.status in ('tentative', 'confirmed', 'in_house')
    union all
    select 'payout_overdue', 'danger', 'Payout overdue',
           coalesce(f.guest_name, f.ref) || ', expected ' || to_char(p.due_date, 'FMDD Mon'),
           p.due_date, p.booking_id, '/bookings/' || p.booking_id
    from public.payments p
    join public.booking_financials f on f.booking_id = p.booking_id
    cross join s
    where p.deleted_at is null and p.kind in ('airbnb_payout', 'booking_com_payout')
      and p.status not in ('received', 'waived') and f.status in ('confirmed', 'in_house', 'completed')
      and p.due_date + s.overdue_threshold_days < public.pk_today()
    union all
    select 'payout_held', 'warning', 'Payout held by ' || pa.name,
           coalesce(f.guest_name, f.ref) || ': ' || p.amount_received || ' ' || p.currency || ' not yet forwarded',
           p.received_date, p.booking_id, '/bookings/' || p.booking_id
    from public.payment_facts p
    join public.partners pa on pa.id = p.received_by_partner_id
    join public.booking_financials f on f.booking_id = p.booking_id
    where p.held_by_partner
    union all
    select 'balance_unpaid', 'danger', 'Guest payment unpaid',
           coalesce(f.guest_name, f.ref) || ': ' || p.amount_due || ' ' || p.currency || ' due ' || to_char(p.due_date, 'FMDD Mon'),
           p.due_date, p.booking_id, '/bookings/' || p.booking_id
    from public.payments p
    join public.booking_financials f on f.booking_id = p.booking_id
    where p.deleted_at is null and p.kind in ('advance', 'balance', 'full')
      and p.status not in ('received', 'waived') and p.due_date <= public.pk_today()
      and f.status in ('confirmed', 'in_house', 'completed')
    union all
    select 'deposit_not_refunded', 'warning', 'Deposit not settled',
           coalesce(f.guest_name, f.ref) || ': PKR ' || d.held || ' held since ' || to_char(f.check_out, 'FMDD Mon'),
           f.check_out + 3, f.booking_id, '/bookings/' || f.booking_id
    from deposits d
    join public.booking_financials f on f.booking_id = d.booking_id
    where d.held > 0 and f.check_out + 3 < public.pk_today()
    union all
    select 'expense_due', case when e.expense_date < public.pk_today() then 'danger' else 'info' end,
           e.category || ' due', e.item || ': PKR ' || e.amount,
           e.expense_date, null::uuid, '/money/expenses/' || e.id
    from public.expenses e
    where e.deleted_at is null and e.status = 'due' and e.amount > 0 and e.expense_date <= public.pk_today() + 3
    union all
    select 'conflict', 'danger', 'Calendar conflict',
           'Overlap ' || to_char(c.start_date, 'FMDD Mon') || ' to ' || to_char(c.end_date, 'FMDD Mon'),
           c.start_date, case when c.a_type = 'booking' then c.a_id end, '/calendar?date=' || c.start_date
    from public.calendar_conflicts c
    where c.end_date > public.pk_today()
    union all
    select 'sync_failed', 'danger', 'Calendar sync failed', r.job_name || ': ' || coalesce(r.error, 'unknown error'),
           (r.started_at at time zone 'Asia/Karachi')::date, null::uuid, '/settings'
    from (select distinct on (job_name) * from public.sync_runs order by job_name, started_at desc) r
    where r.result = 'error'
    union all
    -- inquiries waiting on us (follow-up date reached)
    select 'inquiry_follow_up', 'info', 'Follow up inquiry',
           coalesce(g.name, 'Inquiry') || coalesce(', ' || to_char(i.check_in, 'FMDD Mon'), ''),
           i.follow_up_date, null::uuid, '/inquiries?open=' || i.id
    from public.inquiries i
    left join public.guests g on g.id = i.guest_id
    where i.deleted_at is null and i.status in ('new', 'quoted', 'awaiting_advance') and i.follow_up_date <= public.pk_today()
  ) a
) x;
revoke all on public.alerts from anon;

-- Flag bookings whose dates the calendar sync changed, so someone checks the charges (the sync
-- never touches money). The flag clears the next time a person saves or edits the booking.

alter table public.bookings add column sync_changed_at timestamptz;
alter table public.bookings add column sync_change_note text;

create function public.clear_sync_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- a person (not the sync, which uses the service role) touched a flagged booking: they have seen it
  if auth.uid() is not null and old.sync_changed_at is not null and new.sync_changed_at is not distinct from old.sync_changed_at then
    new.sync_changed_at := null;
    new.sync_change_note := null;
  end if;
  return new;
end;
$$;
create trigger clear_sync_change before update on public.bookings
  for each row execute function public.clear_sync_change();

-- flag date changes the sync already made (e.g. a stay shortened on Airbnb), unless a person has
-- saved the booking since
update public.bookings b
set sync_changed_at = a.at,
    sync_change_note = 'was ' || public.format_pk_date((a.before ->> 'check_in')::date) || ' to '
      || public.format_pk_date((a.before ->> 'check_out')::date) || ', now '
      || public.format_pk_date((a.after ->> 'check_in')::date) || ' to ' || public.format_pk_date((a.after ->> 'check_out')::date)
from (
  select distinct on (row_id) row_id, at, before, after
  from public.audit_log
  where table_name = 'bookings' and action = 'UPDATE' and user_id is null
    and (before ->> 'check_in' is distinct from after ->> 'check_in' or before ->> 'check_out' is distinct from after ->> 'check_out')
  order by row_id, at desc
) a
where b.id = a.row_id
  and not exists (select 1 from public.audit_log u where u.row_id = b.id and u.table_name = 'bookings'
                  and u.user_id is not null and u.at > a.at);

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
    -- the calendar sync moved a booking's dates: its charges may no longer match
    select 'dates_changed', 'warning', 'Dates changed on ' || f.channel_name || ': check charges',
           coalesce(f.guest_name, f.ref, 'Booking') || ': ' || coalesce(b.sync_change_note, 'dates changed'),
           f.check_in, f.booking_id, '/bookings/' || f.booking_id || '/edit'
    from public.booking_financials f
    join public.bookings b on b.id = f.booking_id
    where b.sync_changed_at is not null and f.status in ('tentative', 'confirmed', 'in_house', 'completed')
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

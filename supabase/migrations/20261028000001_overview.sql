-- Overview: KPI figures and alerts, computed in the database so every partner sees the same numbers.

-- ---------------------------------------------------------------- alerts
create view public.alerts with (security_invoker = true) as
with s as (select overdue_threshold_days, default_usd_pkr from public.settings limit 1),
deposits as (
  select booking_id,
         sum(amount_received) filter (where kind = 'deposit_in')
           - coalesce(sum(amount_received) filter (where kind in ('deposit_refund', 'deposit_withheld')), 0) as held
  from public.payments
  where deleted_at is null and status = 'received' and kind in ('deposit_in', 'deposit_refund', 'deposit_withheld')
  group by booking_id
)
-- iCal stubs waiting for guest and charges
select 'needs_details'::text as kind, 'warning'::text as severity,
       'Add guest and charges' as title,
       coalesce(f.ref, f.channel_name) || ', ' || to_char(f.check_in, 'FMDD Mon') as detail,
       f.check_in as alert_date, f.booking_id, '/bookings/' || f.booking_id || '/edit' as link
from public.booking_financials f
where f.needs_details and f.status in ('tentative', 'confirmed', 'in_house')
union all
-- flagged by the iCal sync: reservation vanished from the feed
select 'possibly_cancelled', 'warning', 'Possibly cancelled: please confirm',
       coalesce(f.guest_name, f.ref, 'Booking') || ', ' || to_char(f.check_in, 'FMDD Mon'),
       f.check_in, f.booking_id, '/bookings/' || f.booking_id
from public.booking_financials f
where f.possibly_cancelled_at is not null and f.status in ('tentative', 'confirmed', 'in_house')
union all
-- rule 9: no payout recorded after the threshold
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
-- rule 9: USD received by a partner, PKR not yet forwarded
select 'payout_held', 'warning', 'Payout held by ' || pa.name,
       coalesce(f.guest_name, f.ref) || ': ' || p.amount_received || ' ' || p.currency || ' not yet forwarded',
       p.received_date, p.booking_id, '/bookings/' || p.booking_id
from public.payment_facts p
join public.partners pa on pa.id = p.received_by_partner_id
join public.booking_financials f on f.booking_id = p.booking_id
where p.held_by_partner
union all
-- rule 8: guest money due at or before check-in still unpaid
select 'balance_unpaid', 'danger', 'Guest payment unpaid',
       coalesce(f.guest_name, f.ref) || ': ' || p.amount_due || ' ' || p.currency || ' due ' || to_char(p.due_date, 'FMDD Mon'),
       p.due_date, p.booking_id, '/bookings/' || p.booking_id
from public.payments p
join public.booking_financials f on f.booking_id = p.booking_id
where p.deleted_at is null and p.kind in ('advance', 'balance', 'full')
  and p.status not in ('received', 'waived') and p.due_date <= public.pk_today()
  and f.status in ('confirmed', 'in_house', 'completed')
union all
-- rule 8: deposit still held 3 days after check-out
select 'deposit_not_refunded', 'warning', 'Deposit not settled',
       coalesce(f.guest_name, f.ref) || ': PKR ' || d.held || ' held since ' || to_char(f.check_out, 'FMDD Mon'),
       f.check_out + 3, f.booking_id, '/bookings/' || f.booking_id
from deposits d
join public.booking_financials f on f.booking_id = d.booking_id
where d.held > 0 and f.check_out + 3 < public.pk_today()
union all
-- bills due now or within 3 days (recurring rent, utilities)
select 'expense_due', case when e.expense_date < public.pk_today() then 'danger' else 'info' end,
       e.category || ' due', e.item || ': PKR ' || e.amount,
       e.expense_date, null::uuid, '/money/expenses/' || e.id
from public.expenses e
where e.deleted_at is null and e.status = 'due' and e.amount > 0 and e.expense_date <= public.pk_today() + 3
union all
-- rule 5: double bookings still ahead
select 'conflict', 'danger', 'Calendar conflict',
       'Overlap ' || to_char(c.start_date, 'FMDD Mon') || ' to ' || to_char(c.end_date, 'FMDD Mon'),
       c.start_date, case when c.a_type = 'booking' then c.a_id end, '/calendar?date=' || c.start_date
from public.calendar_conflicts c
where c.end_date > public.pk_today()
union all
-- last run of each sync job failed
select 'sync_failed', 'danger', 'Calendar sync failed', r.job_name || ': ' || coalesce(r.error, 'unknown error'),
       (r.started_at at time zone 'Asia/Karachi')::date, null::uuid, '/settings'
from (
  select distinct on (job_name) * from public.sync_runs order by job_name, started_at desc
) r
where r.result = 'error';

revoke all on public.alerts from anon;

-- ---------------------------------------------------------------- KPIs
-- One row of overview figures for the month containing p_month (Karachi dates, PKR).
-- p_exclude_nonstandard (rule 7) removes partner/friends and promotional stays from occupancy and ADR.
create function public.overview_kpis(p_month date default null, p_exclude_nonstandard boolean default false)
returns table (
  month_start date,
  occ_this_occupied int, occ_this_available int, occ_this_rate numeric, occ_this_completed int,
  occ_next_occupied int, occ_next_available int, occ_next_rate numeric,
  adr_this_pkr numeric, adr_has_estimates boolean,
  realized_mtd_pkr numeric, realized_to_date_pkr numeric,
  opex_mtd_pkr numeric,
  realized_net_profit_pkr numeric,
  project_balance_pkr numeric,
  on_the_books_pkr numeric, on_the_books_has_estimates boolean,
  pending_payouts_count int, pending_payouts_pkr_est numeric,
  guest_balances_due_pkr numeric,
  deposits_held_pkr numeric,
  total_invested_pkr numeric, capital_recovered_pct numeric
)
language sql stable
set search_path = ''
as $$
  with m as (
    select date_trunc('month', coalesce(p_month, public.pk_today()))::date as m0
  ), b as (
    select m0, (m0 + interval '1 month')::date as m1, (m0 + interval '2 month')::date as m2 from m
  ), s as (
    select default_usd_pkr from public.settings limit 1
  ), na as (
    select n.*
    from public.nightly_allocation n
    where not (p_exclude_nonstandard and n.booking_type <> 'standard')
      and n.night >= (select go_live_date from public.settings limit 1) -- same basis as occupancy
  ), cash as (
    select realized_date, revenue_sign * realized_pkr as v
    from public.payment_facts where realized_date is not null and revenue_sign <> 0
  ), opex as (
    select coalesce(sum(public.expense_pkr(amount, currency)) filter (where status = 'paid'), 0) as paid_all,
           coalesce(sum(public.expense_pkr(amount, currency)) filter (
             where expense_date >= (select m0 from b) and expense_date < (select m1 from b)), 0) as mtd
    from public.expenses where deleted_at is null and kind = 'operating'
  ), pay as (
    select
      count(*) filter (where kind in ('airbnb_payout', 'booking_com_payout') and (status not in ('received', 'waived') or held_by_partner)) as payouts_n,
      coalesce(sum(case when currency = 'USD' then coalesce(amount_received, amount_due) * (select default_usd_pkr from s)
                        else coalesce(amount_received, amount_due) end)
               filter (where kind in ('airbnb_payout', 'booking_com_payout') and (status not in ('received', 'waived') or held_by_partner)), 0) as payouts_pkr,
      coalesce(sum(amount_due) filter (where kind in ('advance', 'balance', 'full') and status not in ('received', 'waived') and currency = 'PKR'), 0) as guest_due,
      coalesce(sum(amount_received) filter (where kind = 'deposit_in' and status = 'received'), 0)
        - coalesce(sum(amount_received) filter (where kind in ('deposit_refund', 'deposit_withheld') and status = 'received'), 0) as deposits
    from public.payment_facts p
    where p.booking_id is null
       or exists (select 1 from public.bookings x where x.id = p.booking_id and x.deleted_at is null
                  and x.status in ('tentative', 'confirmed', 'in_house', 'completed'))
  ), cap as (
    select coalesce(sum(total_invested), 0) as invested from public.partner_capital
  ), o1 as (select * from public.occupancy_stats((select m0 from b), (select m1 from b), p_exclude_nonstandard)),
     o2 as (select * from public.occupancy_stats((select m1 from b), (select m2 from b), p_exclude_nonstandard))
  select
    b.m0,
    o1.occupied, o1.available, o1.rate,
    (select count(distinct night)::int from na where na.month = b.m0 and na.revenue_state = 'earned'),
    o2.occupied, o2.available, o2.rate,
    (select round(sum(net_pkr) / nullif(count(*), 0), 2) from na where na.month = b.m0),
    coalesce((select bool_or(pkr_is_estimate) from na where na.month = b.m0), false),
    coalesce((select sum(v) from cash where realized_date >= b.m0 and realized_date < b.m1), 0),
    coalesce((select sum(v) from cash), 0),
    opex.mtd,
    coalesce((select sum(v) from cash), 0) - opex.paid_all,
    coalesce((select balance from public.project_account_ledger order by entry_date desc, source_table desc, source_id desc limit 1), 0),
    coalesce((select sum(net_pkr) from public.booking_financials where revenue_state = 'booked'), 0),
    coalesce((select bool_or(pkr_is_estimate) from public.booking_financials where revenue_state = 'booked'), false),
    pay.payouts_n::int, round(pay.payouts_pkr, 2),
    pay.guest_due,
    pay.deposits,
    cap.invested,
    case when cap.invested > 0
         then round((coalesce((select sum(v) from cash), 0) - opex.paid_all) / cap.invested, 4) end
  from b, o1, o2, opex, pay, cap
$$;
revoke execute on function public.overview_kpis(date, boolean) from public, anon;
grant execute on function public.overview_kpis(date, boolean) to authenticated;

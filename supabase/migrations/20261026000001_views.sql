-- Reporting views. These are the source of truth for every figure in the app; src/domain mirrors
-- the same rules in TypeScript, and the golden scenarios in src/domain/golden.ts are asserted
-- against both (supabase/tests/views_golden.test.sql). All views are security_invoker, so RLS applies.

-- ---------------------------------------------------------------- helpers
create function public.expense_pkr(p_amount numeric, p_currency public.currency_code) returns numeric
language sql stable
set search_path = ''
as $$
  select case when p_currency = 'PKR' then p_amount
              else round(p_amount * (select default_usd_pkr from public.settings limit 1), 2) end
$$;

-- ---------------------------------------------------------------- payments
-- Rule 9: money that lands with a partner (Airbnb USD) is realized when PKR is forwarded.
create view public.payment_facts with (security_invoker = true) as
select p.*,
       x.realized_date,
       case when x.realized_date is not null
            then case when p.currency = 'PKR' then p.amount_received else p.pkr_received end end as realized_pkr,
       case when p.kind in ('advance', 'balance', 'full', 'airbnb_payout', 'booking_com_payout',
                            'cancellation_payout', 'deposit_withheld') then 1
            when p.kind = 'guest_refund' then -1 else 0 end as revenue_sign,
       -- cash effect on the project account (withheld deposits were already in)
       case when p.kind in ('advance', 'balance', 'full', 'airbnb_payout', 'booking_com_payout',
                            'cancellation_payout', 'deposit_in') then 1
            when p.kind in ('guest_refund', 'deposit_refund') then -1 else 0 end as cash_sign,
       (p.status = 'received' and p.received_by_partner_id is not null and p.forwarded_date is null) as held_by_partner
from public.payments p
cross join lateral (
  select case when p.status = 'received'
              then case when p.received_by_partner_id is null then p.received_date else p.forwarded_date end
         end as realized_date
) x
where p.deleted_at is null;

-- ---------------------------------------------------------------- bookings
-- Rule 2 totals in the booking's currency, plus PKR (rule 1: actual payout rate, else default "est.").
create view public.booking_financials with (security_invoker = true) as
with l as (
  select booking_id,
         coalesce(sum(amount) filter (where kind = 'accommodation'), 0) as accommodation,
         coalesce(sum(amount) filter (where kind in ('cleaning_fee', 'extra_guest', 'extra_mattress',
                                                     'airport_pickup', 'late_checkout', 'other_fee')), 0) as fees,
         coalesce(sum(amount) filter (where kind = 'discount'), 0) as discounts,
         sum(amount) filter (where kind = 'platform_fee') as actual_fee,
         coalesce(sum(amount) filter (where kind = 'tax'), 0) as tax,
         min(currency::text) as currency,
         count(distinct currency) as n_currencies
  from public.booking_lines
  where deleted_at is null
  group by booking_id
),
r as (
  select booking_id, sum(amount_received) as usd, sum(pkr_received) as pkr
  from public.payments
  where deleted_at is null and status = 'received' and currency = 'USD'
    and kind in ('airbnb_payout', 'booking_com_payout')
    and pkr_received is not null and amount_received > 0
  group by booking_id
),
t as (
  select b.*,
         c.name as channel_name, c.code as channel_code, c.color as channel_color, c.platform_fee_pct,
         g.name as guest_name, g.phone as guest_phone,
         coalesce(l.currency, c.native_currency::text)::public.currency_code as currency,
         coalesce(l.n_currencies, 0) > 1 as mixed_currency,
         coalesce(l.accommodation, 0) as accommodation,
         coalesce(l.fees, 0) as fees,
         coalesce(l.accommodation, 0) + coalesce(l.fees, 0) as gross,
         coalesce(l.discounts, 0) as discounts,
         l.actual_fee,
         coalesce(l.tax, 0) as tax,
         r.usd as payout_usd, r.pkr as payout_pkr,
         s.default_usd_pkr
  from public.bookings b
  join public.channels c on c.id = b.channel_id
  left join public.guests g on g.id = b.guest_id
  left join l on l.booking_id = b.id
  left join r on r.booking_id = b.id
  cross join (select default_usd_pkr from public.settings limit 1) s
  where b.deleted_at is null
),
f as (
  select t.*,
         case when t.actual_fee is not null then t.actual_fee
              else -round(t.gross * t.platform_fee_pct / 100, 2) end as platform_fee,
         t.actual_fee is not null as platform_fee_is_actual,
         case when t.currency = 'PKR' then 1::numeric
              else coalesce(t.payout_pkr / t.payout_usd, t.default_usd_pkr) end as pkr_rate,
         (t.currency = 'USD' and t.payout_usd is null) as pkr_is_estimate
  from t
)
select f.id as booking_id, f.ref, f.channel_id, f.channel_name, f.channel_code, f.channel_color,
       f.guest_id, f.guest_name, f.guest_phone,
       f.check_in, f.check_out, f.nights, f.guest_count, f.status, f.booking_type, f.source,
       f.needs_details, f.possibly_cancelled_at, f.booked_at, f.cancelled_on, f.cancellation_reason,
       f.currency, f.mixed_currency,
       f.accommodation, f.fees, f.gross, f.discounts, f.platform_fee, f.platform_fee_is_actual,
       f.gross + f.discounts + f.platform_fee as net,
       f.tax,
       f.pkr_rate, f.pkr_is_estimate,
       round((f.gross + f.discounts + f.platform_fee) * f.pkr_rate, 2) as net_pkr,
       case f.status when 'completed' then 'earned'
                     when 'confirmed' then 'booked'
                     when 'in_house' then 'booked'
                     when 'tentative' then 'tentative'
                     else 'excluded' end as revenue_state
from f;

-- ---------------------------------------------------------------- night allocation (rule 4)
create view public.nightly_allocation with (security_invoker = true) as
with n as (
  select f.booking_id, f.channel_id, f.booking_type, f.status, f.revenue_state, f.currency,
         f.pkr_rate, f.pkr_is_estimate, f.nights, f.accommodation, f.fees, f.discounts, f.gross,
         f.platform_fee, f.net, f.net_pkr,
         d::date as night,
         row_number() over (partition by f.booking_id order by d) as i
  from public.booking_financials f
  cross join lateral generate_series(f.check_in, f.check_out - 1, interval '1 day') d
  where f.status in ('confirmed', 'in_house', 'completed')
),
a as (
  select n.*,
         case when i < nights then round(accommodation / nights, 2)
              else accommodation - round(accommodation / nights, 2) * (nights - 1) end as acc_n,
         case when i < nights then round(discounts / nights, 2)
              else discounts - round(discounts / nights, 2) * (nights - 1) end as disc_n,
         case when i = 1 then fees else 0 end as fees_n
  from n
),
p as (
  select a.*,
         case when i < nights then
           case when gross = 0 then round(platform_fee / nights, 2)
                else round(platform_fee * (acc_n + fees_n) / gross, 2) end
         end as fee_part
  from a
),
q as (
  select p.*,
         coalesce(fee_part, platform_fee - coalesce(sum(fee_part) over (partition by booking_id), 0)) as fee_n
  from p
),
r as (
  select q.*,
         acc_n + fees_n + disc_n + fee_n as net_n,
         case when i < nights then round((acc_n + fees_n + disc_n + fee_n) * pkr_rate, 2) end as pkr_part
  from q
)
select booking_id, night, date_trunc('month', night)::date as month,
       channel_id, booking_type, status, revenue_state, currency, pkr_is_estimate,
       acc_n as accommodation, fees_n as fees, disc_n as discounts, fee_n as platform_fee, net_n as net,
       coalesce(pkr_part, net_pkr - coalesce(sum(pkr_part) over (partition by booking_id), 0)) as net_pkr
from r;

-- ---------------------------------------------------------------- occupancy (rule 5)
create view public.occupancy_daily with (security_invoker = true) as
with bounds as (
  select s.go_live_date as start_date,
         greatest(public.pk_today() + 400,
                  coalesce((select max(check_out) from public.bookings where deleted_at is null), public.pk_today())) as end_date
  from public.settings s limit 1
)
select d::date as day,
       exists (select 1 from public.bookings b
               where b.deleted_at is null and b.status in ('confirmed', 'in_house', 'completed')
                 and b.booking_type = 'standard' and d >= b.check_in and d < b.check_out) as occupied_standard,
       exists (select 1 from public.bookings b
               where b.deleted_at is null and b.status in ('confirmed', 'in_house', 'completed')
                 and b.booking_type <> 'standard' and d >= b.check_in and d < b.check_out) as occupied_nonstandard,
       exists (select 1 from public.calendar_blocks k
               where k.deleted_at is null and k.reason <> 'channel_hold'
                 and d >= k.start_date and d < k.end_date) as blocked
from bounds, generate_series(bounds.start_date, bounds.end_date, interval '1 day') d;

-- Occupancy over [p_start, p_end): distinct dates, so never above 100%.
create function public.occupancy_stats(p_start date, p_end date, p_exclude_nonstandard boolean default false)
returns table (occupied int, available int, rate numeric)
language sql stable
set search_path = ''
as $$
  with d as (
    select (occupied_standard or (occupied_nonstandard and not p_exclude_nonstandard)) as occ,
           (blocked or (occupied_nonstandard and p_exclude_nonstandard)) as excl
    from public.occupancy_daily
    where day >= p_start and day < p_end
  )
  select count(*) filter (where occ)::int,
         count(*) filter (where occ or not excl)::int,
         case when count(*) filter (where occ or not excl) = 0 then 0
              else round(count(*) filter (where occ)::numeric / count(*) filter (where occ or not excl), 4) end
  from d
$$;

-- Hard overlaps (rule 5). Channel holds never conflict.
create view public.calendar_conflicts with (security_invoker = true) as
with items as (
  select 'booking'::text as item_type, id, check_in as start_date, check_out as end_date
  from public.bookings
  where deleted_at is null and status in ('tentative', 'confirmed', 'in_house', 'completed')
  union all
  select 'block', id, start_date, end_date
  from public.calendar_blocks
  where deleted_at is null and reason <> 'channel_hold'
)
select a.item_type as a_type, a.id as a_id, b.item_type as b_type, b.id as b_id,
       greatest(a.start_date, b.start_date) as start_date, least(a.end_date, b.end_date) as end_date
from items a
join items b on (a.start_date, a.id) < (b.start_date, b.id)
           and daterange(a.start_date, a.end_date, '[)') && daterange(b.start_date, b.end_date, '[)');

-- ---------------------------------------------------------------- P&L
-- Accrual: stay revenue by night (rule 4), one-off revenue on its date (rules 6 and 8),
-- operating expenses by expense date (setup is capital: rule 10).
create view public.monthly_pnl_accrual with (security_invoker = true) as
with stay as (
  select month,
         count(*) as nights,
         count(*) filter (where revenue_state = 'earned') as nights_earned,
         sum(net_pkr) as stay_revenue_pkr,
         sum(net_pkr) filter (where revenue_state = 'earned') as earned_revenue_pkr,
         sum(net_pkr) filter (where revenue_state = 'booked') as booked_revenue_pkr,
         bool_or(pkr_is_estimate) as has_estimates
  from public.nightly_allocation
  group by month
),
other as (
  select date_trunc('month', received_date)::date as month,
         sum(case when currency = 'PKR' then amount_received else coalesce(pkr_received, 0) end
             * case when kind = 'guest_refund' then -1 else 1 end) as other_revenue_pkr
  from public.payments
  where deleted_at is null and status = 'received'
    and kind in ('cancellation_payout', 'deposit_withheld', 'guest_refund')
  group by 1
),
exp as (
  select date_trunc('month', expense_date)::date as month,
         sum(public.expense_pkr(amount, currency)) as operating_expenses_pkr
  from public.expenses
  where deleted_at is null and kind = 'operating'
  group by 1
),
months as (
  select month from stay union select month from other union select month from exp
)
select m.month,
       coalesce(s.nights, 0) as nights,
       coalesce(s.nights_earned, 0) as nights_earned,
       coalesce(s.stay_revenue_pkr, 0) as stay_revenue_pkr,
       coalesce(s.earned_revenue_pkr, 0) as earned_revenue_pkr,
       coalesce(s.booked_revenue_pkr, 0) as booked_revenue_pkr,
       coalesce(o.other_revenue_pkr, 0) as other_revenue_pkr,
       coalesce(s.has_estimates, false) as has_estimates,
       coalesce(e.operating_expenses_pkr, 0) as operating_expenses_pkr,
       coalesce(s.stay_revenue_pkr, 0) + coalesce(o.other_revenue_pkr, 0) - coalesce(e.operating_expenses_pkr, 0)
         as net_profit_pkr
from months m
left join stay s on s.month = m.month
left join other o on o.month = m.month
left join exp e on e.month = m.month;

-- Cash: realized revenue on its realized date, operating expenses on their paid date.
create view public.monthly_pnl_cash with (security_invoker = true) as
with rev as (
  select date_trunc('month', realized_date)::date as month, sum(revenue_sign * realized_pkr) as realized_revenue_pkr
  from public.payment_facts
  where realized_date is not null and revenue_sign <> 0
  group by 1
),
exp as (
  select date_trunc('month', paid_date)::date as month, sum(public.expense_pkr(amount, currency)) as paid_operating_pkr
  from public.expenses
  where deleted_at is null and kind = 'operating' and status = 'paid'
  group by 1
),
months as (select month from rev union select month from exp)
select m.month,
       coalesce(r.realized_revenue_pkr, 0) as realized_revenue_pkr,
       coalesce(e.paid_operating_pkr, 0) as paid_operating_pkr,
       coalesce(r.realized_revenue_pkr, 0) - coalesce(e.paid_operating_pkr, 0) as net_profit_pkr
from months m
left join rev r on r.month = m.month
left join exp e on e.month = m.month;

-- ---------------------------------------------------------------- partners (rules 11-15)
create view public.partner_capital with (security_invoker = true) as
with profit as (
  select coalesce((select sum(revenue_sign * realized_pkr) from public.payment_facts
                   where realized_date is not null and revenue_sign <> 0), 0)
       - coalesce((select sum(public.expense_pkr(amount, currency)) from public.expenses
                   where deleted_at is null and kind = 'operating' and status = 'paid'), 0) as net_profit
),
base as (
  select p.id as partner_id, p.name, p.email, p.sort_order, p.agreed_share_pct,
         coalesce((select sum(amount) from public.capital_movements m
                   where m.partner_id = p.id and m.deleted_at is null and m.type = 'contribution'), 0) as cash_contributed,
         coalesce((select sum(public.expense_pkr(amount, currency)) from public.expenses e
                   where e.paid_by_partner_id = p.id and e.deleted_at is null and e.kind = 'setup'
                     and e.status = 'paid'), 0) as setup_paid_personally,
         coalesce((select sum(amount) from public.capital_movements m
                   where m.partner_id = p.id and m.deleted_at is null and m.type = 'capital_return'), 0) as capital_returned,
         coalesce((select sum(amount) from public.capital_movements m
                   where m.partner_id = p.id and m.deleted_at is null and m.type = 'distribution'), 0) as distributions,
         coalesce((select sum(public.expense_pkr(amount, currency)) from public.expenses e
                   where e.paid_by_partner_id = p.id and e.deleted_at is null and e.kind = 'operating'
                     and e.status = 'paid' and e.reimbursable and e.reimbursed_date is null), 0) as reimbursements_owed
  from public.partners p
  where p.deleted_at is null
),
inv as (
  select base.*, cash_contributed + setup_paid_personally - capital_returned as total_invested from base
),
agg as (
  select sum(total_invested) as all_invested,
         max(case when agreed_share_pct > 0 then total_invested / agreed_share_pct end) as required_per_pct
  from inv
)
select i.partner_id, i.name, i.email, i.sort_order, i.agreed_share_pct,
       i.cash_contributed, i.setup_paid_personally, i.capital_returned, i.total_invested,
       case when agg.all_invested > 0 then round(i.total_invested / agg.all_invested, 6) else 0 end as capital_pct,
       greatest(0, round(greatest(agg.required_per_pct, 0) * i.agreed_share_pct, 2) - i.total_invested) as shortfall_to_equal,
       round(profit.net_profit * i.agreed_share_pct / 100, 2) as profit_share,
       i.distributions,
       round(profit.net_profit * i.agreed_share_pct / 100, 2) - i.distributions as undistributed,
       i.reimbursements_owed,
       case when i.total_invested > 0
            then round((round(profit.net_profit * i.agreed_share_pct / 100, 2)) / i.total_invested, 6) end
         as capital_recovered_pct,
       profit.net_profit as realized_net_profit
from inv i, agg, profit;

-- ---------------------------------------------------------------- project account (rule 14)
create view public.project_account_ledger with (security_invoker = true) as
with e as (
  select m.movement_date as entry_date, m.type::text as kind,
         case when m.type = 'contribution' then m.amount else -m.amount end as amount,
         'capital_movements'::text as source_table, m.id as source_id, p.name as description
  from public.capital_movements m
  join public.partners p on p.id = m.partner_id
  where m.deleted_at is null
  union all
  select f.realized_date,
         case when f.kind in ('deposit_in', 'deposit_refund', 'guest_refund') then f.kind::text else 'revenue' end,
         f.cash_sign * f.realized_pkr,
         'payments', f.id,
         coalesce(b.ref, '') || coalesce(' ' || g.name, '')
  from public.payment_facts f
  left join public.bookings b on b.id = f.booking_id
  left join public.guests g on g.id = b.guest_id
  where f.realized_date is not null and f.cash_sign <> 0
  union all
  select x.paid_date, 'expense', -public.expense_pkr(x.amount, x.currency), 'expenses', x.id, x.item
  from public.expenses x
  where x.deleted_at is null and x.status = 'paid' and x.paid_by_partner_id is null
  union all
  select x.reimbursed_date, 'reimbursement', -public.expense_pkr(x.amount, x.currency), 'expenses', x.id,
         x.item || ' (' || p.name || ')'
  from public.expenses x
  join public.partners p on p.id = x.paid_by_partner_id
  where x.deleted_at is null and x.status = 'paid' and x.kind = 'operating'
    and x.reimbursable and x.reimbursed_date is not null
)
select e.*,
       sum(amount) over (order by entry_date, source_table, source_id rows unbounded preceding) as balance
from e;

-- ---------------------------------------------------------------- vendors
create view public.vendor_balances with (security_invoker = true) as
select v.id as vendor_quote_id, v.vendor, v.description, v.quoted_amount, v.currency,
       coalesce(sum(e.amount) filter (where e.status = 'paid'), 0) as paid,
       v.quoted_amount - coalesce(sum(e.amount) filter (where e.status = 'paid'), 0) as remaining
from public.vendor_quotes v
left join public.expenses e on e.vendor_quote_id = v.id and e.deleted_at is null
where v.deleted_at is null
group by v.id;

-- Nobody outside the allowlist reads views; RLS on the underlying tables does the rest.
do $$
declare v text;
begin
  foreach v in array array['payment_facts', 'booking_financials', 'nightly_allocation', 'occupancy_daily',
                           'calendar_conflicts', 'monthly_pnl_accrual', 'monthly_pnl_cash', 'partner_capital',
                           'project_account_ledger', 'vendor_balances'] loop
    execute format('revoke all on public.%I from anon', v);
  end loop;
end $$;
revoke execute on function public.occupancy_stats(date, date, boolean) from anon, public;
grant execute on function public.occupancy_stats(date, date, boolean) to authenticated;

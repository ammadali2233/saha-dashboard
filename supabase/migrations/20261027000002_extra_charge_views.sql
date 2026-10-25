-- extra_charge is revenue and cash on its received date (accrual "other revenue" too).

create or replace view public.payment_facts with (security_invoker = true) as
select p.*,
       x.realized_date,
       case when x.realized_date is not null
            then case when p.currency = 'PKR' then p.amount_received else p.pkr_received end end as realized_pkr,
       case when p.kind in ('advance', 'balance', 'full', 'airbnb_payout', 'booking_com_payout',
                            'cancellation_payout', 'deposit_withheld', 'extra_charge') then 1
            when p.kind = 'guest_refund' then -1 else 0 end as revenue_sign,
       -- cash effect on the project account (withheld deposits were already in)
       case when p.kind in ('advance', 'balance', 'full', 'airbnb_payout', 'booking_com_payout',
                            'cancellation_payout', 'deposit_in', 'extra_charge') then 1
            when p.kind in ('guest_refund', 'deposit_refund') then -1 else 0 end as cash_sign,
       (p.status = 'received' and p.received_by_partner_id is not null and p.forwarded_date is null) as held_by_partner
from public.payments p
cross join lateral (
  select case when p.status = 'received'
              then case when p.received_by_partner_id is null then p.received_date else p.forwarded_date end
         end as realized_date
) x
where p.deleted_at is null;

create or replace view public.monthly_pnl_accrual with (security_invoker = true) as
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
    and kind in ('cancellation_payout', 'deposit_withheld', 'guest_refund', 'extra_charge')
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

-- Overview tiles with a period picker: every figure for one month, or "total so far" (p_month null).
-- Flows (occupancy, ADR, revenue, costs, profit) cover the period. Balances (project account, deposits,
-- capital recovered) are as at the period end, capped at today. Open items (on the books, payouts, guest
-- balances) are the ones falling in that month. Same rules as overview_kpis, only bounded by date.
create function public.kpi_period(p_month date default null, p_exclude_nonstandard boolean default false)
returns table (
  period_start date, period_end date, as_of date,
  occupied int, available int, occ_rate numeric, completed_nights int,
  adr_pkr numeric, adr_has_estimates boolean,
  realized_pkr numeric,
  opex_pkr numeric, opex_paid_pkr numeric,
  net_profit_pkr numeric,
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
  with s as (
    select go_live_date, default_usd_pkr from public.settings limit 1
  ), p as (
    -- nights in [ns, ne); dated flows in [ds, de); balances as at asof
    select case when p_month is null then s.go_live_date else date_trunc('month', p_month)::date end as ns,
           case when p_month is null then public.pk_today()
                else (date_trunc('month', p_month) + interval '1 month')::date end as ne,
           case when p_month is null then '-infinity'::date else date_trunc('month', p_month)::date end as ds,
           case when p_month is null then public.pk_today() + 1
                else (date_trunc('month', p_month) + interval '1 month')::date end as de,
           least(public.pk_today(),
                 case when p_month is null then public.pk_today()
                      else (date_trunc('month', p_month) + interval '1 month')::date - 1 end) as asof
    from s
  ), na as (
    select n.*
    from public.nightly_allocation n, p, s
    where not (p_exclude_nonstandard and n.booking_type <> 'standard')
      and n.night >= s.go_live_date and n.night >= p.ns and n.night < p.ne
  ), cash as (
    select realized_date, revenue_sign * realized_pkr as v
    from public.payment_facts where realized_date is not null and revenue_sign <> 0
  ), ex as (
    select e.*, public.expense_pkr(e.amount, e.currency) as pkr
    from public.expenses e where e.deleted_at is null
  ), pay as (
    select p.*
    from public.payment_facts p
    where p.booking_id is null
       or exists (select 1 from public.bookings x where x.id = p.booking_id and x.deleted_at is null
                  and x.status in ('tentative', 'confirmed', 'in_house', 'completed'))
  ), flows as (
    select
      coalesce((select sum(v) from cash, p where realized_date >= p.ds and realized_date < p.de), 0) as realized,
      coalesce((select sum(pkr) from ex, p where kind = 'operating' and expense_date >= p.ds and expense_date < p.de), 0) as opex,
      coalesce((select sum(pkr) from ex, p where kind = 'operating' and status = 'paid' and paid_date >= p.ds and paid_date < p.de), 0) as opex_paid,
      -- cumulative to the as-at date, for capital recovered (rule 15)
      coalesce((select sum(v) from cash, p where realized_date <= p.asof), 0)
        - coalesce((select sum(pkr) from ex, p where kind = 'operating' and status = 'paid' and paid_date <= p.asof), 0) as profit_asof,
      coalesce((select sum(case when type = 'contribution' then amount else -amount end) from public.capital_movements, p
                where deleted_at is null and type in ('contribution', 'capital_return') and movement_date <= p.asof), 0)
        + coalesce((select sum(pkr) from ex, p where kind = 'setup' and status = 'paid' and paid_by_partner_id is not null
                    and paid_date <= p.asof), 0) as invested_asof
  ), open_items as (
    select
      count(*) filter (where kind in ('airbnb_payout', 'booking_com_payout') and (status not in ('received', 'waived') or held_by_partner)
                         and (p_month is null or (due_date >= p.ds and due_date < p.de)))::int as payouts_n,
      coalesce(sum(case when currency = 'USD' then coalesce(amount_received, amount_due) * (select default_usd_pkr from s)
                        else coalesce(amount_received, amount_due) end)
               filter (where kind in ('airbnb_payout', 'booking_com_payout') and (status not in ('received', 'waived') or held_by_partner)
                         and (p_month is null or (due_date >= p.ds and due_date < p.de))), 0) as payouts_pkr,
      coalesce(sum(amount_due) filter (where kind in ('advance', 'balance', 'full') and status not in ('received', 'waived') and currency = 'PKR'
                                         and (p_month is null or (due_date >= p.ds and due_date < p.de))), 0) as guest_due,
      coalesce(sum(amount_received) filter (where kind = 'deposit_in' and status = 'received' and received_date <= p.asof), 0)
        - coalesce(sum(amount_received) filter (where kind in ('deposit_refund', 'deposit_withheld') and status = 'received'
                                                  and received_date <= p.asof), 0) as deposits
    from pay, p
  ), books as (
    -- booked = confirmed stays not yet completed (rule 3); a month shows the nights falling in it
    select coalesce(sum(n.net_pkr), 0) as v, coalesce(bool_or(n.pkr_is_estimate), false) as est
    from public.nightly_allocation n, p
    where n.revenue_state = 'booked' and (p_month is null or (n.night >= p.ns and n.night < p.ne))
  ), o as (
    select o.* from p, public.occupancy_stats(p.ns, p.ne, p_exclude_nonstandard) o
  )
  select
    p.ns, p.ne, p.asof,
    o.occupied, o.available, o.rate,
    (select count(distinct night)::int from na where na.revenue_state = 'earned'),
    (select round(sum(net_pkr) / nullif(count(*), 0), 2) from na),
    coalesce((select bool_or(pkr_is_estimate) from na), false),
    flows.realized,
    flows.opex, flows.opex_paid,
    flows.realized - flows.opex_paid,
    public.ledger_balance_at(p.asof),
    books.v, books.est,
    open_items.payouts_n, round(open_items.payouts_pkr, 2),
    open_items.guest_due,
    open_items.deposits,
    flows.invested_asof,
    case when flows.invested_asof > 0 then round(flows.profit_asof / flows.invested_asof, 4) end
  from p, o, flows, open_items, books
$$;
revoke execute on function public.kpi_period(date, boolean) from public, anon;
grant execute on function public.kpi_period(date, boolean) to authenticated;

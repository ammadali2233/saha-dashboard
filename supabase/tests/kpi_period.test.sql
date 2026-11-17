-- Overview tiles filtered by month or "total so far" (kpi_period).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

truncate public.bookings, public.booking_lines, public.payments, public.calendar_blocks, public.guests,
  public.expenses, public.capital_movements, public.tasks, public.inquiries, public.quotes, public.quote_lines,
  public.doc_counters, public.sync_runs cascade;

-- fixed "today": 10 Nov 2026 in Karachi
create or replace function public.pk_today() returns date language sql stable set search_path = '' as $$ select '2026-11-10'::date $$;

-- completed direct stay 13-15 Oct, 2 x 10,000, paid in full 13 Oct
insert into public.bookings (id, channel_id, check_in, check_out, status, source)
select '22222222-0000-0000-0000-000000000001', id, '2026-10-13', '2026-10-15', 'completed', 'manual' from public.channels where code = 'direct';
insert into public.booking_lines (booking_id, kind, label, qty, unit_amount, amount, currency)
values ('22222222-0000-0000-0000-000000000001', 'accommodation', '2 nights', 2, 10000, 20000, 'PKR');
insert into public.payments (booking_id, kind, currency, amount_due, due_date, status, amount_received, received_date)
values ('22222222-0000-0000-0000-000000000001', 'full', 'PKR', 20000, '2026-10-13', 'received', 20000, '2026-10-13');

-- confirmed direct stay 30 Nov - 3 Dec, 3 x 12,000: advance 6,000 received 5 Nov, balance due 30 Nov
insert into public.bookings (id, channel_id, check_in, check_out, status, source)
select '22222222-0000-0000-0000-000000000002', id, '2026-11-30', '2026-12-03', 'confirmed', 'manual' from public.channels where code = 'direct';
insert into public.booking_lines (booking_id, kind, label, qty, unit_amount, amount, currency)
values ('22222222-0000-0000-0000-000000000002', 'accommodation', '3 nights', 3, 12000, 36000, 'PKR');
delete from public.payments where booking_id = '22222222-0000-0000-0000-000000000002';
insert into public.payments (booking_id, kind, currency, amount_due, due_date, status, amount_received, received_date) values
  ('22222222-0000-0000-0000-000000000002', 'advance', 'PKR', 6000, '2026-11-05', 'received', 6000, '2026-11-05'),
  ('22222222-0000-0000-0000-000000000002', 'balance', 'PKR', 30000, '2026-11-30', 'scheduled', null, null);
delete from public.payments where booking_id = '22222222-0000-0000-0000-000000000001' and kind <> 'full';

-- operating costs: October bill paid 2 Nov, November bill unpaid
insert into public.expenses (expense_date, kind, category, item, amount, status, paid_date) values
  ('2026-10-25', 'operating', 'Internet & TV', 'Internet Oct', 4500, 'paid', '2026-11-02'),
  ('2026-11-08', 'operating', 'Cleaning', 'Supplies', 2000, 'due', null);

select results_eq($$ select occupied, available, completed_nights from public.kpi_period('2026-10-01') $$,
  $$ values (2, 27, 2) $$, 'October occupancy from go-live, 2 completed nights');
select results_eq($$ select occupied, available from public.kpi_period('2026-11-01') $$,
  $$ values (1, 30) $$, 'November: the 30 Nov night is on the books');
select results_eq($$ select occupied, available from public.kpi_period(null) $$,
  $$ values (2, 36) $$, 'total so far: nights from go-live (5 Oct) to last night (9 Nov)');

select results_eq($$ select adr_pkr from public.kpi_period('2026-10-01') union all select adr_pkr from public.kpi_period('2026-11-01') $$,
  $$ values (10000.00::numeric), (12000.00::numeric) $$, 'ADR per month');

select results_eq($$ select realized_pkr, opex_pkr, opex_paid_pkr, net_profit_pkr from public.kpi_period('2026-10-01') $$,
  $$ values (20000.00::numeric, 4500.00::numeric, 0::numeric, 20000.00::numeric) $$,
  'October: cash in, costs incurred, nothing paid yet');
select results_eq($$ select realized_pkr, opex_pkr, opex_paid_pkr, net_profit_pkr from public.kpi_period('2026-11-01') $$,
  $$ values (6000.00::numeric, 2000.00::numeric, 4500.00::numeric, 1500.00::numeric) $$,
  'November: advance in, October bill paid in November (cash basis)');
select results_eq($$ select realized_pkr, opex_pkr, net_profit_pkr from public.kpi_period(null) $$,
  $$ values (26000.00::numeric, 6500.00::numeric, 21500.00::numeric) $$, 'total so far');

select results_eq($$ select on_the_books_pkr, guest_balances_due_pkr from public.kpi_period('2026-11-01') $$,
  $$ values (12000.00::numeric, 30000.00::numeric) $$, 'November: one booked night, balance due 30 Nov');
select results_eq($$ select on_the_books_pkr, guest_balances_due_pkr from public.kpi_period('2026-12-01') $$,
  $$ values (24000.00::numeric, 0::numeric) $$, 'December: two booked nights, nothing due');
select results_eq($$ select on_the_books_pkr, guest_balances_due_pkr from public.kpi_period(null) $$,
  $$ values (36000.00::numeric, 30000.00::numeric) $$, 'total: whole stay on the books');

select is((select as_of from public.kpi_period('2026-10-01')), '2026-10-31'::date, 'balances for a past month are at its end');
select is((select as_of from public.kpi_period('2026-12-01')), '2026-11-10'::date, 'never later than today');
select is((select project_balance_pkr from public.kpi_period('2026-10-01')), public.ledger_balance_at('2026-10-31'),
  'project account at month end');

-- revenue by stay month: earned and on-the-books kept apart; cancellation payout on its received date
insert into public.bookings (id, channel_id, check_in, check_out, status, source)
select ('22222222-0000-0000-0000-000000000003'), id, '2026-11-20', '2026-11-22', 'cancelled', 'manual' from public.channels where code = 'direct';
insert into public.payments (booking_id, kind, currency, amount_due, status, amount_received, received_date)
values ('22222222-0000-0000-0000-000000000003', 'cancellation_payout', 'PKR', 5000, 'received', 5000, '2026-11-03');
select results_eq($$ select stay_earned_pkr, stay_booked_pkr, other_revenue_pkr from public.kpi_period('2026-10-01') $$,
  $$ values (20000.00::numeric, 0::numeric, 0::numeric) $$, 'October revenue: the completed stay');
select results_eq($$ select stay_earned_pkr, stay_booked_pkr, other_revenue_pkr from public.kpi_period('2026-11-01') $$,
  $$ values (0::numeric, 12000.00::numeric, 5000.00::numeric) $$, 'November: one night on the books, cancellation payout earned');
select results_eq($$ select stay_earned_pkr, stay_booked_pkr, other_revenue_pkr from public.kpi_period(null) $$,
  $$ values (20000.00::numeric, 36000.00::numeric, 5000.00::numeric) $$, 'total so far');
select is((select stay_earned_pkr + stay_booked_pkr + other_revenue_pkr from public.kpi_period('2026-11-01')),
  (select stay_revenue_pkr + other_revenue_pkr from public.monthly_pnl_accrual where month = '2026-11-01'),
  'same month revenue as the accrual P&L');

-- matches the existing overview figures
select is((select realized_pkr from public.kpi_period(null)), (select realized_to_date_pkr from public.overview_kpis()), 'same realized total as overview_kpis');
select is((select net_profit_pkr from public.kpi_period(null)), (select realized_net_profit_pkr from public.overview_kpis()), 'same net profit as overview_kpis');

select * from finish();
rollback;

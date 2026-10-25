-- Overview KPIs and alerts.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

truncate public.bookings, public.booking_lines, public.payments, public.calendar_blocks, public.guests,
  public.expenses, public.capital_movements, public.tasks, public.inquiries, public.quotes, public.quote_lines,
  public.doc_counters, public.sync_runs cascade;

-- fixed "today": 25 Oct 2026 in Karachi
create or replace function public.pk_today() returns date language sql stable set search_path = '' as $$ select '2026-10-25'::date $$;

insert into public.guests (id, name) values ('11111111-0000-0000-0000-000000000001', 'Past Guest'), ('11111111-0000-0000-0000-000000000002', 'Future Guest');

-- completed USD stay 10-12 Oct, payout expected 11 Oct and never recorded (overdue after 3 days)
insert into public.bookings (id, ref, channel_id, guest_id, check_in, check_out, status, source)
select '22222222-0000-0000-0000-000000000001', 'HMPAST0001', id, '11111111-0000-0000-0000-000000000001', '2026-10-10', '2026-10-12', 'completed', 'manual'
from public.channels where code = 'airbnb';
insert into public.booking_lines (booking_id, kind, label, qty, unit_amount, amount, currency)
values ('22222222-0000-0000-0000-000000000001', 'accommodation', '2 nights', 2, 50, 100, 'USD');
insert into public.payments (booking_id, kind, currency, amount_due, due_date, status)
values ('22222222-0000-0000-0000-000000000001', 'airbnb_payout', 'USD', 84.5, '2026-10-11', 'scheduled');

-- direct stay 1-4 Nov, balance due on check-in; deposit 1,000 collected for a stay that ended 15 Oct
insert into public.bookings (id, channel_id, guest_id, check_in, check_out, status, source, needs_details)
select '22222222-0000-0000-0000-000000000002', id, '11111111-0000-0000-0000-000000000002', '2026-11-01', '2026-11-04', 'confirmed', 'ical', true
from public.channels where code = 'direct';
insert into public.booking_lines (booking_id, kind, label, qty, unit_amount, amount, currency)
values ('22222222-0000-0000-0000-000000000002', 'accommodation', '3 nights', 3, 10000, 30000, 'PKR');
insert into public.payments (booking_id, kind, currency, amount_due, due_date, status, amount_received, received_date) values
  ('22222222-0000-0000-0000-000000000002', 'advance', 'PKR', 9000, '2026-10-20', 'received', 9000, '2026-10-20'),
  ('22222222-0000-0000-0000-000000000002', 'balance', 'PKR', 21000, '2026-11-01', 'scheduled', null, null);

insert into public.bookings (id, channel_id, check_in, check_out, status, source)
select '22222222-0000-0000-0000-000000000003', id, '2026-10-13', '2026-10-15', 'completed', 'manual'
from public.channels where code = 'direct';
insert into public.payments (booking_id, kind, currency, amount_received, received_date, status)
values ('22222222-0000-0000-0000-000000000003', 'deposit_in', 'PKR', 1000, '2026-10-13', 'received');

insert into public.expenses (expense_date, kind, category, item, amount, status)
values ('2026-10-25', 'operating', 'Internet & TV', 'Internet bill', 4500, 'due');

insert into public.sync_runs (job_name, started_at, result, error) values
  ('ical_airbnb', '2026-10-25 08:00+05', 'ok', null),
  ('ical_airbnb', '2026-10-25 09:00+05', 'error', 'HTTP 500');

select set_eq($$ select kind from public.alerts $$,
  $$ values ('needs_details'), ('payout_overdue'), ('deposit_not_refunded'), ('expense_due'), ('sync_failed') $$,
  'alerts raised: stub, overdue payout, unsettled deposit, bill due, failed sync (balance not yet due)');

select results_eq($$ select occ_this_occupied, occ_this_available, occ_this_completed from public.overview_kpis() $$,
  $$ values (4, 27, 4) $$, 'October: 4 of 27 nights (from go-live), all completed');
select results_eq($$ select occ_next_occupied, occ_next_available from public.overview_kpis() $$,
  $$ values (3, 30) $$, 'November: 3 of 30 nights on the books');
select results_eq($$ select realized_to_date_pkr, guest_balances_due_pkr, deposits_held_pkr, pending_payouts_count from public.overview_kpis() $$,
  $$ values (9000.00::numeric, 21000.00::numeric, 1000.00::numeric, 1) $$,
  'realized, guest balances due, deposits held, pending payouts');
select is((select opex_mtd_pkr from public.overview_kpis()), 4500.00::numeric, 'operating expenses this month (incurred)');

-- once the balance date passes unpaid, it becomes an alert
create or replace function public.pk_today() returns date language sql stable set search_path = '' as $$ select '2026-11-02'::date $$;
select ok(exists (select 1 from public.alerts where kind = 'balance_unpaid'), 'unpaid balance after check-in raises an alert');

select * from finish();
rollback;

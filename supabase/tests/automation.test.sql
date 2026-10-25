-- Auto tasks, recurring expenses and the daily roll-forward.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

truncate public.bookings, public.booking_lines, public.payments, public.calendar_blocks, public.guests,
  public.expenses, public.capital_movements, public.tasks, public.inquiries, public.quotes, public.quote_lines,
  public.doc_counters, public.sync_runs cascade;

-- fixed "today": 15 Oct 2026 in Karachi (rolled back with the transaction)
create or replace function public.pk_today() returns date language sql stable set search_path = '' as $$ select '2026-10-15'::date $$;

insert into public.bookings (id, channel_id, check_in, check_out, status, source)
select '22222222-0000-0000-0000-000000000001', id, '2026-11-10', '2026-11-13', 'confirmed', 'manual'
from public.channels where code = 'direct';

select set_eq($$ select auto_key from public.tasks where deleted_at is null $$,
  $$ values ('booking:22222222-0000-0000-0000-000000000001:pre_arrival'),
            ('booking:22222222-0000-0000-0000-000000000001:collect'),
            ('booking:22222222-0000-0000-0000-000000000001:turnover'),
            ('booking:22222222-0000-0000-0000-000000000001:deposit') $$,
  'a confirmed direct booking gets its four tasks on insert');
select is((select due_date from public.tasks where auto_key like '%:pre_arrival'), '2026-11-08'::date, 'pre-arrival due 2 days before check-in');

update public.bookings set check_in = '2026-11-11' where id = '22222222-0000-0000-0000-000000000001';
select is((select due_date from public.tasks where auto_key like '%:pre_arrival'), '2026-11-09'::date, 'task dates follow the booking');

update public.tasks set status = 'done' where auto_key like '%:turnover';
update public.bookings set status = 'cancelled' where id = '22222222-0000-0000-0000-000000000001';
select is((select count(*) from public.tasks where deleted_at is null and status = 'todo'), 0::bigint,
  'cancelling removes open auto tasks');
select is((select count(*) from public.tasks where deleted_at is null and status = 'done'), 1::bigint,
  'completed tasks are kept');

-- Airbnb booking: no collect/deposit tasks
insert into public.bookings (id, ref, channel_id, check_in, check_out, status, source)
select '22222222-0000-0000-0000-000000000002', 'HMAUTO0001', id, '2026-10-20', '2026-10-27', 'confirmed', 'manual'
from public.channels where code = 'airbnb';
select is((select count(*) from public.tasks where booking_id = '22222222-0000-0000-0000-000000000002'), 2::bigint,
  'platform bookings get pre-arrival and turnover only');
insert into public.payments (booking_id, kind, currency, amount_due, due_date, status)
values ('22222222-0000-0000-0000-000000000002', 'airbnb_payout', 'USD', 100, '2026-10-21', 'scheduled');

-- roll forward on 26 Oct: in-house, payout overdue (21 Oct + 3 < 26 Oct), November rent generated
select is((public.roll_forward('2026-10-26') ->> 'checked_in')::int, 1, 'confirmed -> in_house on check-in');
select is((select status from public.bookings where id = '22222222-0000-0000-0000-000000000002'), 'in_house'::public.booking_status, 'status rolled');
select is((select status from public.payments where booking_id = '22222222-0000-0000-0000-000000000002'), 'overdue'::public.payment_status,
  'payout past the threshold is overdue');
select is((select count(*) from public.expenses where recurring_template_id is not null), 1::bigint,
  'rent for November generated a week ahead');
select is((public.roll_forward('2026-10-26') ->> 'recurring_expenses')::int, 0, 'running again generates nothing new');

select is((public.roll_forward('2026-10-27') ->> 'completed')::int, 1, 'in_house -> completed on check-out');
select is((select result from public.sync_runs where job_name = 'daily_roll_forward' order by started_at desc limit 1), 'ok',
  'each run is logged');

-- templates without an amount generate nothing until filled in
update public.recurring_expenses set amount = 12000, start_month = '2026-11-01', day_of_month = 10 where category = 'Electricity';
select is(public.generate_recurring_expenses('2026-11-05'), 1, 'electricity starts once it has an amount (due 10 Nov)');
select is((select count(*) from public.expenses where category = 'Water'), 0::bigint, 'blank templates stay silent');

select * from finish();
rollback;

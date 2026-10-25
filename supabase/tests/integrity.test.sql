-- Conflict blocking, generated nights, line signs, document numbers.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temp table ch as select id, code from public.channels;

insert into public.bookings (id, ref, channel_id, check_in, check_out, status)
select '22222222-0000-0000-0000-000000000001', 'HMAAAA0001', id, '2026-12-27', '2027-01-10', 'confirmed'
from ch where code = 'airbnb';

select is((select nights from public.bookings where ref = 'HMAAAA0001'), 14, 'nights is check_out - check_in');

select throws_ok($$ insert into public.bookings (channel_id, check_in, check_out)
  select id, '2027-01-09', '2027-01-12' from ch where code = 'direct' $$,
  'P0001', 'These dates overlap HMAAAA0001 (HMAAAA0001): 27 Dec 2026 to 10 Jan 2027.',
  'a manual booking overlapping another is blocked with a clear message');

select lives_ok($$ insert into public.bookings (channel_id, check_in, check_out)
  select id, '2027-01-10', '2027-01-12' from ch where code = 'direct' $$,
  'back-to-back turnover (check-in on the previous check-out day) is allowed');

select lives_ok($$ insert into public.bookings (channel_id, check_in, check_out, status)
  select id, '2026-12-28', '2026-12-30', 'cancelled' from ch where code = 'direct' $$,
  'a cancelled booking does not hold the dates');

select lives_ok($$ insert into public.bookings (channel_id, check_in, check_out, source, ical_uid)
  select id, '2026-12-30', '2027-01-02', 'ical', 'uid-1' from ch where code = 'booking_com' $$,
  'an iCal-sourced overlap is recorded rather than rejected');

select throws_ok($$ insert into public.calendar_blocks (start_date, end_date, reason)
  values ('2027-01-05', '2027-01-06', 'maintenance') $$, 'P0001', null,
  'a maintenance block over a booking is blocked');

select lives_ok($$ insert into public.calendar_blocks (start_date, end_date, reason, source)
  values ('2027-01-05', '2027-01-06', 'channel_hold', 'ical') $$,
  'channel holds are soft and never block');

select lives_ok($$ update public.bookings set notes = 'edited' where ical_uid = 'uid-1' $$,
  'editing an already-conflicting row without changing dates is allowed');

select throws_ok($$ insert into public.bookings (channel_id, check_in, check_out)
  select id, '2027-02-01', '2027-02-01' from ch where code = 'direct' $$, '23514', null,
  'check-out must be after check-in');

select throws_ok($$ insert into public.booking_lines (booking_id, kind, discount_subtype, label, unit_amount, amount, currency)
  values ('22222222-0000-0000-0000-000000000001', 'discount', 'custom', 'x', 100, 100, 'USD') $$, '23514', null,
  'discount lines must be negative');

select throws_ok($$ insert into public.booking_lines (booking_id, kind, label, unit_amount, amount, currency)
  values ('22222222-0000-0000-0000-000000000001', 'discount', 'x', -100, -100, 'USD') $$, '23514', null,
  'discount lines need a subtype');

select throws_ok($$ insert into public.expenses (expense_date, kind, category, item, amount, status)
  values ('2026-10-01', 'setup', 'Rent', 'x', 1, 'due') $$, '23514', null,
  'expense category must match its kind');

select throws_ok($$ insert into public.payments (kind, currency, amount_received, pkr_received, status, received_date)
  values ('advance', 'PKR', 1000, 900, 'received', '2026-10-01') $$, '23514', null,
  'a PKR payment cannot have a different PKR received figure');

select is(public.next_doc_number('Q', 2026), 'Q-2026-001', 'first quote number');
select is(public.next_doc_number('Q', 2026), 'Q-2026-002', 'quote numbers increment');
select is(public.next_doc_number('D', 2027), 'D-2027-001', 'direct booking numbers are separate per year');

select is((select count(*) from public.find_conflicts('2027-01-01', '2027-01-03') where is_hard), 2::bigint,
  'find_conflicts lists both hard overlaps');

select is(public.pk_today(), (now() at time zone 'Asia/Karachi')::date, 'pk_today uses Asia/Karachi');

select * from finish();
rollback;

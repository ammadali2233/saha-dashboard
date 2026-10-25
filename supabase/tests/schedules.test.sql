-- Expected payments are created when a booking is saved (rules 8 and 9).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

truncate public.bookings, public.booking_lines, public.payments, public.calendar_blocks, public.guests,
  public.expenses, public.capital_movements, public.tasks, public.inquiries, public.quotes, public.quote_lines,
  public.doc_counters, public.sync_runs cascade;

insert into public.app_users (email, display_name, role) values ('sched-owner@test.local', 'Sched', 'owner') on conflict do nothing;
select set_config('request.jwt.claims', '{"email":"sched-owner@test.local","sub":"00000000-0000-0000-0000-00000000bbbb"}', true);

-- direct: 30% advance on the booked date, 70% at check-in, 20% deposit
select public.save_booking(
  jsonb_build_object('channel_id', (select id from public.channels where code = 'direct'), 'booked_at', '2026-10-20',
                     'check_in', '2026-11-22', 'check_out', '2026-11-29', 'status', 'confirmed'),
  '[{"kind":"accommodation","label":"7 nights","qty":7,"unit_amount":20000,"amount":140000,"currency":"PKR"},
    {"kind":"discount","discount_subtype":"friends_family","label":"F&F","qty":7,"unit_amount":-5000,"amount":-35000,"currency":"PKR"}]'::jsonb,
  '{"name":"Schedule Guest"}'::jsonb) as d \gset

select results_eq(
  format($$ select kind::text, amount_due, due_date from public.payments where booking_id = %L order by kind $$, :'d'),
  $$ values ('advance', 31500.00::numeric, '2026-10-20'::date), ('balance', 73500.00::numeric, '2026-11-22'::date),
            ('deposit_in', 21000.00::numeric, '2026-11-22'::date) $$,
  'direct booking: advance 30%, balance at check-in, deposit 20% (as on the quote)');

-- advance received, then the price changes: only the balance moves
update public.payments set status = 'received', amount_received = 31500, received_date = '2026-10-21'
where booking_id = :'d' and kind = 'advance';
select public.save_booking(
  jsonb_build_object('id', :'d', 'channel_id', (select id from public.channels where code = 'direct'),
                     'check_in', '2026-11-22', 'check_out', '2026-11-29', 'status', 'confirmed'),
  '[{"kind":"accommodation","label":"7 nights","qty":7,"unit_amount":20000,"amount":140000,"currency":"PKR"}]'::jsonb);
select is((select amount_due from public.payments where booking_id = :'d' and kind = 'balance'), 108500.00::numeric,
  'balance = new total - advance already received');
select is((select count(*) from public.payments where booking_id = :'d' and deleted_at is null), 3::bigint, 'no duplicate rows');

-- Airbnb: one payout for the net, expected check-in + lag
select public.save_booking(
  jsonb_build_object('channel_id', (select id from public.channels where code = 'airbnb'), 'ref', 'HMSCHED001',
                     'check_in', '2026-12-27', 'check_out', '2027-01-10', 'status', 'confirmed'),
  '[{"kind":"accommodation","label":"14 nights","qty":14,"unit_amount":40,"amount":560,"currency":"USD"},
    {"kind":"cleaning_fee","label":"Cleaning","qty":1,"unit_amount":20,"amount":20,"currency":"USD"}]'::jsonb) as a \gset
select results_eq(
  format($$ select kind::text, currency::text, amount_due, due_date from public.payments where booking_id = %L $$, :'a'),
  $$ values ('airbnb_payout', 'USD', 490.10::numeric, '2026-12-28'::date) $$,
  'Airbnb booking: payout of the net expected the day after check-in');

-- a stub with no charges yet gets no schedule
insert into public.bookings (id, ref, channel_id, check_in, check_out, status, source, needs_details)
select '22222222-0000-0000-0000-00000000000a', 'HMSTUB0001', id, '2027-02-01', '2027-02-03', 'confirmed', 'ical', true
from public.channels where code = 'airbnb';
select public.ensure_payment_schedule('22222222-0000-0000-0000-00000000000a');
select is((select count(*) from public.payments where booking_id = '22222222-0000-0000-0000-00000000000a'), 0::bigint,
  'stubs without charges get no payments');

-- only the owner can set a calendar link, and nobody reads it back
select throws_ok($$ select public.set_channel_ical_url((select id from public.channels where code = 'airbnb'), 'http://insecure') $$,
  'P0001', null, 'calendar links must be https');
select lives_ok($$ select public.set_channel_ical_url((select id from public.channels where code = 'airbnb'), 'https://example.test/feed.ics') $$,
  'owner sets the link');
select is((select ical_configured from public.channels where code = 'airbnb'), true, 'channel shows it as configured');

select * from finish();
rollback;

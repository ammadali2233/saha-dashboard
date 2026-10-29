-- Bulk forwarding of USD payouts held by a partner into the project account.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

truncate public.bookings, public.booking_lines, public.payments, public.calendar_blocks, public.guests,
  public.expenses, public.capital_movements, public.tasks, public.inquiries, public.quotes, public.quote_lines,
  public.doc_counters, public.sync_runs cascade;
create or replace function public.pk_today() returns date language sql stable set search_path = '' as $$ select '2026-10-29'::date $$;

insert into public.app_users (email, display_name, role) values ('fwd-owner@test.local', 'F', 'owner') on conflict do nothing;
select set_config('request.jwt.claims', '{"email":"fwd-owner@test.local","sub":"00000000-0000-0000-0000-00000000dddd"}', true);

insert into public.bookings (id, ref, channel_id, check_in, check_out, status, source)
select x.id::uuid, x.ref, c.id, x.ci::date, x.co::date, 'completed', 'import'
from public.channels c,
     (values ('22222222-0000-0000-0000-0000000000a1', 'HMFWD00001', '2026-10-01', '2026-10-03'),
             ('22222222-0000-0000-0000-0000000000a2', 'HMFWD00002', '2026-10-20', '2026-10-27')) x(id, ref, ci, co)
where c.code = 'airbnb';
insert into public.booking_lines (booking_id, kind, label, qty, unit_amount, amount, currency) values
  ('22222222-0000-0000-0000-0000000000a1', 'accommodation', '2n', 2, 40, 80, 'USD'),
  ('22222222-0000-0000-0000-0000000000a2', 'accommodation', '5n', 5, 51, 255, 'USD'),
  ('22222222-0000-0000-0000-0000000000a2', 'cleaning_fee', 'Cleaning', 1, 10, 10, 'USD'); -- net after 15.5% = 223.92, the payout
insert into public.payments (id, booking_id, kind, currency, amount_received, received_date, received_by_partner_id, status) values
  ('44444444-0000-0000-0000-0000000000a1', '22222222-0000-0000-0000-0000000000a1', 'airbnb_payout', 'USD', 67.60, '2026-10-02',
   (select id from public.partners where name = 'Ammad Ali'), 'received'),
  ('44444444-0000-0000-0000-0000000000a2', '22222222-0000-0000-0000-0000000000a2', 'airbnb_payout', 'USD', 223.92, '2026-10-21',
   (select id from public.partners where name = 'Ammad Ali'), 'received');

select is((select count(*) from public.payment_facts where held_by_partner), 2::bigint, 'two payouts held before forwarding');

select throws_like($$ select public.forward_payouts(
  '[{"id":"44444444-0000-0000-0000-0000000000a1","pkr":18000},{"id":"44444444-0000-0000-0000-0000000000a2","pkr":60000}]',
  280, 80000, '2026-10-28') $$, 'The split (PKR 78000) does not add up%', 'parts must add up to the total');
select is((select count(*) from public.payment_facts where held_by_partner), 2::bigint, 'a failed forward changes nothing');

select throws_like($$ select public.forward_payouts('[{"id":"44444444-0000-0000-0000-0000000000a1","pkr":18000}]', 280, 18000, '2026-11-05') $$,
  'Enter the date%', 'no future forwarding dates');

select is(public.forward_payouts(
  '[{"id":"44444444-0000-0000-0000-0000000000a1","pkr":18456.24},{"id":"44444444-0000-0000-0000-0000000000a2","pkr":61130.76}]',
  275, 79587.00, '2026-10-28'), 2, 'forwards both payouts');

select results_eq($$ select pkr_received, fx_rate, forwarded_date, realized_date from public.payment_facts order by received_date $$,
  $$ values (18456.24::numeric, 275::numeric, '2026-10-28'::date, '2026-10-28'::date),
            (61130.76::numeric, 275::numeric, '2026-10-28'::date, '2026-10-28'::date) $$,
  'each payout keeps its share; revenue is realized on the forwarding date');
select is((select count(*) from public.payment_facts where held_by_partner), 0::bigint, 'nothing held any more');
select is((select count(*) from public.alerts where kind = 'payout_held'), 0::bigint, 'the "held by" alerts clear');
select results_eq($$ select pkr_is_estimate, net_pkr from public.booking_financials where ref = 'HMFWD00002' $$,
  $$ values (false, 61130.76::numeric) $$, 'the booking uses the actual PKR, no longer an estimate');
select is((select sum(amount) from public.project_account_ledger where kind = 'revenue'), 79587.00::numeric,
  'the project account receives exactly the PKR that arrived');

select throws_like($$ select public.forward_payouts('[{"id":"44444444-0000-0000-0000-0000000000a1","pkr":100}]', 280, 100, '2026-10-29') $$,
  'A selected payout is not waiting%', 'a payout cannot be forwarded twice');

select * from finish();
rollback;

-- Marking payouts as received in a partner's account, including early.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

truncate public.bookings, public.booking_lines, public.payments, public.calendar_blocks, public.guests,
  public.expenses, public.capital_movements, public.tasks, public.inquiries, public.quotes, public.quote_lines,
  public.doc_counters, public.sync_runs cascade;
create or replace function public.pk_today() returns date language sql stable set search_path = '' as $$ select '2026-10-29'::date $$;

insert into public.app_users (email, display_name, role) values ('mark-owner@test.local', 'M', 'owner') on conflict do nothing;
select set_config('request.jwt.claims', '{"email":"mark-owner@test.local","sub":"00000000-0000-0000-0000-00000000eeee"}', true);

-- a stay that starts tomorrow: payout expected 30 Oct, but it arrived early on 29 Oct
insert into public.bookings (id, ref, channel_id, check_in, check_out, status, source)
select '22222222-0000-0000-0000-0000000000b1', 'HMEARLY001', id, '2026-10-28', '2026-10-31', 'in_house', 'import'
from public.channels where code = 'airbnb';
insert into public.payments (id, booking_id, kind, currency, amount_due, due_date, status) values
  ('44444444-0000-0000-0000-0000000000b1', '22222222-0000-0000-0000-0000000000b1', 'airbnb_payout', 'USD', 137.73, '2026-10-30', 'scheduled');

select throws_like($$ select public.mark_payouts_received('[{"id":"44444444-0000-0000-0000-0000000000b1","amount":137.73}]', null, '2026-10-29') $$,
  'Choose whose account%', 'the receiving partner is required');
select throws_like($$ select public.mark_payouts_received('[{"id":"44444444-0000-0000-0000-0000000000b1","amount":137.73}]',
  (select id from public.partners where name = 'Ammad Ali'), '2026-11-02') $$, 'Enter the date%', 'no future dates');

select is(public.mark_payouts_received('[{"id":"44444444-0000-0000-0000-0000000000b1","amount":137.73}]',
  (select id from public.partners where name = 'Ammad Ali'), '2026-10-29'), 1, 'an early payout can be marked received');

select results_eq($$ select status::text, amount_received, received_date, held_by_partner, realized_date from public.payment_facts $$,
  $$ values ('received', 137.73::numeric, '2026-10-29'::date, true, null::date) $$,
  'it is now held by the partner: received, but not yet realized');
select ok(exists (select 1 from public.alerts where kind = 'payout_held'), 'and shows as a "held by" alert, ready to forward');

select throws_like($$ select public.mark_payouts_received('[{"id":"44444444-0000-0000-0000-0000000000b1","amount":137.73}]',
  (select id from public.partners where name = 'Ammad Ali'), '2026-10-29') $$, 'A selected payout is no longer waiting%',
  'a payout cannot be marked received twice');

-- and it can then be forwarded like any held payout
select is(public.forward_payouts('[{"id":"44444444-0000-0000-0000-0000000000b1","pkr":37500}]', 275, 37500, '2026-10-29'), 1,
  'the marked payout forwards to the project account');

select * from finish();
rollback;

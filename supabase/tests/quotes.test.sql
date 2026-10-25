-- Quote -> share link -> accept into a confirmed booking with its payment schedule.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

truncate public.bookings, public.booking_lines, public.payments, public.calendar_blocks, public.guests,
  public.expenses, public.capital_movements, public.tasks, public.inquiries, public.quotes, public.quote_lines,
  public.doc_counters, public.sync_runs cascade;

insert into public.app_users (email, display_name, role) values ('quote-owner@test.local', 'Q', 'owner') on conflict do nothing;
select set_config('request.jwt.claims', '{"email":"quote-owner@test.local","sub":"00000000-0000-0000-0000-00000000cccc"}', true);
select set_config('role', 'authenticated', true);

insert into public.guests (id, name, phone) values ('11111111-0000-0000-0000-0000000000aa', 'Quote Guest', '+92 300 1111111');
insert into public.inquiries (id, guest_id, channel_id, check_in, check_out, guest_count, status, follow_up_date)
select '33333333-0000-0000-0000-0000000000aa', '11111111-0000-0000-0000-0000000000aa', id, '2026-11-22', '2026-11-29', 6, 'new', '2026-10-01'
from public.channels where code = 'direct';

select ok(exists (select 1 from public.alerts where kind = 'inquiry_follow_up'), 'an inquiry past its follow-up date is an alert');

-- the "Quotation - Final" example: 7 nights at 20,000 less 5,000 a night friends and family
select public.save_quote(
  jsonb_build_object('inquiry_id', '33333333-0000-0000-0000-0000000000aa', 'guest_id', '11111111-0000-0000-0000-0000000000aa',
                     'prepared_for', 'Quote Guest', 'issue_date', '2026-10-19', 'check_in', '2026-11-22', 'check_out', '2026-11-29',
                     'guest_count', 6, 'advance_pct', 30, 'deposit_amount', 21000, 'valid_until', '2026-10-26'),
  '[{"kind":"accommodation","label":"Nightly rate, full house","qty":7,"unit_amount":20000,"amount":140000},
    {"kind":"discount","discount_subtype":"friends_family","label":"Friends and family discount","qty":7,"unit_amount":-5000,"amount":-35000}]'::jsonb
) as q \gset

select is((select number from public.quotes where id = :'q'), 'Q-2026-001', 'quotes are numbered Q-YYYY-NNN');
select is((select status from public.inquiries where id = '33333333-0000-0000-0000-0000000000aa'), 'quoted'::public.inquiry_status,
  'the inquiry moves to quoted');

-- share link: only the token's hash is stored; drafts are never public
update public.quotes set share_token_hash = encode(extensions.digest('share-me', 'sha256'), 'hex') where id = :'q';
set local role anon;
select is(public.get_public_quote('share-me'), null, 'a draft is not visible through its link');
reset role;
select set_config('role', 'authenticated', true);
update public.quotes set status = 'sent' where id = :'q';
set local role anon;
select is((public.get_public_quote('share-me') ->> 'number'), 'Q-2026-001', 'anyone with the token sees the sent quote');
select is(jsonb_array_length(public.get_public_quote('share-me') -> 'lines'), 2, 'with its lines');
select is(public.get_public_quote('wrong-token'), null, 'a wrong token sees nothing');
select is((select count(*) from public.quotes), 0::bigint, 'anon still cannot read the quotes table');
reset role;
select set_config('role', 'authenticated', true);

-- accept: confirmed booking, lines, the quote's own schedule, tasks, inquiry won
select public.accept_quote(:'q') as b \gset
select results_eq(format($$ select status::text, net, ref ~ '^D-2026-\d{3}$' from public.booking_financials where booking_id = %L $$, :'b'),
  $$ values ('confirmed', 105000.00::numeric, true) $$, 'accepting creates a confirmed D-booking for PKR 105,000');
select results_eq(format($$ select kind::text, amount_due from public.payments where booking_id = %L and deleted_at is null order by kind $$, :'b'),
  $$ values ('advance', 31500.00::numeric), ('balance', 73500.00::numeric), ('deposit_in', 21000.00::numeric) $$,
  'with the quoted advance, balance and deposit (no duplicates)');
select is((select guest_id from public.bookings where id = :'b'), '11111111-0000-0000-0000-0000000000aa'::uuid, 'for the inquiry''s guest');
select ok((select count(*) from public.tasks where booking_id = :'b') >= 3, 'booking tasks are created');
select results_eq(format($$ select q.status::text, i.status::text from public.quotes q join public.inquiries i on i.quote_id = q.id where q.id = %L $$, :'q'),
  $$ values ('accepted', 'won') $$, 'quote accepted, inquiry won');
select throws_ok(format($$ select public.accept_quote(%L) $$, :'q'), 'P0001', 'This quote is already accepted.', 'a quote is accepted once');

-- a quote for dates that are now taken cannot be accepted
select public.save_quote(
  jsonb_build_object('prepared_for', 'Late Guest', 'check_in', '2026-11-25', 'check_out', '2026-11-27'),
  '[{"kind":"accommodation","label":"2 nights","qty":2,"unit_amount":20000,"amount":40000}]'::jsonb) as q2 \gset
select throws_like(format($$ select public.accept_quote(%L) $$, :'q2'), 'These dates overlap%', 'accepting is refused when the dates are taken');

select * from finish();
rollback;

-- A booking whose dates the sync changed is flagged until a person saves it.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

truncate public.bookings, public.booking_lines, public.payments, public.calendar_blocks, public.guests,
  public.expenses, public.capital_movements, public.tasks, public.inquiries, public.quotes, public.quote_lines,
  public.doc_counters, public.sync_runs cascade;

insert into public.bookings (id, ref, channel_id, check_in, check_out, status, source)
select '22222222-0000-0000-0000-0000000000f1', 'HMFLAG0001', id, '2026-12-01', '2026-12-13', 'confirmed', 'import'
from public.channels where code = 'airbnb';

-- the sync (service role: no signed-in user) shortens the stay and flags it
update public.bookings set check_out = '2026-12-10', sync_changed_at = now(),
  sync_change_note = 'was 1 Dec 2026 to 13 Dec 2026, now 1 Dec 2026 to 10 Dec 2026'
where id = '22222222-0000-0000-0000-0000000000f1';

select results_eq($$ select kind, detail from public.alerts where kind = 'dates_changed' $$,
  $$ values ('dates_changed'::text, 'HMFLAG0001: was 1 Dec 2026 to 13 Dec 2026, now 1 Dec 2026 to 10 Dec 2026'::text) $$,
  'a date change by the sync is an alert with the old and new dates');

-- a later sync run that touches the row again keeps the flag
update public.bookings set ical_uid = 'uid-flag' where id = '22222222-0000-0000-0000-0000000000f1';
select isnt((select sync_changed_at from public.bookings where id = '22222222-0000-0000-0000-0000000000f1'), null,
  'the sync itself never clears the flag');

-- a person saves the booking (e.g. after fixing the nights): the flag clears
insert into public.app_users (email, display_name, role) values ('flag-owner@test.local', 'F', 'owner') on conflict do nothing;
select set_config('request.jwt.claims', '{"email":"flag-owner@test.local","sub":"00000000-0000-0000-0000-00000000ffff"}', true);
update public.bookings set notes = 'charges checked' where id = '22222222-0000-0000-0000-0000000000f1';
select results_eq($$ select sync_changed_at is null, sync_change_note is null from public.bookings where id = '22222222-0000-0000-0000-0000000000f1' $$,
  $$ values (true, true) $$, 'saving by a person clears the flag');
select is((select count(*) from public.alerts where kind = 'dates_changed'), 0::bigint, 'and the alert goes away');

select * from finish();
rollback;

-- Policy tests per role: owner, partner, staff, outsider (signed in but not on the allowlist), anon.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- start from empty business tables (local dev data must not leak in); rolled back at the end
truncate public.bookings, public.booking_lines, public.payments, public.calendar_blocks, public.guests,
  public.expenses, public.capital_movements, public.tasks, public.inquiries, public.quotes, public.quote_lines,
  public.doc_counters cascade;

-- ---------------------------------------------------------------- fixtures (as postgres, RLS bypassed)
delete from public.app_users where email like '%@test.local'; -- local dev logins; rolled back at the end
insert into public.app_users (email, display_name, role, active) values
  ('owner@test.local', 'Owner', 'owner', true),
  ('partner@test.local', 'Partner', 'partner', true),
  ('staff@test.local', 'Staff', 'staff', true),
  ('former@test.local', 'Former', 'partner', false);

insert into public.guests (id, name, phone, email)
values ('11111111-0000-0000-0000-000000000001', 'Test Guest', '+92 300 0000000', 'guest@test.local');

insert into public.bookings (id, ref, channel_id, guest_id, check_in, check_out, status, checkin_notes)
select '22222222-0000-0000-0000-000000000001', 'HMTEST0001', id, '11111111-0000-0000-0000-000000000001',
       '2026-12-27', '2027-01-10', 'confirmed', 'Arriving late'
from public.channels where code = 'airbnb';

insert into public.payments (booking_id, kind, currency, amount_due, status)
values ('22222222-0000-0000-0000-000000000001', 'airbnb_payout', 'USD', 500, 'scheduled');

insert into public.tasks (id, title, booking_id, category)
values ('33333333-0000-0000-0000-000000000001', 'Turnover clean', '22222222-0000-0000-0000-000000000001', 'turnover');

create function pg_temp.login(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'email', p_email, 'sub', md5(p_email)::uuid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------- allowlist hook
select is(public.hook_before_user_created('{"user":{"email":"Partner@Test.local"}}'), '{}'::jsonb,
  'hook admits an allowlisted email (case-insensitive)');
select is((public.hook_before_user_created('{"user":{"email":"stranger@test.local"}}') -> 'error' ->> 'http_code')::int, 403,
  'hook rejects an email not on the allowlist');
select is((public.hook_before_user_created('{"user":{"email":"former@test.local"}}') -> 'error' ->> 'http_code')::int, 403,
  'hook rejects a deactivated user');

-- ---------------------------------------------------------------- anon
set local role anon;
select is((select count(*) from public.bookings), 0::bigint, 'anon sees no bookings');
select is((select count(*) from public.settings), 0::bigint, 'anon sees no settings');
select throws_ok($$ select * from public.staff_calendar $$, '42501', null, 'anon cannot read staff_calendar');
reset role;

-- ---------------------------------------------------------------- outsider
select pg_temp.login('stranger@test.local');
select is(public.app_role(), null, 'outsider has no role');
select is((select count(*) from public.bookings), 0::bigint, 'outsider sees no bookings');
select is((select count(*) from public.guests), 0::bigint, 'outsider sees no guests');
select is((select count(*) from public.staff_calendar), 0::bigint, 'outsider sees nothing in staff_calendar');
select throws_ok($$ insert into public.guests (name) values ('x') $$, '42501', null, 'outsider cannot insert');
select pg_temp.logout();

-- deactivated partner
select pg_temp.login('former@test.local');
select is((select count(*) from public.bookings), 0::bigint, 'deactivated partner sees no bookings');
select pg_temp.logout();

-- ---------------------------------------------------------------- staff
select pg_temp.login('staff@test.local');
select is(public.app_role(), 'staff'::public.app_role, 'staff role resolves');
select is((select count(*) from public.bookings), 0::bigint, 'staff cannot read bookings table');
select is((select count(*) from public.payments), 0::bigint, 'staff cannot read payments');
select is((select count(*) from public.booking_lines), 0::bigint, 'staff cannot read booking lines');
select is((select count(*) from public.expenses), 0::bigint, 'staff cannot read expenses');
select is((select count(*) from public.capital_movements), 0::bigint, 'staff cannot read capital');
select is((select count(*) from public.channels), 0::bigint, 'staff cannot read channel fees');
select is((select count(*) from public.settings), 0::bigint, 'staff cannot read settings');
select is((select count(*) from public.guests), 0::bigint, 'staff cannot read guest table (email)');
select is((select guest_name || '|' || guest_phone || '|' || checkin_notes from public.staff_calendar where item_type = 'booking'),
  'Test Guest|+92 300 0000000|Arriving late', 'staff sees guest name, phone and check-in notes');
select hasnt_column('public', 'staff_calendar', 'notes', 'staff_calendar exposes no free-form booking notes');
select is((select count(*) from public.tasks), 1::bigint, 'staff sees tasks');
select lives_ok($$ update public.tasks set status = 'done' where id = '33333333-0000-0000-0000-000000000001' $$, 'staff can update a task');
select throws_ok($$ insert into public.expenses (expense_date, kind, category, item, amount, paid_date)
  values ('2026-10-25', 'operating', 'Cleaning', 'x', 1, '2026-10-25') $$, '42501', null, 'staff cannot insert expenses');
select pg_temp.logout();

-- ---------------------------------------------------------------- partner
select pg_temp.login('partner@test.local');
select is(public.app_role(), 'partner'::public.app_role, 'partner role resolves');
select is((select count(*) from public.payments), 1::bigint, 'partner reads payments');
select is((select count(*) from public.channel_secrets), 0::bigint, 'partner cannot read iCal URLs');
select lives_ok($$ insert into public.expenses (expense_date, kind, category, item, amount, paid_date)
  values ('2026-10-25', 'operating', 'Cleaning', 'Deep clean', 5000, '2026-10-25') $$, 'partner can add an expense');
select is((select created_by from public.expenses where item = 'Deep clean'), md5('partner@test.local')::uuid,
  'created_by is filled from the session');
select is_empty($$ update public.settings set monthly_rent = 1 returning 1 $$, 'partner cannot change settings');
select is_empty($$ update public.channels set platform_fee_pct = 0 returning 1 $$, 'partner cannot change channel fees');
select throws_ok($$ insert into public.capital_movements (movement_date, partner_id, type, amount)
  select '2026-10-25', id, 'distribution', 1 from public.partners limit 1 $$, '42501', null,
  'partner cannot record capital movements');
select throws_ok($$ insert into public.app_users (email, display_name, role) values ('x@test.local', 'x', 'owner') $$,
  '42501', null, 'partner cannot add users');
select is_empty($$ delete from public.expenses where item = 'Deep clean' returning 1 $$, 'partner cannot hard delete');
select lives_ok($$ update public.expenses set deleted_at = now() where item = 'Deep clean' $$, 'partner can soft delete');
select throws_ok($$ update public.expenses set deleted_at = null where item = 'Deep clean' $$, '42501', null,
  'partner cannot restore a deleted row');
select is((select count(*) from public.audit_log where table_name = 'expenses' and coalesce(after, before) ->> 'item' = 'Deep clean'), 2::bigint,
  'partner can read the audit log (insert + soft delete logged)');
select pg_temp.logout();

-- ---------------------------------------------------------------- owner
select pg_temp.login('owner@test.local');
select lives_ok($$ update public.expenses set deleted_at = null where item = 'Deep clean' $$, 'owner can restore');
select isnt_empty($$ update public.settings set default_usd_pkr = 270 returning 1 $$, 'owner can change settings');
select isnt_empty($$ delete from public.expenses where item = 'Deep clean' returning 1 $$, 'owner can hard delete');
select is((select count(*) from public.channel_secrets), 0::bigint, 'even the owner cannot read iCal URLs from the browser');
select is((select action from public.audit_log where table_name = 'expenses' order by id desc limit 1), 'DELETE',
  'hard delete is audited');
select is((select user_email from public.audit_log where table_name = 'settings' order by id desc limit 1), 'owner@test.local',
  'audit records who made the change');
select pg_temp.logout();

select * from finish();
rollback;

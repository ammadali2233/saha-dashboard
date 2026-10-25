-- Golden values: the same scenarios as src/domain/golden.ts and the Vitest suite, number for number.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.app_users (email, display_name, role) values ('golden-owner@test.local', 'Golden', 'owner');
select set_config('request.jwt.claims', '{"email":"golden-owner@test.local","sub":"00000000-0000-0000-0000-00000000aaaa"}', true);

-- G1: Airbnb USD, 27 Dec 2026 to 10 Jan 2027, $560 accommodation + $20 cleaning, fee 15.5% computed
select public.save_booking(
  jsonb_build_object('channel_id', (select id from public.channels where code = 'airbnb'), 'ref', 'HMGOLDEN01',
                     'check_in', '2026-12-27', 'check_out', '2027-01-10', 'status', 'confirmed'),
  '[{"kind":"accommodation","label":"14 nights","qty":14,"unit_amount":40,"amount":560,"currency":"USD"},
    {"kind":"cleaning_fee","label":"Cleaning","qty":1,"unit_amount":20,"amount":20,"currency":"USD"}]'::jsonb,
  '{"name":"Golden Guest"}'::jsonb) as g1 \gset

-- G2: Direct PKR, 13 to 16 Nov 2026
select public.save_booking(
  jsonb_build_object('channel_id', (select id from public.channels where code = 'direct'),
                     'check_in', '2026-11-13', 'check_out', '2026-11-16', 'status', 'completed'),
  '[{"kind":"accommodation","label":"3 nights","qty":3,"unit_amount":12000,"amount":36000,"currency":"PKR"},
    {"kind":"discount","discount_subtype":"friends_family","label":"F&F","qty":3,"unit_amount":-1000,"amount":-3000,"currency":"PKR"},
    {"kind":"extra_mattress","label":"Mattress","qty":1,"unit_amount":2000,"amount":2000,"currency":"PKR"},
    {"kind":"cleaning_fee","label":"Cleaning","qty":1,"unit_amount":1500,"amount":1500,"currency":"PKR"}]'::jsonb) as g2 \gset

-- ---------------------------------------------------------------- booking totals (rule 2)
select results_eq(
  format($$ select gross, platform_fee, net, net_pkr, pkr_is_estimate from public.booking_financials where booking_id = %L $$, :'g1'),
  $$ values (580.00::numeric, -89.90::numeric, 490.10::numeric, 130856.70::numeric, true) $$,
  'G1 totals: gross 580, fee -89.90, net 490.10, est PKR 130,856.70');

select results_eq(
  format($$ select gross, discounts, platform_fee, net, net_pkr from public.booking_financials where booking_id = %L $$, :'g2'),
  $$ values (39500.00::numeric, -3000.00::numeric, 0::numeric, 36500.00::numeric, 36500.00::numeric) $$,
  'G2 totals: gross 39,500, discount -3,000, net 36,500');

select matches((select ref from public.bookings where id = :'g2'), '^D-2026-\d{3}$', 'direct booking gets a D-YYYY-NNN ref');
select is((select name from public.guests g join public.bookings b on b.guest_id = g.id where b.id = :'g1'), 'Golden Guest',
  'save_booking creates the guest');

-- ---------------------------------------------------------------- allocation (rule 4)
select results_eq(
  format($$ select month, count(*)::int, sum(net), sum(net_pkr) from public.nightly_allocation
            where booking_id = %L group by month order by month $$, :'g1'),
  $$ values ('2026-12-01'::date, 5, 185.90::numeric, 49635.30::numeric),
            ('2027-01-01'::date, 9, 304.20::numeric, 81221.40::numeric) $$,
  'G1: 5 nights in December, 9 in January; net and PKR split by month');

select results_eq(
  format($$ select fees, platform_fee from public.nightly_allocation where booking_id = %L order by night limit 2 $$, :'g1'),
  $$ values (20.00::numeric, -9.30::numeric), (0::numeric, -6.20::numeric) $$,
  'G1: fees on the check-in night; platform fee pro-rata to gross');

select results_eq(
  format($$ select discounts, net from public.nightly_allocation where booking_id = %L order by night $$, :'g2'),
  $$ values (-1000.00::numeric, 14500.00::numeric), (-1000.00::numeric, 11000.00::numeric), (-1000.00::numeric, 11000.00::numeric) $$,
  'G2: discount spreads with accommodation; fees on night one');

-- ---------------------------------------------------------------- lines editing
select public.save_booking(
  jsonb_build_object('id', :'g2', 'channel_id', (select id from public.channels where code = 'direct'),
                     'check_in', '2026-11-13', 'check_out', '2026-11-16', 'status', 'completed'),
  '[{"kind":"accommodation","label":"3 nights","qty":3,"unit_amount":12000,"amount":36000,"currency":"PKR"}]'::jsonb);
select is((select net from public.booking_financials where booking_id = :'g2'), 36000.00::numeric,
  're-saving with fewer lines soft-deletes the removed ones');
-- the re-save passed no line ids, so all 4 original lines are replaced by 1 new one
select is((select count(*) from public.booking_lines where booking_id = :'g2' and deleted_at is not null), 4::bigint,
  'removed lines are kept as soft-deleted rows');

select throws_ok(
  format($$ select public.save_booking(jsonb_build_object('id', %L, 'channel_id', (select id from public.channels where code = 'direct'),
            'check_in', '2026-11-13', 'check_out', '2026-11-16'),
            '[{"kind":"accommodation","label":"a","qty":1,"unit_amount":1,"amount":1,"currency":"PKR"},
              {"kind":"cleaning_fee","label":"b","qty":1,"unit_amount":1,"amount":1,"currency":"USD"}]'::jsonb) $$, :'g2'),
  'P0001', 'All line items in a booking must use the same currency.', 'mixed currencies are rejected');

-- ---------------------------------------------------------------- occupancy (rule 5)
select results_eq($$ select occupied, available from public.occupancy_stats('2026-12-01', '2027-01-01') $$,
  $$ values (5, 31) $$, 'December: 5 of 31 nights');
select results_eq($$ select occupied, available from public.occupancy_stats('2026-10-01', '2026-11-01') $$,
  $$ values (0, 27) $$, 'October: nights before go-live (5 Oct) are not available');

-- ---------------------------------------------------------------- partners and ledger (rules 11-15)
insert into public.capital_movements (movement_date, partner_id, type, amount)
select '2026-09-15', id, 'contribution', case name when 'Hamza Mahad Dar' then 800000 else 1000000 end
from public.partners;
insert into public.capital_movements (movement_date, partner_id, type, amount)
select '2026-12-31', id, 'distribution', 30000 from public.partners where name = 'Ammad Ali';

insert into public.expenses (expense_date, kind, category, item, amount, status, paid_date, paid_by_partner_id, reimbursable, reimbursed_date) values
  ('2026-09-20', 'setup', 'Furniture', 'Sofa', 50000, 'paid', '2026-09-20', (select id from public.partners where name = 'Mohammed Azeem'), false, null),
  ('2026-09-25', 'setup', 'Appliances', 'Fridge', 200000, 'paid', '2026-09-25', null, false, null),
  ('2026-11-01', 'operating', 'Rent', 'Rent Nov', 150000, 'paid', '2026-11-01', null, false, null),
  ('2026-11-05', 'operating', 'Guest Supplies', 'Toiletries', 8000, 'paid', '2026-11-05', (select id from public.partners where name = 'Saad Raza'), true, null),
  ('2026-11-01', 'operating', 'Cleaning', 'Deep clean', 2000, 'paid', '2026-11-01', (select id from public.partners where name = 'Saad Raza'), true, '2026-11-10'),
  ('2026-11-30', 'operating', 'Electricity', 'Bill', 9999, 'due', null, null, false, null);

-- G3: a direct stay paid in full, 560,000 realized
select public.save_booking(
  jsonb_build_object('channel_id', (select id from public.channels where code = 'direct'),
                     'check_in', '2026-11-20', 'check_out', '2026-11-25', 'status', 'completed'),
  '[{"kind":"accommodation","label":"5 nights","qty":5,"unit_amount":112000,"amount":560000,"currency":"PKR"}]'::jsonb) as g3 \gset
insert into public.payments (booking_id, kind, currency, amount_received, received_date, status, method)
values (:'g3', 'full', 'PKR', 560000, '2026-11-20', 'received', 'bank_transfer');

select results_eq(
  $$ select name, total_invested, shortfall_to_equal, profit_share, undistributed, reimbursements_owed
     from public.partner_capital order by sort_order $$,
  $$ values ('Ammad Ali'::text, 1000000::numeric, 50000::numeric, 100000.00::numeric, 70000.00::numeric, 0::numeric),
            ('Hamza Mahad Dar', 800000, 250000, 100000.00, 100000.00, 0),
            ('Mohammed Azeem', 1050000, 0, 100000.00, 100000.00, 0),
            ('Saad Raza', 1000000, 50000, 100000.00, 100000.00, 8000) $$,
  'partner capital: setup paid personally is capital, profit split 25% each, distributions reduce undistributed');

select is((select capital_recovered_pct from public.partner_capital where name = 'Ammad Ali'), 0.100000::numeric,
  'capital recovered % = (distributions + undistributed) / invested');

select is((select balance from public.project_account_ledger order by entry_date desc, source_table desc, source_id desc limit 1),
  3978000.00::numeric, 'project account balance from the ledger');

select results_eq($$ select realized_revenue_pkr, paid_operating_pkr from public.monthly_pnl_cash where month = '2026-11-01' $$,
  $$ values (560000.00::numeric, 160000.00::numeric) $$, 'cash P&L for November');

select is((select operating_expenses_pkr from public.monthly_pnl_accrual where month = '2026-11-01'), 169999.00::numeric,
  'accrual P&L counts operating expenses by expense date, paid or not');

-- ---------------------------------------------------------------- Airbnb payout held then forwarded (rules 1 and 9)
insert into public.payments (booking_id, kind, currency, amount_received, received_date, received_by_partner_id, status)
values (:'g1', 'airbnb_payout', 'USD', 490.10, '2026-12-28', (select id from public.partners where name = 'Saad Raza'), 'received')
returning id as payout \gset

select ok((select held_by_partner and realized_date is null from public.payment_facts where id = :'payout'),
  'USD received by a partner is held, not realized');
select is((select pkr_is_estimate from public.booking_financials where booking_id = :'g1'), true,
  'booking stays estimated until PKR is known');

update public.payments set pkr_received = 133000, fx_rate = 271.3732, forwarded_date = '2026-12-30' where id = :'payout';
select results_eq(format($$ select pkr_is_estimate, net_pkr from public.booking_financials where booking_id = %L $$, :'g1'),
  $$ values (false, 133000.00::numeric) $$, 'actual payout rate replaces the estimate');
select is((select realized_date from public.payment_facts where id = :'payout'), '2026-12-30'::date,
  'realized on the date PKR reaches the project account');

select * from finish();
rollback;

-- Phase 3 reports: booking statistics by check-in month, channel mix by night, bank reconciliation.

-- Channel colours from the validated categorical palette (colourblind-safe, distinct in light and dark;
-- dark-mode steps live in the app). Airbnb red, Booking.com blue, Direct green, Other violet.
update public.channels set color = case code
  when 'airbnb' then '#e34948'
  when 'booking_com' then '#2a78d6'
  when 'direct' then '#008300'
  else '#6250d6' end;

-- By check-in month: volume, cancellations, length of stay, and lead time (days from booking to
-- check-in; only bookings with a known booking date: imported and calendar-synced ones have none).
create view public.report_bookings_monthly with (security_invoker = true) as
select date_trunc('month', b.check_in)::date as month,
       count(*) filter (where b.status <> 'tentative') as bookings,
       count(*) filter (where b.status in ('confirmed', 'in_house', 'completed')) as stays,
       count(*) filter (where b.status in ('cancelled', 'no_show', 'fraud')) as cancelled,
       round(avg(b.nights) filter (where b.status in ('confirmed', 'in_house', 'completed')), 1) as avg_los,
       round(avg(b.check_in - b.booked_at) filter (where b.status in ('confirmed', 'in_house', 'completed') and b.booked_at is not null), 1)
         as avg_lead_days,
       count(*) filter (where b.status in ('confirmed', 'in_house', 'completed') and b.booked_at is not null) as lead_sample
from public.bookings b
where b.deleted_at is null
group by 1;

-- Nights and net revenue per channel per month (rule 4: nights in the month they fall in).
create view public.report_channel_mix with (security_invoker = true) as
select n.month, c.id as channel_id, c.code as channel_code, c.name as channel_name,
       count(*) as nights, sum(n.net_pkr) as net_pkr, bool_or(n.pkr_is_estimate) as has_estimates
from public.nightly_allocation n
join public.channels c on c.id = n.channel_id
group by n.month, c.id, c.code, c.name;

-- Project account balance at the end of a given day (rule 14), for reconciling with the bank.
create function public.ledger_balance_at(p_date date) returns numeric
language sql stable
set search_path = ''
as $$ select coalesce(sum(amount), 0) from public.project_account_ledger where entry_date <= p_date $$;
revoke execute on function public.ledger_balance_at(date) from public, anon;
grant execute on function public.ledger_balance_at(date) to authenticated;

revoke all on public.report_bookings_monthly from anon;
revoke all on public.report_channel_mix from anon;

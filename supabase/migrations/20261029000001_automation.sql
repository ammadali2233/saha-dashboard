-- Phase 2 automation: auto-created booking tasks, recurring expenses, and the daily roll-forward.
-- Everything is idempotent (auto_key / template+period keys), so jobs can run any number of times.

-- ---------------------------------------------------------------- booking tasks
-- Per active booking: pre-arrival, collect money at check-in (direct), turnover clean, deposit
-- inspection. Dates follow the booking; tasks already started are left alone. A cancelled booking
-- soft-deletes its open auto tasks.
create function public.generate_booking_tasks(p_booking uuid) returns int
language plpgsql
set search_path = ''
as $$
declare
  b record;
  v_n int := 0;
  v_direct boolean;
  v_deposit boolean;
begin
  select bk.*, c.code as channel_code into b
  from public.bookings bk join public.channels c on c.id = bk.channel_id
  where bk.id = p_booking;
  if not found then return 0; end if;

  if b.deleted_at is not null or b.status not in ('confirmed', 'in_house') then
    update public.tasks set deleted_at = now()
    where booking_id = p_booking and auto_key is not null and status in ('todo', 'blocked') and deleted_at is null
      and b.status in ('cancelled', 'no_show', 'fraud');
    return 0;
  end if;

  v_direct := b.channel_code = 'direct';
  v_deposit := exists (select 1 from public.payments p where p.booking_id = p_booking and p.kind = 'deposit_in' and p.deleted_at is null);

  insert into public.tasks (auto_key, booking_id, title, due_date, category, notes)
  select k, p_booking, t, d, c::public.task_category, n
  from (values
    ('booking:' || p_booking || ':pre_arrival', 'Confirm arrival time; send house manual and check-in guide',
       b.check_in - 2, 'guest_request', null::text, true),
    ('booking:' || p_booking || ':collect', 'Collect balance and security deposit at check-in',
       b.check_in, 'admin', 'Direct booking: confirm the balance and deposit are received.', v_direct),
    ('booking:' || p_booking || ':turnover', 'Turnover clean after check-out',
       b.check_out, 'turnover', null, true),
    ('booking:' || p_booking || ':deposit', 'Inspect and refund the security deposit',
       b.check_out + 1, 'turnover', 'Record the refund, or what is withheld, as payments on the booking.', v_deposit or v_direct)
  ) as x(k, t, d, c, n, wanted)
  where wanted
  on conflict (auto_key) do update
    set due_date = excluded.due_date, deleted_at = null
    where public.tasks.status = 'todo';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create function public.booking_tasks_trigger() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.generate_booking_tasks(new.id);
  return null;
end;
$$;
create trigger generate_tasks after insert or update of status, check_in, check_out, deleted_at on public.bookings
  for each row execute function public.booking_tasks_trigger();

-- ---------------------------------------------------------------- recurring expenses (rule 10)
-- Creates each month's `due` row from active templates that have an amount and start month,
-- from the start month up to the month whose due date falls within the next 7 days.
create function public.generate_recurring_expenses(p_today date default null) returns int
language plpgsql
set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, public.pk_today());
  v_n int := 0;
  v_rows int;
  t record;
  m date;
begin
  for t in
    select * from public.recurring_expenses
    where deleted_at is null and active and amount is not null and start_month is not null
  loop
    m := t.start_month;
    while m + (t.day_of_month - 1) <= v_today + 7 and (t.end_month is null or m <= t.end_month) loop
      insert into public.expenses (kind, category, item, amount, currency, status, expense_date, paid_by_partner_id,
                                   reimbursable, recurring_template_id, period, notes)
      values ('operating', t.category, t.item || ' ' || to_char(m, 'Mon YYYY'), t.amount, t.currency, 'due',
              m + (t.day_of_month - 1), t.default_paid_by_partner_id, t.default_paid_by_partner_id is not null,
              t.id, m, 'Generated from the recurring template')
      on conflict (recurring_template_id, period) where recurring_template_id is not null and deleted_at is null
      do nothing;
      get diagnostics v_rows = row_count;
      v_n := v_n + v_rows;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------- daily roll-forward
-- Run once a day after midnight Karachi (19:05 UTC), and on demand by the owner.
create function public.roll_forward(p_today date default null) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, public.pk_today());
  v_threshold int := (select overdue_threshold_days from public.settings limit 1);
  v_run uuid;
  v_in int; v_done int; v_due int; v_overdue int; v_tasks int := 0; v_bills int;
  b record;
begin
  insert into public.sync_runs (job_name) values ('daily_roll_forward') returning id into v_run;

  update public.bookings set status = 'in_house'
  where deleted_at is null and status = 'confirmed' and check_in <= v_today and check_out > v_today;
  get diagnostics v_in = row_count;

  update public.bookings set status = 'completed'
  where deleted_at is null and status in ('confirmed', 'in_house') and check_out <= v_today;
  get diagnostics v_done = row_count;

  update public.payments set status = 'due'
  where deleted_at is null and status = 'scheduled' and due_date <= v_today;
  get diagnostics v_due = row_count;

  update public.payments set status = 'overdue'
  where deleted_at is null and status in ('scheduled', 'due') and due_date + v_threshold < v_today;
  get diagnostics v_overdue = row_count;

  for b in select id from public.bookings
           where deleted_at is null and status in ('confirmed', 'in_house') and check_out >= v_today loop
    v_tasks := v_tasks + public.generate_booking_tasks(b.id);
  end loop;

  v_bills := public.generate_recurring_expenses(v_today);

  update public.sync_runs set finished_at = now(), result = 'ok',
    counts = jsonb_build_object('checked_in', v_in, 'completed', v_done, 'payments_due', v_due,
                                'payments_overdue', v_overdue, 'tasks', v_tasks, 'recurring_expenses', v_bills)
  where id = v_run;

  return (select counts from public.sync_runs where id = v_run);
end;
$$;
revoke execute on function public.roll_forward(date) from public, anon;
grant execute on function public.roll_forward(date) to authenticated, service_role;
revoke execute on function public.generate_recurring_expenses(date) from public, anon;
revoke execute on function public.generate_booking_tasks(uuid) from public, anon;

-- the owner can trigger jobs from the app; sync_runs rows written by them need an insert policy
create policy members_insert on public.sync_runs for insert to authenticated with check (public.is_member());
create policy members_update on public.sync_runs for update to authenticated using (public.is_member()) with check (public.is_member());

-- create tasks for bookings that already exist
do $$
declare b record;
begin
  for b in select id from public.bookings where deleted_at is null and status in ('confirmed', 'in_house') loop
    perform public.generate_booking_tasks(b.id);
  end loop;
end $$;

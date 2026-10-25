-- Core business tables. Every table carries id, created/updated stamps and authors, and deleted_at.
-- Money is numeric(14,2) with an explicit currency. Totals are never stored: views derive them.

-- ---------------------------------------------------------------- settings (single row)
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  property_name text not null default 'DHA Retreat',
  brand text not null default 'SAHA Residences',
  address text not null default 'DHA Phase 9, Lahore',
  timezone text not null default 'Asia/Karachi',
  base_currency public.currency_code not null default 'PKR',
  default_usd_pkr numeric(10,4) not null default 267 check (default_usd_pkr > 0),
  monthly_rent numeric(14,2) not null default 150000,
  rent_due_day int not null default 1 check (rent_due_day between 1 and 28),
  lease_start date not null default '2026-09-21',
  go_live_date date not null default '2026-10-05',
  advance_pct numeric(5,2) not null default 30,
  balance_pct numeric(5,2) not null default 70,
  deposit_pct numeric(5,2) not null default 20,
  check_in_time time not null default '15:00',
  check_out_time time not null default '12:00',
  airbnb_payout_lag_days int not null default 1 check (airbnb_payout_lag_days >= 0),
  overdue_threshold_days int not null default 3 check (overdue_threshold_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  constraint settings_terms_sum check (advance_pct + balance_pct = 100)
);
create unique index settings_singleton on public.settings ((true));

-- ---------------------------------------------------------------- channels
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique check (code in ('airbnb', 'booking_com', 'direct', 'other')),
  platform_fee_pct numeric(5,2) not null default 0 check (platform_fee_pct between 0 and 100),
  native_currency public.currency_code not null default 'PKR',
  color text not null default '#64748b',
  ical_configured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz
);

-- iCal import URLs are secrets: RLS is on and there are no policies, so only the service role reads them.
create table public.channel_secrets (
  channel_id uuid primary key references public.channels(id) on delete cascade,
  ical_url text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- partners and capital
create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  email text,
  app_user_id uuid references public.app_users(id),
  agreed_share_pct numeric(5,2) not null check (agreed_share_pct between 0 and 100),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz
);

create table public.capital_movements (
  id uuid primary key default gen_random_uuid(),
  movement_date date not null,
  partner_id uuid not null references public.partners(id),
  type public.capital_type not null,
  amount numeric(14,2) not null check (amount > 0),
  currency public.currency_code not null default 'PKR',
  mode text,
  notes text,
  import_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz
);

-- ---------------------------------------------------------------- guests
create table public.guests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  source text,
  notes text,
  import_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz
);
create index guests_name_idx on public.guests (lower(name));

-- ---------------------------------------------------------------- bookings
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  ref text,
  channel_id uuid not null references public.channels(id),
  guest_id uuid references public.guests(id),
  check_in date not null,
  check_out date not null,
  nights int generated always as (check_out - check_in) stored,
  guest_count int check (guest_count between 1 and 20),
  booking_type public.booking_type not null default 'standard',
  status public.booking_status not null default 'confirmed',
  source public.record_source not null default 'manual',
  needs_details boolean not null default false,
  ical_uid text,
  ical_phone_last4 text,
  possibly_cancelled_at timestamptz,
  booked_at date,
  cancelled_on date,
  cancellation_reason text,
  checkin_notes text,
  notes text,
  import_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  constraint bookings_dates check (check_out > check_in)
);
create unique index bookings_ref_key on public.bookings (ref) where ref is not null and deleted_at is null;
create unique index bookings_ical_uid_key on public.bookings (channel_id, ical_uid) where ical_uid is not null and deleted_at is null;
create index bookings_dates_idx on public.bookings using gist (daterange(check_in, check_out, '[)'));

create table public.booking_lines (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind public.line_kind not null,
  discount_subtype public.discount_subtype,
  label text not null,
  qty numeric(8,2) not null default 1,
  unit_amount numeric(14,2) not null,
  amount numeric(14,2) not null,
  currency public.currency_code not null,
  is_estimate boolean not null default false,
  is_actual_fee boolean not null default false,
  sort_order int not null default 0,
  import_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  constraint booking_lines_sign check (
    (kind in ('discount', 'platform_fee') and amount <= 0)
    or (kind not in ('discount', 'platform_fee') and amount >= 0)
  ),
  constraint booking_lines_subtype check ((kind = 'discount') = (discount_subtype is not null))
);
create index booking_lines_booking_idx on public.booking_lines (booking_id);

-- received_by_partner_id null means the money is in the project account.
-- For Airbnb payouts the USD lands with a partner, who forwards PKR: forwarded_date is when PKR
-- reached the project account, and that is when the revenue is realized.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete cascade,
  kind public.payment_kind not null,
  due_date date,
  amount_due numeric(14,2),
  currency public.currency_code not null,
  amount_received numeric(14,2),
  received_date date,
  received_by_partner_id uuid references public.partners(id),
  fx_rate numeric(10,4) check (fx_rate > 0),
  pkr_received numeric(14,2),
  forwarded_date date,
  method public.payment_method,
  status public.payment_status not null default 'scheduled',
  is_estimate boolean not null default false,
  proof_path text,
  external_ref text,
  notes text,
  import_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  constraint payments_received_complete check (
    status <> 'received' or (amount_received is not null and received_date is not null)
  ),
  constraint payments_pkr_native check (currency <> 'PKR' or pkr_received is null or pkr_received = amount_received)
);
create index payments_booking_idx on public.payments (booking_id);
create index payments_due_idx on public.payments (status, due_date);

-- ---------------------------------------------------------------- calendar blocks
create table public.calendar_blocks (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  reason public.block_reason not null,
  source public.record_source not null default 'manual',
  channel_id uuid references public.channels(id),
  external_uid text,
  possibly_removed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  constraint calendar_blocks_dates check (end_date > start_date)
);
create unique index calendar_blocks_uid_key on public.calendar_blocks (channel_id, external_uid)
  where external_uid is not null and deleted_at is null;

-- ---------------------------------------------------------------- inquiries and quotes
create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid references public.guests(id),
  channel_id uuid references public.channels(id),
  check_in date,
  check_out date,
  guest_count int,
  scope public.stay_scope not null default 'full_house',
  status public.inquiry_status not null default 'new',
  lost_reason text,
  follow_up_date date,
  notes text,
  booking_id uuid references public.bookings(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  constraint inquiries_dates check (check_out is null or check_in is null or check_out > check_in)
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  inquiry_id uuid references public.inquiries(id),
  guest_id uuid references public.guests(id),
  prepared_for text not null,
  issue_date date not null default public.pk_today(),
  check_in date not null,
  check_out date not null,
  scope public.stay_scope not null default 'full_house',
  guest_count int,
  currency public.currency_code not null default 'PKR',
  advance_pct numeric(5,2) not null default 30,
  deposit_amount numeric(14,2) not null default 0,
  valid_until date,
  status public.quote_status not null default 'draft',
  notes text,
  pdf_path text,
  share_token_hash text unique,
  booking_id uuid references public.bookings(id),
  import_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  constraint quotes_dates check (check_out > check_in)
);
alter table public.inquiries add column quote_id uuid references public.quotes(id);

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  kind public.line_kind not null,
  discount_subtype public.discount_subtype,
  label text not null,
  qty numeric(8,2) not null default 1,
  unit_amount numeric(14,2) not null,
  amount numeric(14,2) not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  constraint quote_lines_sign check (
    (kind in ('discount', 'platform_fee') and amount <= 0)
    or (kind not in ('discount', 'platform_fee') and amount >= 0)
  )
);

-- ---------------------------------------------------------------- expenses
create table public.vendor_quotes (
  id uuid primary key default gen_random_uuid(),
  vendor text not null,
  description text,
  quoted_amount numeric(14,2) not null,
  currency public.currency_code not null default 'PKR',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz
);

create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  item text not null,
  amount numeric(14,2) check (amount > 0), -- null until known: generates nothing
  currency public.currency_code not null default 'PKR',
  cadence text not null default 'monthly' check (cadence = 'monthly'),
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  start_month date check (start_month = date_trunc('month', start_month)::date),
  end_month date check (end_month = date_trunc('month', end_month)::date),
  default_paid_by_partner_id uuid references public.partners(id),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  kind public.expense_kind not null,
  category text not null,
  item text not null,
  vendor text,
  vendor_quote_id uuid references public.vendor_quotes(id),
  budget_amount numeric(14,2),
  amount numeric(14,2) not null check (amount >= 0),
  currency public.currency_code not null default 'PKR',
  status public.expense_status not null default 'paid',
  paid_date date,
  paid_by_partner_id uuid references public.partners(id), -- null = project account
  reimbursable boolean not null default false,
  reimbursed_date date,
  receipt_path text,
  booking_id uuid references public.bookings(id),
  recurring_template_id uuid references public.recurring_expenses(id),
  period date,
  notes text,
  import_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  constraint expenses_category check (
    (kind = 'setup' and category in ('Lease', 'Furniture', 'Appliances', 'Interiors', 'Site Works', 'Launch', 'Misc'))
    or (kind = 'operating' and category in (
      'Rent', 'Electricity', 'Gas', 'Water', 'Internet & TV', 'Staff Salary', 'Cleaning', 'Laundry',
      'Maintenance & Repairs', 'Guest Supplies', 'Marketing', 'Bank & Payment Charges', 'Loss / Fraud', 'Other'))
  ),
  constraint expenses_budget_setup_only check (kind = 'setup' or budget_amount is null),
  constraint expenses_reimburse_operating_only check (
    kind = 'operating' or (reimbursable = false and reimbursed_date is null)
  ),
  constraint expenses_paid_has_date check (status <> 'paid' or paid_date is not null)
);
create unique index expenses_recurring_period_key on public.expenses (recurring_template_id, period)
  where recurring_template_id is not null and deleted_at is null;
create index expenses_date_idx on public.expenses (kind, expense_date);

create table public.bank_balances (
  id uuid primary key default gen_random_uuid(),
  balance_date date not null,
  amount numeric(14,2) not null,
  currency public.currency_code not null default 'PKR',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz
);

-- ---------------------------------------------------------------- tasks
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  booking_id uuid references public.bookings(id),
  due_date date,
  assignee_id uuid references public.app_users(id),
  status public.task_status not null default 'todo',
  category public.task_category not null default 'admin',
  notes text,
  auto_key text unique,
  import_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz
);
create index tasks_open_idx on public.tasks (status, due_date);

-- ---------------------------------------------------------------- integration plumbing
create table public.feed_tokens (
  id uuid primary key default gen_random_uuid(),
  kind public.feed_kind not null,
  label text not null,
  token_hash text not null unique,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz
);

create table public.csv_mappings (
  id uuid primary key default gen_random_uuid(),
  header_signature text not null unique,
  mapping jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result text check (result in ('running', 'ok', 'error')) default 'running',
  counts jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz
);
create index sync_runs_job_idx on public.sync_runs (job_name, started_at desc);

create table public.doc_counters (
  prefix text not null,
  year int not null,
  last_value int not null default 0,
  primary key (prefix, year)
);

-- ---------------------------------------------------------------- triggers
do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'channels', 'partners', 'capital_movements', 'guests', 'bookings', 'booking_lines',
    'payments', 'calendar_blocks', 'inquiries', 'quotes', 'quote_lines', 'vendor_quotes',
    'recurring_expenses', 'expenses', 'bank_balances', 'tasks', 'feed_tokens', 'csv_mappings'
  ] loop
    perform public.track_table(format('public.%I', t)::regclass);
  end loop;
end $$;

-- sync_runs is high-volume machine logging: timestamps only, no audit rows.
create trigger set_row_meta before insert or update on public.sync_runs
  for each row execute function public.set_row_meta();

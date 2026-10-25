-- Foundation: extensions, enums, roles, row metadata, audit log, sign-in allowlist.

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
create type public.app_role as enum ('owner', 'partner', 'staff');
create type public.currency_code as enum ('PKR', 'USD');
create type public.record_source as enum ('manual', 'ical', 'csv', 'import');
create type public.inquiry_status as enum ('new', 'quoted', 'awaiting_advance', 'won', 'lost', 'expired');
create type public.stay_scope as enum ('full_house', 'single_room');
create type public.quote_status as enum ('draft', 'sent', 'accepted', 'declined', 'expired');
create type public.booking_type as enum ('standard', 'partner_friends', 'promotional');
create type public.booking_status as enum ('tentative', 'confirmed', 'in_house', 'completed', 'cancelled', 'no_show', 'fraud');
create type public.line_kind as enum (
  'accommodation', 'cleaning_fee', 'extra_guest', 'extra_mattress', 'airport_pickup',
  'late_checkout', 'other_fee', 'discount', 'platform_fee', 'tax'
);
create type public.discount_subtype as enum (
  'friends_family', 'length_of_stay', 'new_listing_promo', 'early_bird', 'special_deal', 'custom'
);
create type public.payment_kind as enum (
  'advance', 'balance', 'full', 'airbnb_payout', 'booking_com_payout',
  'deposit_in', 'deposit_refund', 'deposit_withheld', 'guest_refund', 'cancellation_payout'
);
create type public.payment_method as enum ('airbnb_payout', 'bank_transfer', 'cash', 'jazzcash', 'easypaisa', 'other');
create type public.payment_status as enum ('scheduled', 'due', 'received', 'overdue', 'waived');
create type public.block_reason as enum ('owner_use', 'maintenance', 'channel_hold');
create type public.expense_kind as enum ('setup', 'operating');
create type public.expense_status as enum ('due', 'paid');
create type public.task_status as enum ('todo', 'doing', 'done', 'blocked');
create type public.task_category as enum ('turnover', 'guest_request', 'maintenance', 'admin', 'purchase');
create type public.capital_type as enum ('contribution', 'distribution', 'capital_return');
create type public.feed_kind as enum ('direct', 'all');

-- ---------------------------------------------------------------- time
-- The property runs on Asia/Karachi (UTC+5, no DST); the server runs UTC.
create function public.pk_today() returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Karachi')::date $$;

-- ---------------------------------------------------------------- allowlist
create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  constraint app_users_email_lower check (email = lower(email))
);
create unique index app_users_email_key on public.app_users (email) where deleted_at is null;

-- Role of the signed-in user, or null when the user is not on the allowlist.
create function public.app_role() returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select u.role
  from public.app_users u
  where u.email = lower(auth.jwt() ->> 'email')
    and u.active
    and u.deleted_at is null
  limit 1
$$;

create function public.is_owner() returns boolean
language sql stable
set search_path = ''
as $$ select coalesce(public.app_role() = 'owner', false) $$;

create function public.is_member() returns boolean
language sql stable
set search_path = ''
as $$ select coalesce(public.app_role() in ('owner', 'partner'), false) $$;

-- Supabase Auth hook: refuse to create accounts for emails not on the allowlist.
create function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := lower(event -> 'user' ->> 'email');
begin
  if v_email is not null and exists (
    select 1 from public.app_users u
    where u.email = v_email and u.active and u.deleted_at is null
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'This email is not on the DHA Retreat access list. Ask the owner to add you.'
  ));
end;
$$;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------- row metadata
-- Fills timestamps and authorship, and stops anyone but the owner restoring a soft-deleted row.
create function public.set_row_meta() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if old.deleted_at is not null and new.deleted_at is null
       and auth.uid() is not null and not public.is_owner() then
      raise exception 'Only the owner can restore a deleted record.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

-- ---------------------------------------------------------------- audit log
create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  before jsonb,
  after jsonb,
  user_id uuid,
  user_email text,
  at timestamptz not null default now()
);
create index audit_log_row_idx on public.audit_log (table_name, row_id, at desc);
create index audit_log_at_idx on public.audit_log (at desc);

create function public.audit_trigger() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and v_before - 'updated_at' - 'updated_by' = v_after - 'updated_at' - 'updated_by' then
    return null; -- no real change
  end if;
  insert into public.audit_log (table_name, row_id, action, before, after, user_id, user_email)
  values (
    tg_table_name,
    coalesce((v_after ->> 'id')::uuid, (v_before ->> 'id')::uuid),
    tg_op, v_before, v_after,
    auth.uid(), auth.jwt() ->> 'email'
  );
  return null;
end;
$$;

-- Attach row-meta and audit triggers to a table. Called by later migrations.
create function public.track_table(p_table regclass) returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format(
    'create trigger set_row_meta before insert or update on %s for each row execute function public.set_row_meta()',
    p_table);
  execute format(
    'create trigger audit after insert or update or delete on %s for each row execute function public.audit_trigger()',
    p_table);
end;
$$;

select public.track_table('public.app_users');

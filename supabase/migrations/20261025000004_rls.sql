-- Row Level Security. Roles come from public.app_role(), which is null for anyone off the allowlist.
--   owner   : everything, including hard deletes and restoring soft-deleted rows
--   partner : read everything; create/edit/soft-delete business rows; no settings or ownership rules
--   staff   : tasks, plus the staff_* views below. No base-table access to anything financial.

alter table public.app_users enable row level security;
alter table public.audit_log enable row level security;
alter table public.channel_secrets enable row level security; -- no policies: service role only
alter table public.doc_counters enable row level security;    -- no policies: via next_doc_number()
alter table public.sync_runs enable row level security;

do $$
declare t text;
begin
  -- Partners may write these.
  foreach t in array array[
    'guests', 'bookings', 'booking_lines', 'payments', 'calendar_blocks', 'inquiries', 'quotes',
    'quote_lines', 'vendor_quotes', 'expenses', 'tasks', 'csv_mappings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy members_select on public.%I for select to authenticated using (public.is_member())', t);
    execute format('create policy members_insert on public.%I for insert to authenticated with check (public.is_member())', t);
    execute format('create policy members_update on public.%I for update to authenticated using (public.is_member()) with check (public.is_member())', t);
    execute format('create policy owner_delete on public.%I for delete to authenticated using (public.is_owner())', t);
  end loop;

  -- Only the owner may write these; partners read them.
  foreach t in array array[
    'settings', 'channels', 'partners', 'capital_movements', 'recurring_expenses', 'bank_balances', 'feed_tokens'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy members_select on public.%I for select to authenticated using (public.is_member())', t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (public.is_owner())', t);
    execute format('create policy owner_update on public.%I for update to authenticated using (public.is_owner()) with check (public.is_owner())', t);
    execute format('create policy owner_delete on public.%I for delete to authenticated using (public.is_owner())', t);
  end loop;
end $$;

-- Staff work their tasks.
create policy staff_select on public.tasks for select to authenticated
  using (public.app_role() = 'staff' and deleted_at is null);
create policy staff_update on public.tasks for update to authenticated
  using (public.app_role() = 'staff' and deleted_at is null)
  with check (public.app_role() = 'staff' and deleted_at is null);

create policy members_select on public.app_users for select to authenticated using (public.is_member());
create policy owner_insert on public.app_users for insert to authenticated with check (public.is_owner());
create policy owner_update on public.app_users for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy owner_delete on public.app_users for delete to authenticated using (public.is_owner());

create policy members_select on public.audit_log for select to authenticated using (public.is_member());
create policy members_select on public.sync_runs for select to authenticated using (public.is_member());

-- The signed-in user's own membership (works for every role, including staff).
create function public.current_member()
returns table (id uuid, email text, display_name text, role public.app_role)
language sql stable security definer
set search_path = ''
as $$
  select u.id, u.email, u.display_name, u.role
  from public.app_users u
  where u.email = lower(auth.jwt() ->> 'email') and u.active and u.deleted_at is null
  limit 1
$$;
revoke execute on function public.current_member() from public, anon;

-- ---------------------------------------------------------------- staff views
-- These run with the view owner's rights and filter themselves, so staff see dates, guest name,
-- phone and check-in notes, and nothing financial.
create view public.staff_calendar as
  select 'booking'::text as item_type, b.id, b.check_in as start_date, b.check_out as end_date,
         b.nights, b.status::text as status, b.guest_count, b.checkin_notes,
         g.name as guest_name, g.phone as guest_phone, c.name as channel_name, c.color
  from public.bookings b
  join public.channels c on c.id = b.channel_id
  left join public.guests g on g.id = b.guest_id
  where b.deleted_at is null and public.app_role() is not null
  union all
  select 'block', k.id, k.start_date, k.end_date, k.end_date - k.start_date, k.reason::text, null, k.notes,
         null, null, null, null
  from public.calendar_blocks k
  where k.deleted_at is null and public.app_role() is not null;

revoke all on public.staff_calendar from anon, public;
grant select on public.staff_calendar to authenticated;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public) values
  ('receipts', 'receipts', false),
  ('proofs', 'proofs', false),
  ('quotes', 'quotes', false),
  ('backups', 'backups', false)
on conflict (id) do nothing;

create policy members_read_files on storage.objects for select to authenticated
  using (bucket_id in ('receipts', 'proofs', 'quotes') and public.is_member());
create policy members_upload_files on storage.objects for insert to authenticated
  with check (bucket_id in ('receipts', 'proofs', 'quotes') and public.is_member());
create policy members_update_files on storage.objects for update to authenticated
  using (bucket_id in ('receipts', 'proofs', 'quotes') and public.is_member());
create policy owner_delete_files on storage.objects for delete to authenticated
  using (bucket_id in ('receipts', 'proofs', 'quotes') and public.is_owner());
create policy owner_read_backups on storage.objects for select to authenticated
  using (bucket_id = 'backups' and public.is_owner());

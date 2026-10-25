-- Availability, conflict blocking, document numbers.

-- Statuses that hold the house. Cancelled, no-show and fraud free the dates.
create function public.booking_holds_dates(s public.booking_status) returns boolean
language sql immutable
set search_path = ''
as $$ select s in ('tentative', 'confirmed', 'in_house', 'completed') $$;

-- Everything that overlaps [p_start, p_end). Channel holds are soft (often an echo of our own
-- bookings re-exported by the platforms), so they are reported but never block a save.
create function public.find_conflicts(
  p_start date,
  p_end date,
  p_exclude_booking uuid default null,
  p_exclude_block uuid default null
) returns table (
  item_type text,
  item_id uuid,
  label text,
  start_date date,
  end_date date,
  is_hard boolean
)
language sql stable security definer
set search_path = ''
as $$
  select 'booking', b.id,
         coalesce(g.name, b.ref, 'Booking') || coalesce(' (' || b.ref || ')', ''),
         b.check_in, b.check_out, true
  from public.bookings b
  left join public.guests g on g.id = b.guest_id
  where b.deleted_at is null
    and public.booking_holds_dates(b.status)
    and daterange(b.check_in, b.check_out, '[)') && daterange(p_start, p_end, '[)')
    and b.id is distinct from p_exclude_booking
  union all
  select 'block', k.id,
         case k.reason when 'owner_use' then 'Owner use' when 'maintenance' then 'Maintenance' else 'Channel hold' end,
         k.start_date, k.end_date, k.reason <> 'channel_hold'
  from public.calendar_blocks k
  where k.deleted_at is null
    and daterange(k.start_date, k.end_date, '[)') && daterange(p_start, p_end, '[)')
    and k.id is distinct from p_exclude_block
  order by 4
$$;
revoke execute on function public.find_conflicts(date, date, uuid, uuid) from public, anon;

create function public.format_pk_date(d date) returns text
language sql immutable
set search_path = ''
as $$ select to_char(d, 'FMDD Mon YYYY') $$;

-- Block saves that double-book the house. iCal and import rows are let through so a real
-- double booking on the platforms is still recorded; they surface in calendar_conflicts.
create function public.guard_booking_overlap() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c record;
begin
  if new.deleted_at is not null or not public.booking_holds_dates(new.status) then
    return new;
  end if;
  if new.source in ('ical', 'import') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.check_in = new.check_in and old.check_out = new.check_out
     and public.booking_holds_dates(old.status) and old.deleted_at is null then
    return new; -- dates unchanged: don't block edits to an existing (possibly conflicting) row
  end if;
  select * into c from public.find_conflicts(new.check_in, new.check_out, new.id, null) f
  where f.is_hard limit 1;
  if found then
    raise exception 'These dates overlap %: % to %.',
      c.label, public.format_pk_date(c.start_date), public.format_pk_date(c.end_date)
      using errcode = 'P0001', hint = 'conflict';
  end if;
  return new;
end;
$$;
create trigger guard_overlap before insert or update on public.bookings
  for each row execute function public.guard_booking_overlap();

create function public.guard_block_overlap() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c record;
begin
  if new.deleted_at is not null or new.reason = 'channel_hold' or new.source in ('ical', 'import') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.start_date = new.start_date and old.end_date = new.end_date
     and old.deleted_at is null then
    return new;
  end if;
  select * into c from public.find_conflicts(new.start_date, new.end_date, null, new.id) f
  where f.is_hard limit 1;
  if found then
    raise exception 'These dates overlap %: % to %.',
      c.label, public.format_pk_date(c.start_date), public.format_pk_date(c.end_date)
      using errcode = 'P0001', hint = 'conflict';
  end if;
  return new;
end;
$$;
create trigger guard_overlap before insert or update on public.calendar_blocks
  for each row execute function public.guard_block_overlap();

-- Sequential document numbers: Q-2026-001, D-2026-001.
create function public.next_doc_number(p_prefix text, p_year int default null) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_year int := coalesce(p_year, extract(year from public.pk_today())::int);
  v_next int;
begin
  if p_prefix not in ('Q', 'D') then
    raise exception 'Unknown document prefix %', p_prefix;
  end if;
  if not public.is_member() and auth.uid() is not null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.doc_counters (prefix, year, last_value) values (p_prefix, v_year, 1)
  on conflict (prefix, year) do update set last_value = public.doc_counters.last_value + 1
  returning last_value into v_next;
  return format('%s-%s-%s', p_prefix, v_year, lpad(v_next::text, 3, '0'));
end;
$$;
revoke execute on function public.next_doc_number(text, int) from public, anon;

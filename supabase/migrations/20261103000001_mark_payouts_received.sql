-- Mark platform payouts as received in a partner's account (e.g. Payoneer), any time: early, on time
-- or late. They then show as "held by <partner>" until forwarded to the project account (rule 9).

create function public.mark_payouts_received(p_items jsonb, p_partner uuid, p_date date)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  it jsonb;
  v_n int := 0;
begin
  if not public.is_member() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_partner is null or not exists (select 1 from public.partners where id = p_partner and deleted_at is null) then
    raise exception 'Choose whose account the money arrived in.' using errcode = 'P0001';
  end if;
  if p_date is null or p_date > public.pk_today() then
    raise exception 'Enter the date it arrived (not in the future).' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Select at least one payout.' using errcode = 'P0001';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce((it ->> 'amount')::numeric, 0) <= 0 then
      raise exception 'Every payout needs the amount that arrived.' using errcode = 'P0001';
    end if;
    update public.payments
    set status = 'received',
        amount_received = (it ->> 'amount')::numeric,
        received_date = p_date,
        received_by_partner_id = p_partner,
        method = coalesce(method, 'airbnb_payout')
    where id = (it ->> 'id')::uuid
      and deleted_at is null
      and kind in ('airbnb_payout', 'booking_com_payout')
      and status in ('scheduled', 'due', 'overdue');
    if not found then
      raise exception 'A selected payout is no longer waiting (already received or removed).' using errcode = 'P0001';
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.mark_payouts_received(jsonb, uuid, date) from public, anon;
grant execute on function public.mark_payouts_received(jsonb, uuid, date) to authenticated;

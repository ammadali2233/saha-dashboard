-- Bulk forward (rule 9): one Payoneer withdrawal covering several USD payouts held by a partner.
-- The app splits the PKR that arrived across the payouts (src/domain/forward.ts, pro-rata to USD);
-- this records it in one transaction, only for payouts still waiting, and only if the parts add up.

create function public.forward_payouts(p_items jsonb, p_rate numeric, p_total numeric, p_date date)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  it jsonb;
  v_sum numeric := 0;
  v_n int := 0;
begin
  if not public.is_member() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_rate is null or p_rate <= 0 then
    raise exception 'Enter the conversion rate.' using errcode = 'P0001';
  end if;
  if p_date is null or p_date > public.pk_today() then
    raise exception 'Enter the date the PKR reached the project account (not in the future).' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Select at least one payout.' using errcode = 'P0001';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    if (it ->> 'pkr')::numeric <= 0 then
      raise exception 'Every payout needs a PKR amount above zero.' using errcode = 'P0001';
    end if;
    update public.payments
    set pkr_received = (it ->> 'pkr')::numeric,
        fx_rate = p_rate,
        forwarded_date = p_date,
        notes = concat_ws(' · ', nullif(notes, ''),
                          'Forwarded with ' || jsonb_array_length(p_items) || ' payout(s): PKR ' || p_total || ' at ' || p_rate)
    where id = (it ->> 'id')::uuid
      and deleted_at is null
      and status = 'received'
      and currency = 'USD'
      and received_by_partner_id is not null
      and forwarded_date is null
      and received_date <= p_date;
    if not found then
      raise exception 'A selected payout is not waiting to be forwarded (already forwarded, or received after %).',
        public.format_pk_date(p_date) using errcode = 'P0001';
    end if;
    v_sum := v_sum + (it ->> 'pkr')::numeric;
    v_n := v_n + 1;
  end loop;

  if v_sum <> p_total then
    raise exception 'The split (PKR %) does not add up to the total received (PKR %).', v_sum, p_total using errcode = 'P0001';
  end if;
  return v_n;
end;
$$;
revoke execute on function public.forward_payouts(jsonb, numeric, numeric, date) from public, anon;
grant execute on function public.forward_payouts(jsonb, numeric, numeric, date) to authenticated;

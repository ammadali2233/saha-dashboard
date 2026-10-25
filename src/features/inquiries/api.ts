import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { unwrap, type Row } from '@/lib/queries'
import type { QuoteDoc, QuoteLine } from '@/domain/quote'

export type Inquiry = Row<'inquiries'> & { guests: { name: string; phone: string | null; source: string | null } | null }
export type Quote = Row<'quotes'>

export const INQUIRY_STATUSES = [
  ['new', 'New'],
  ['quoted', 'Quoted'],
  ['awaiting_advance', 'Awaiting advance'],
  ['won', 'Won'],
  ['lost', 'Lost'],
  ['expired', 'Expired'],
] as const

export function useInquiries() {
  return useQuery({
    queryKey: ['inquiries'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('inquiries')
          .select('*, guests(name, phone, source)')
          .is('deleted_at', null)
          .order('follow_up_date', { ascending: true, nullsFirst: false }),
      ) as Inquiry[],
  })
}

export function useQuotes() {
  return useQuery({
    queryKey: ['quotes'],
    queryFn: async () => unwrap(await supabase.from('quotes').select('*').is('deleted_at', null).order('created_at', { ascending: false })),
  })
}

export function useQuote(id: string | undefined) {
  return useQuery({
    queryKey: ['quote', id],
    enabled: !!id,
    queryFn: async () => {
      const [q, lines] = await Promise.all([
        supabase.from('quotes').select('*').eq('id', id!).single(),
        supabase.from('quote_lines').select('*').eq('quote_id', id!).is('deleted_at', null).order('sort_order'),
      ])
      return { quote: unwrap(q), lines: unwrap(lines) }
    },
  })
}

export function toDoc(q: Quote, lines: Row<'quote_lines'>[], property: { property_name: string; brand: string }): QuoteDoc {
  return {
    number: q.number,
    issue_date: q.issue_date,
    prepared_for: q.prepared_for,
    check_in: q.check_in,
    check_out: q.check_out,
    scope: q.scope,
    guest_count: q.guest_count,
    advance_pct: Number(q.advance_pct),
    deposit_amount: Number(q.deposit_amount),
    valid_until: q.valid_until,
    notes: q.notes,
    property_name: property.property_name,
    brand: property.brand,
    lines: lines.map(
      (l): QuoteLine => ({ kind: l.kind, label: l.label, qty: Number(l.qty), unit_amount: Number(l.unit_amount), amount: Number(l.amount) }),
    ),
  }
}

export function useInvalidateSales() {
  const qc = useQueryClient()
  return () => {
    for (const k of ['inquiries', 'quotes', 'quote', 'bookings', 'alerts', 'calendar']) qc.invalidateQueries({ queryKey: [k] })
  }
}

export function useSaveInquiry() {
  const invalidate = useInvalidateSales()
  return useMutation({
    mutationFn: async (input: {
      id?: string
      guest: { id?: string; name: string; phone: string; source: string }
      values: Partial<Row<'inquiries'>>
    }) => {
      let guestId = input.guest.id
      if (!guestId) {
        if (!input.guest.name.trim()) throw new Error("Add the guest's name")
        guestId = unwrap(
          await supabase
            .from('guests')
            .insert({ name: input.guest.name.trim(), phone: input.guest.phone.trim() || null, source: input.guest.source || null })
            .select('id')
            .single(),
        ).id
      }
      const values = { ...input.values, guest_id: guestId }
      if (input.id) return unwrap(await supabase.from('inquiries').update(values).eq('id', input.id).select('id').single()).id
      return unwrap(await supabase.from('inquiries').insert(values).select('id').single()).id
    },
    onSuccess: invalidate,
  })
}

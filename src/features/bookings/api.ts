import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { unwrap, type Row, type ViewRow } from '@/lib/queries'
import type { Database } from '@/lib/database.types'

export type BookingFinancials = ViewRow<'booking_financials'>
export type BookingLineRow = Row<'booking_lines'>
export type PaymentRow = Row<'payments'>
type Enums = Database['public']['Enums']

export interface BookingFilters {
  status?: string
  channelId?: string
  type?: string
  month?: string // YYYY-MM: stays touching this month
}

export function useBookings(filters: BookingFilters) {
  return useQuery({
    queryKey: ['bookings', filters],
    queryFn: async () => {
      let q = supabase.from('booking_financials').select('*').order('check_in', { ascending: false })
      if (filters.status) q = q.eq('status', filters.status as Enums['booking_status'])
      if (filters.channelId) q = q.eq('channel_id', filters.channelId)
      if (filters.type) q = q.eq('booking_type', filters.type as Enums['booking_type'])
      if (filters.month) {
        const start = `${filters.month}-01`
        const [y, m] = filters.month.split('-').map(Number) as [number, number]
        const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
        q = q.lt('check_in', next).gt('check_out', start)
      }
      return unwrap(await q)
    },
  })
}

export function useBooking(id: string | undefined) {
  return useQuery({
    queryKey: ['booking', id],
    enabled: !!id,
    queryFn: async () => {
      const [fin, booking, lines, payments] = await Promise.all([
        supabase.from('booking_financials').select('*').eq('booking_id', id!).single(),
        supabase.from('bookings').select('*').eq('id', id!).single(),
        supabase.from('booking_lines').select('*').eq('booking_id', id!).is('deleted_at', null).order('sort_order'),
        supabase.from('payments').select('*').eq('booking_id', id!).is('deleted_at', null).order('due_date', { nullsFirst: false }),
      ])
      return {
        fin: unwrap(fin),
        booking: unwrap(booking),
        lines: unwrap(lines),
        payments: unwrap(payments),
      }
    },
  })
}

export interface SaveBookingInput {
  booking: Record<string, unknown>
  lines: Record<string, unknown>[]
  guest?: { name: string; phone?: string; email?: string } | null
}

export function useSaveBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SaveBookingInput) =>
      unwrap(
        await supabase.rpc('save_booking', {
          p_booking: input.booking as never,
          p_lines: input.lines as never,
          p_guest: (input.guest ?? null) as never,
        }),
      ) as string,
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['booking', id] })
      qc.invalidateQueries({ queryKey: ['guests'] })
    },
  })
}

export function useUpdateBooking(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Database['public']['Tables']['bookings']['Update']) =>
      unwrap(await supabase.from('bookings').update(patch).eq('id', id).select('id').single()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['booking', id] })
    },
  })
}

export type PaymentInsert = Database['public']['Tables']['payments']['Insert']

export function useSavePayment(bookingId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: PaymentInsert & { id?: string }) => {
      if (id) return unwrap(await supabase.from('payments').update(values).eq('id', id).select('id').single())
      return unwrap(await supabase.from('payments').insert({ ...values, booking_id: bookingId }).select('id').single())
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['booking', bookingId] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['partner_capital'] })
    },
  })
}

export function useDeletePayment(bookingId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await supabase.from('payments').update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id').single()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['booking', bookingId] }),
  })
}

/** Availability for a date range, excluding the booking being edited. */
export function useConflicts(checkIn: string, checkOut: string, excludeId?: string) {
  return useQuery({
    queryKey: ['conflicts', checkIn, checkOut, excludeId],
    enabled: !!checkIn && !!checkOut && checkOut > checkIn,
    queryFn: async () =>
      unwrap(
        await supabase.rpc('find_conflicts', {
          p_start: checkIn,
          p_end: checkOut,
          p_exclude_booking: excludeId ?? undefined,
        }),
      ),
  })
}

/** Upload a photo/PDF to a private bucket; returns the storage path. */
export async function uploadFile(bucket: 'receipts' | 'proofs', file: File, prefix: string): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)
  return path
}

export async function openFile(bucket: 'receipts' | 'proofs', path: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300)
  if (error) throw new Error(error.message)
  window.open(data.signedUrl, '_blank', 'noopener')
}

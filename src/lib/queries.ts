import { useQuery } from '@tanstack/react-query'
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Database } from './database.types'

type Tables = Database['public']['Tables']
type Views = Database['public']['Views']
export type Row<T extends keyof Tables> = Tables[T]['Row']
export type ViewRow<T extends keyof Views> = Views[T]['Row']

/** Unwrap a Supabase response, turning friendly Postgres messages into thrown Errors. */
export function unwrap<R extends { data: unknown; error: PostgrestError | null }>(res: R): NonNullable<R['data']> {
  if (res.error) throw new Error(res.error.message)
  return res.data as NonNullable<R['data']>
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => unwrap(await supabase.from('settings').select('*').single()),
    staleTime: 5 * 60_000,
  })
}

export function useChannels() {
  return useQuery({
    queryKey: ['channels'],
    queryFn: async () => unwrap(await supabase.from('channels').select('*').is('deleted_at', null).order('name')),
    staleTime: 5 * 60_000,
  })
}

export function usePartners() {
  return useQuery({
    queryKey: ['partners'],
    queryFn: async () =>
      unwrap(await supabase.from('partners').select('*').is('deleted_at', null).order('sort_order')),
    staleTime: 5 * 60_000,
  })
}

export function useGuests() {
  return useQuery({
    queryKey: ['guests'],
    queryFn: async () =>
      unwrap(await supabase.from('guests').select('id, name, phone, email').is('deleted_at', null).order('name')),
  })
}

/** Row history from the audit log, newest first. */
export function useAudit(table: string, rowIds: string[]) {
  return useQuery({
    queryKey: ['audit', table, rowIds],
    enabled: rowIds.length > 0,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('audit_log')
          .select('id, table_name, row_id, action, before, after, user_email, at')
          .in('row_id', rowIds)
          .order('at', { ascending: false })
          .limit(50),
      ),
  })
}

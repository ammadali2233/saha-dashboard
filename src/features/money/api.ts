import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { unwrap } from '@/lib/queries'
import type { Database } from '@/lib/database.types'

export const SETUP_CATEGORIES = ['Lease', 'Furniture', 'Appliances', 'Interiors', 'Site Works', 'Launch', 'Misc'] as const
export const OPERATING_CATEGORIES = [
  'Rent',
  'Electricity',
  'Gas',
  'Water',
  'Internet & TV',
  'Staff Salary',
  'Cleaning',
  'Laundry',
  'Maintenance & Repairs',
  'Guest Supplies',
  'Marketing',
  'Bank & Payment Charges',
  'Loss / Fraud',
  'Other',
] as const

type ExpenseUpsert = Database['public']['Tables']['expenses']['Insert']

export function useExpenses(kind: 'setup' | 'operating') {
  return useQuery({
    queryKey: ['expenses', kind],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('expenses')
          .select('*')
          .eq('kind', kind)
          .is('deleted_at', null)
          .order('expense_date', { ascending: false }),
      ),
  })
}

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: ['expense', id],
    enabled: !!id,
    queryFn: async () => unwrap(await supabase.from('expenses').select('*').eq('id', id!).single()),
  })
}

export function useSaveExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: ExpenseUpsert & { id?: string }) => {
      if (id) return unwrap(await supabase.from('expenses').update(values).eq('id', id).select('id').single())
      return unwrap(await supabase.from('expenses').insert(values).select('id').single())
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      qc.invalidateQueries({ queryKey: ['expense'] })
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['partner_capital'] })
    },
  })
}

export function useLedger() {
  return useQuery({
    queryKey: ['ledger'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('project_account_ledger')
          .select('*')
          .order('entry_date', { ascending: false })
          .order('source_table', { ascending: false })
          .order('source_id', { ascending: false }),
      ),
  })
}

export function useVendorBalances() {
  return useQuery({
    queryKey: ['vendor_balances'],
    queryFn: async () => unwrap(await supabase.from('vendor_balances').select('*').order('vendor')),
  })
}

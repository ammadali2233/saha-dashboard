import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { unwrap } from '@/lib/queries'
import { EmptyState, ErrorNote, Loading, PageHeader } from '@/components/common'
import { Select } from '@/components/ui/form-controls'
import { formatTimestamp } from '@/domain/format'

const TABLES = [
  'bookings',
  'booking_lines',
  'payments',
  'expenses',
  'capital_movements',
  'tasks',
  'calendar_blocks',
  'settings',
  'app_users',
]
const SKIP = new Set(['updated_at', 'updated_by', 'created_at', 'created_by'])

/** Every insert, update and delete, newest first, with the fields that changed. */
export function AuditPage() {
  const [table, setTable] = useState('')
  const q = useQuery({
    queryKey: ['audit_all', table],
    queryFn: async () => {
      let query = supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(200)
      if (table) query = query.eq('table_name', table)
      return unwrap(await query)
    },
  })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Audit log" back="/settings" subtitle="Latest 200 changes" />
      <Select aria-label="Table" value={table} onChange={(e) => setTable(e.target.value)} className="sm:w-64">
        <option value="">All tables</option>
        {TABLES.map((t) => (
          <option key={t} value={t}>
            {t.replace(/_/g, ' ')}
          </option>
        ))}
      </Select>
      <ErrorNote error={q.error} />
      {q.isPending ? (
        <Loading />
      ) : !q.data?.length ? (
        <EmptyState title="No changes recorded" />
      ) : (
        <ul className="divide-y rounded-lg border bg-card text-sm">
          {q.data.map((a) => {
            const before = (a.before ?? {}) as Record<string, unknown>
            const after = (a.after ?? {}) as Record<string, unknown>
            const changed =
              a.action === 'UPDATE'
                ? Object.keys(after).filter((k) => !SKIP.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
                : []
            return (
              <li key={a.id} className="p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>
                    <span className="font-medium">{a.user_email ?? 'system'}</span>{' '}
                    {a.action === 'INSERT' ? 'added' : a.action === 'UPDATE' ? 'changed' : 'removed'}{' '}
                    {a.table_name.replace(/_/g, ' ')}
                  </span>
                  <span className="text-muted-foreground">{formatTimestamp(a.at)}</span>
                </div>
                {changed.length > 0 && (
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {changed.slice(0, 6).map((k) => (
                      <li key={k} className="truncate">
                        {k}: {JSON.stringify(before[k])} → {JSON.stringify(after[k])}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

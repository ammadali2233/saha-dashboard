// Nightly JSON snapshot of every business table, kept 30 days in Storage (bucket "backups").
// Left out on purpose: channel_secrets (iCal links are secrets), audit_log and sync_runs (logs).
import type { adminClient } from './supabase'

type Admin = ReturnType<typeof adminClient>

/** Restore order: parents before children (inquiries <-> quotes is handled by the restore script). */
export const BACKUP_TABLES = [
  'settings',
  'channels',
  'app_users',
  'partners',
  'guests',
  'vendor_quotes',
  'recurring_expenses',
  'bookings',
  'booking_lines',
  'payments',
  'calendar_blocks',
  'inquiries',
  'quotes',
  'quote_lines',
  'expenses',
  'capital_movements',
  'bank_balances',
  'tasks',
  'feed_tokens',
  'csv_mappings',
  'doc_counters',
] as const

export interface Snapshot {
  version: 1
  created_at: string
  tables: Record<string, Record<string, unknown>[]>
}

const PAGE = 1000

export async function createSnapshot(sb: Admin): Promise<Snapshot> {
  const tables: Snapshot['tables'] = {}
  for (const t of BACKUP_TABLES) {
    const rows: Record<string, unknown>[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from(t)
        .select('*')
        .range(from, from + PAGE - 1)
      if (error) throw new Error(`${t}: ${error.message}`)
      rows.push(...((data ?? []) as Record<string, unknown>[]))
      if (!data || data.length < PAGE) break
    }
    tables[t] = rows
  }
  return { version: 1, created_at: new Date().toISOString(), tables }
}

/** Backup files are named YYYY-MM-DD.json (Karachi date); anything older than `keepDays` is removed. */
export function filesToPrune(names: string[], today: string, keepDays: number): string[] {
  const cutoff = new Date(Date.parse(today) - keepDays * 86_400_000).toISOString().slice(0, 10)
  return names.filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n) && n.slice(0, 10) < cutoff)
}

export function rowCounts(s: Snapshot): Record<string, number> {
  return Object.fromEntries(Object.entries(s.tables).map(([t, rows]) => [t, rows.length]))
}

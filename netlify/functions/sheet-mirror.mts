// Nightly Google Sheet copy at 01:15 Karachi (20:15 UTC). Skipped quietly until it is configured.
import type { Config } from '@netlify/functions'
import { adminClient } from '../lib/supabase'
import { buildTabs, googleToken, writeTabs } from '../lib/sheet-mirror'

export async function runSheetMirror() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  const sheetId = process.env.GOOGLE_MIRROR_SHEET_ID
  if (!raw || !sheetId) return { skipped: 'GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_MIRROR_SHEET_ID are not set' }

  const sb = adminClient()
  const { data: run } = await sb.from('sync_runs').insert({ job_name: 'sheet_mirror' }).select('id').single()
  try {
    const all = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return (data ?? []) as Record<string, unknown>[]
    }
    const [bookings, payments, expenses, capital, partners, pnlAccrual, pnlCash, ledger, partnerRows] = await Promise.all([
      all(sb.from('booking_financials').select('*').order('check_in')),
      all(sb.from('payment_facts').select('*, bookings(ref, guests(name))').order('due_date', { nullsFirst: false })),
      all(sb.from('expenses').select('*').is('deleted_at', null).order('expense_date')),
      all(sb.from('capital_movements').select('*, partners(name)').is('deleted_at', null).order('movement_date')),
      all(sb.from('partner_capital').select('*').order('sort_order')),
      all(sb.from('monthly_pnl_accrual').select('*').order('month')),
      all(sb.from('monthly_pnl_cash').select('*').order('month')),
      all(sb.from('project_account_ledger').select('*').order('entry_date').order('source_table').order('source_id')),
      all(sb.from('partners').select('id, name')),
    ])
    const partnerName = new Map(partnerRows.map((p) => [p.id, p.name]))
    const tabs = buildTabs({
      bookings,
      payments: payments.map((p) => {
        const b = p.bookings as { ref: string | null; guests: { name: string } | null } | null
        return { ...p, ref: b?.ref, guest: b?.guests?.name, held_by: p.held_by_partner ? partnerName.get(p.received_by_partner_id) : '' }
      }),
      expenses: expenses.map((e) => ({ ...e, paid_by: e.paid_by_partner_id ? partnerName.get(e.paid_by_partner_id) : '' })),
      capital: capital.map((m) => ({ ...m, partner: (m.partners as { name: string } | null)?.name })),
      partners,
      pnlAccrual,
      pnlCash,
      ledger,
      generatedAt: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }).format(new Date()),
    })
    await writeTabs(sheetId, tabs, await googleToken(JSON.parse(raw)))
    const counts = Object.fromEntries(Object.entries(tabs).map(([t, rows]) => [t, rows.length - 1]))
    await sb.from('sync_runs').update({ result: 'ok', finished_at: new Date().toISOString(), counts }).eq('id', run!.id)
    return counts
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await sb.from('sync_runs').update({ result: 'error', finished_at: new Date().toISOString(), error: message }).eq('id', run!.id)
    return { error: message }
  }
}

export default async () => Response.json(await runSheetMirror())

export const config: Config = { schedule: '15 20 * * *' }

// GET /api/pnl-pdf?mode=accrual|cash&from=YYYY-MM&to=YYYY-MM  (owner/partner) -> P&L as a PDF.
import type { Config } from '@netlify/functions'
import { adminClient, callerRole } from '../lib/supabase'
import { pkr, pnlPdf } from '../lib/report-pdf'

const ym = /^\d{4}-\d{2}$/
const nextMonth = (v: string) => {
  const [y, m] = v.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
}
const label = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })

export default async (req: Request) => {
  const role = await callerRole(req)
  if (role !== 'owner' && role !== 'partner') return new Response('Not allowed', { status: 403 })
  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') === 'cash' ? 'cash' : 'accrual'
  const from = url.searchParams.get('from') ?? ''
  const to = url.searchParams.get('to') ?? ''
  if (!ym.test(from) || !ym.test(to) || from > to) return new Response('Bad range', { status: 400 })

  const sb = adminClient()
  const view = mode === 'accrual' ? 'monthly_pnl_accrual' : 'monthly_pnl_cash'
  const { data, error } = await sb.from(view).select('*').gte('month', `${from}-01`).lt('month', nextMonth(to)).order('month')
  if (error) return new Response(error.message, { status: 500 })
  const rows = (data ?? []) as Record<string, unknown>[]

  const head = mode === 'accrual' ? ['Month', 'Nights', 'Earned', 'On the books', 'Other revenue', 'Operating costs', 'Net'] : ['Month', 'Realized revenue', 'Paid operating costs', 'Net']
  const keys = mode === 'accrual' ? ['nights', 'earned_revenue_pkr', 'booked_revenue_pkr', 'other_revenue_pkr', 'operating_expenses_pkr', 'net_profit_pkr'] : ['realized_revenue_pkr', 'paid_operating_pkr', 'net_profit_pkr']
  const body = rows.map((r) => [label(String(r.month)), ...keys.map((k) => (k === 'nights' ? String(r[k] ?? 0) : pkr(r[k])))])
  const totals = ['Total', ...keys.map((k) => {
    const t = rows.reduce((a, r) => a + Number(r[k] ?? 0), 0)
    return k === 'nights' ? String(t) : pkr(t)
  })]
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date())
  const pdf = await pnlPdf({ mode, from, to, head, rows: [...body, totals], generated: today })
  return new Response(new Uint8Array(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="DHA Retreat P&L ${mode} ${from} to ${to}.pdf"`, 'cache-control': 'no-store' },
  })
}

export const config: Config = { path: '/api/pnl-pdf' }

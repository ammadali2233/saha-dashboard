// GET /api/partner-statement?partner=<id>&month=YYYY-MM  (owner/partner) -> monthly statement PDF.
import type { Config } from '@netlify/functions'
import { adminClient, callerRole } from '../lib/supabase'
import { statementPdf } from '../lib/report-pdf'
import { partnerStatement } from '../../src/domain/statement'
import type { Payment } from '../../src/domain/payments'

export default async (req: Request) => {
  const role = await callerRole(req)
  if (role !== 'owner' && role !== 'partner') return new Response('Not allowed', { status: 403 })
  const url = new URL(req.url)
  const partnerId = url.searchParams.get('partner') ?? ''
  const month = url.searchParams.get('month') ?? ''
  if (!/^\d{4}-\d{2}$/.test(month) || !partnerId) return new Response('Bad request', { status: 400 })

  const sb = adminClient()
  const [partners, movements, expenses, payments, settings] = await Promise.all([
    sb.from('partners').select('id, name, agreed_share_pct').is('deleted_at', null),
    sb.from('capital_movements').select('partner_id, type, amount, movement_date').is('deleted_at', null),
    sb.from('expenses').select('kind, item, category, amount, currency, status, paid_date, paid_by_partner_id, reimbursable, reimbursed_date').is('deleted_at', null),
    sb.from('payment_facts').select('kind, status, currency, amount_received, received_date, received_by_partner_id, pkr_received, forwarded_date'),
    sb.from('settings').select('default_usd_pkr').single(),
  ])
  for (const r of [partners, movements, expenses, payments]) if (r.error) return new Response(r.error.message, { status: 500 })
  const partner = partners.data!.find((p) => p.id === partnerId)
  if (!partner) return new Response('Partner not found', { status: 404 })
  const rate = Number(settings.data?.default_usd_pkr ?? 0)

  const st = partnerStatement({
    month,
    partnerId,
    partners: partners.data!.map((p) => ({ id: p.id, name: p.name, agreedSharePct: Number(p.agreed_share_pct) })),
    movements: movements.data!.map((m) => ({ partnerId: m.partner_id, type: m.type, amountPkr: Number(m.amount), date: m.movement_date })),
    expenses: expenses.data!.map((e) => ({
      kind: e.kind,
      item: e.item,
      category: e.category,
      amountPkr: e.currency === 'PKR' ? Number(e.amount) : Math.round(Number(e.amount) * rate * 100) / 100,
      status: e.status,
      paidDate: e.paid_date,
      paidByPartnerId: e.paid_by_partner_id,
      reimbursable: e.reimbursable,
      reimbursedDate: e.reimbursed_date,
    })),
    payments: payments.data!.map((p) => ({
      ...(p as unknown as Payment),
      amount_received: p.amount_received == null ? null : Number(p.amount_received),
      pkr_received: p.pkr_received == null ? null : Number(p.pkr_received),
    })),
  })
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date())
  const pdf = await statementPdf({ partner: partner.name, month, st, generated: today })
  return new Response(new Uint8Array(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${partner.name} statement ${month}.pdf"`, 'cache-control': 'no-store' },
  })
}

export const config: Config = { path: '/api/partner-statement' }

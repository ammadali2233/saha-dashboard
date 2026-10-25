// GET /api/quote-pdf?id=<quote id>  (owner/partner)  -> the quotation as a PDF, also kept in Storage.
import type { Config } from '@netlify/functions'
import { adminClient, callerRole } from '../lib/supabase'
import { quotePdf } from '../lib/quote-pdf'
import type { QuoteDoc } from '../../src/domain/quote'

export default async (req: Request) => {
  const role = await callerRole(req)
  if (role !== 'owner' && role !== 'partner') return new Response('Not allowed', { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return new Response('Missing id', { status: 400 })

  const sb = adminClient()
  const [quote, lines, settings] = await Promise.all([
    sb.from('quotes').select('*').eq('id', id).is('deleted_at', null).single(),
    sb.from('quote_lines').select('*').eq('quote_id', id).is('deleted_at', null).order('sort_order'),
    sb.from('settings').select('property_name, brand').single(),
  ])
  if (quote.error || !quote.data) return new Response('Quote not found', { status: 404 })
  const q = quote.data

  const doc: QuoteDoc = {
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
    property_name: settings.data?.property_name ?? 'DHA Retreat',
    brand: settings.data?.brand ?? 'SAHA Residences',
    lines: (lines.data ?? []).map((l) => ({ kind: l.kind, label: l.label, qty: Number(l.qty), unit_amount: Number(l.unit_amount), amount: Number(l.amount) })),
  }
  const pdf = await quotePdf(doc)

  const path = `${q.number}.pdf`
  const up = await sb.storage.from('quotes').upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (!up.error) await sb.from('quotes').update({ pdf_path: path }).eq('id', id)

  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${q.number} DHA Retreat quotation.pdf"`,
      'cache-control': 'no-store',
    },
  })
}

export const config: Config = { path: '/api/quote-pdf' }

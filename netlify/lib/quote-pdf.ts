// Branded quotation PDF, same content and order as the on-screen quote (and the sheet's
// "Quotation - Final"). Built with React.createElement so the function needs no JSX build step.
import { createElement as h } from 'react'
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { formatDate, formatMoney } from '../../src/domain/format'
import { DEFAULT_QUOTE_NOTES, quoteTotals, type QuoteDoc } from '../../src/domain/quote'

const green = '#1f3a34'
const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#1d2a26' },
  header: { borderBottomWidth: 2, borderBottomColor: green, paddingBottom: 10, marginBottom: 14, alignItems: 'center' },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: green, letterSpacing: 1 },
  sub: { fontSize: 10, color: '#5b6b66', marginTop: 3 },
  kv: { flexDirection: 'row', marginBottom: 3 },
  k: { width: 90, color: '#5b6b66' },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6, color: green },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#d9dcd6', paddingVertical: 4 },
  head: { color: '#5b6b66', fontSize: 9 },
  item: { flex: 1, paddingRight: 6 },
  num: { width: 80, textAlign: 'right' },
  qty: { width: 36, textAlign: 'right' },
  total: { flexDirection: 'row', borderTopWidth: 1.5, borderTopColor: green, paddingTop: 6, marginTop: 2, fontFamily: 'Helvetica-Bold' },
  box: { backgroundColor: '#f1efe8', padding: 8, marginTop: 8, borderRadius: 3 },
  note: { marginBottom: 3 },
  footer: { marginTop: 16, fontFamily: 'Helvetica-Bold' },
})

const pkr = (n: number) => formatMoney(n, 'PKR')

export function quotePdf(doc: QuoteDoc): Promise<Buffer> {
  const t = quoteTotals(doc)
  const notes = (doc.notes ?? DEFAULT_QUOTE_NOTES).split('\n').filter(Boolean)
  const kv = (k: string, v: string) => h(View, { style: s.kv }, h(Text, { style: s.k }, k), h(Text, null, v))

  const page = h(
    Page,
    { size: 'A4', style: s.page },
    h(View, { style: s.header }, h(Text, { style: s.title }, `QUOTATION: ${doc.property_name.toUpperCase()}`), h(Text, { style: s.sub }, `Issued by ${doc.brand}`)),
    kv('Quote', doc.number),
    kv('Date', formatDate(doc.issue_date)),
    kv('Prepared for', doc.prepared_for),
    kv(
      'Stay',
      `${formatDate(doc.check_in)} to ${formatDate(doc.check_out)} · ${t.nights} night${t.nights === 1 ? '' : 's'} · ${doc.scope === 'full_house' ? 'full house' : 'single room'}${doc.guest_count ? ` · ${doc.guest_count} guests` : ''}`,
    ),
    h(Text, { style: s.h2 }, 'CHARGES'),
    h(View, { style: [s.row, s.head] }, h(Text, { style: s.item }, 'Item'), h(Text, { style: s.num }, 'Rate'), h(Text, { style: s.qty }, 'Qty'), h(Text, { style: s.num }, 'Total')),
    ...doc.lines.map((l, i) =>
      h(
        View,
        { key: `line-${i}`, style: s.row },
        h(Text, { style: s.item }, l.label),
        h(Text, { style: s.num }, pkr(l.unit_amount)),
        h(Text, { style: s.qty }, String(l.qty)),
        h(Text, { style: s.num }, pkr(l.amount)),
      ),
    ),
    h(View, { style: s.total }, h(Text, { style: s.item }, 'TOTAL PAYABLE'), h(Text, { style: s.num }, pkr(t.total))),
    h(Text, { style: s.h2 }, 'PAYMENT SCHEDULE'),
    h(View, { style: s.row }, h(Text, { style: s.item }, `Advance (${doc.advance_pct}%), to confirm the booking`), h(Text, { style: s.num }, pkr(t.advance))),
    h(View, { style: s.row }, h(Text, { style: s.item }, `Remaining payment (${100 - doc.advance_pct}%), at check-in`), h(Text, { style: s.num }, pkr(t.balance))),
    ...(t.deposit > 0
      ? [
          h(
            View,
            { style: s.box },
            h(Text, null, `Security deposit (refundable on final inspection), at check-in: ${pkr(t.deposit)}`),
            h(Text, { style: { marginTop: 3, color: '#5b6b66' } }, 'The security deposit is separate from, and not included in, the total payable above.'),
          ),
        ]
      : []),
    h(Text, { style: s.h2 }, 'NOTES'),
    ...notes.map((n, i) => h(Text, { key: `note-${i}`, style: s.note }, `${i + 1}. ${n}`)),
    ...(doc.valid_until ? [h(Text, { style: { marginTop: 6, color: '#5b6b66' } }, `This quotation is valid until ${formatDate(doc.valid_until)}.`)] : []),
    h(Text, { style: s.footer }, 'We look forward to hosting you.'),
  )
  return renderToBuffer(h(Document, { title: `${doc.number} ${doc.property_name} quotation`, author: doc.brand }, page))
}

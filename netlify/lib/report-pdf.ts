// PDF documents for reports (P&L) and partner statements. React.createElement, no JSX build step.
import { createElement as h } from 'react'
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { formatDate, formatMoney } from '../../src/domain/format'

const green = '#1f3a34'
export const pdfStyles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: 'Helvetica', color: '#1d2a26' },
  header: { borderBottomWidth: 2, borderBottomColor: green, paddingBottom: 8, marginBottom: 12 },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: green },
  sub: { fontSize: 9, color: '#5b6b66', marginTop: 2 },
  h2: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4, color: green },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#d9dcd6', paddingVertical: 3 },
  head: { color: '#5b6b66' },
  bold: { fontFamily: 'Helvetica-Bold' },
  note: { color: '#5b6b66', marginTop: 6 },
  kv: { flexDirection: 'row', paddingVertical: 2 },
})
const s = pdfStyles
export const pkr = (n: unknown) => formatMoney(Number(n ?? 0), 'PKR')

/** A simple table: first column flexible, the rest right-aligned numbers. */
export function table(head: string[], rows: (string | number)[][], opts: { totalRow?: boolean } = {}) {
  const cell = (v: string | number, i: number, bold = false) =>
    h(Text, { key: `c${i}`, style: [i === 0 ? { flex: 1 } : { width: 80, textAlign: 'right' as const }, bold ? s.bold : {}] }, String(v))
  return h(
    View,
    null,
    h(View, { style: [s.row, s.head] }, ...head.map((v, i) => cell(v, i))),
    ...rows.map((r, j) => h(View, { key: `r${j}`, style: s.row }, ...r.map((v, i) => cell(v, i, opts.totalRow === true && j === rows.length - 1)))),
  )
}

export function header(title: string, sub: string) {
  return h(View, { style: s.header }, h(Text, { style: s.title }, title), h(Text, { style: s.sub }, sub))
}

export function render(title: string, children: ReturnType<typeof h>[]) {
  return renderToBuffer(h(Document, { title, author: 'SAHA Residences' }, h(Page, { size: 'A4', style: s.page }, ...children)))
}

export function pnlPdf(p: { mode: 'accrual' | 'cash'; from: string; to: string; head: string[]; rows: (string | number)[][]; generated: string }) {
  return render(`DHA Retreat P&L ${p.mode}`, [
    header('DHA RETREAT: PROFIT AND LOSS', `${p.mode === 'accrual' ? 'Accrual' : 'Cash'} basis · ${p.from} to ${p.to} · SAHA Residences · generated ${formatDate(p.generated)}`),
    table(p.head, p.rows, { totalRow: true }),
    h(
      Text,
      { style: s.note },
      p.mode === 'accrual'
        ? 'Accrual: stay revenue by the night it falls on, other revenue on its date, operating costs by the month incurred. Setup costs are capital and not included. USD stays use the actual payout rate, or the default rate (estimate) until forwarded.'
        : 'Cash: money that reached the project account and operating costs actually paid, by date. Setup costs are capital and not included.',
    ),
  ])
}

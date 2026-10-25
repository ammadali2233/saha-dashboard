// Quotes, in the shape of the sheet's "Quotation - Final": charges, total, payment schedule, and the
// security deposit stated separately (never part of the total).
import { bookingTotals, nightsBetween, type LineKind } from './booking'
import { formatDate, formatMoney } from './format'
import { fromCents, roundCents, toCents } from './money'

export interface QuoteLine {
  kind: LineKind
  label: string
  qty: number
  unit_amount: number // signed like the amount (discounts negative)
  amount: number
}

export interface QuoteDoc {
  number: string
  issue_date: string
  prepared_for: string
  check_in: string
  check_out: string
  scope: 'full_house' | 'single_room'
  guest_count: number | null
  advance_pct: number
  deposit_amount: number
  valid_until: string | null
  notes: string | null
  property_name: string
  brand: string
  lines: QuoteLine[]
}

export const DEFAULT_QUOTE_NOTES = [
  'Terms and rules are set out in the House Rules, shared separately on WhatsApp. This quotation is calculated on that basis.',
  'You and your guests are requested to follow the House Rules. Please reach out to us at any time if anything is unclear.',
].join('\n')

export function quoteTotals(doc: Pick<QuoteDoc, 'lines' | 'advance_pct' | 'deposit_amount' | 'check_in' | 'check_out'>) {
  const t = bookingTotals(
    doc.lines.map((l) => ({ kind: l.kind, amount: l.amount })),
    0, // direct: no platform fee
  )
  const total = toCents(t.net)
  const advance = roundCents((total * doc.advance_pct) / 100)
  return {
    nights: nightsBetween(doc.check_in, doc.check_out),
    subtotal: t.gross,
    discounts: t.discounts,
    total: fromCents(total),
    advance: fromCents(advance),
    balance: fromCents(total - advance),
    deposit: doc.deposit_amount,
  }
}

/** Default deposit: deposit % of the total, as on the sheet's quotes (20% of 105,000 = 21,000). */
export function defaultDeposit(total: number, depositPct: number): number {
  return fromCents(roundCents((toCents(total) * depositPct) / 100))
}

const pkr = (n: number) => formatMoney(n, 'PKR')

/** Plain text for WhatsApp (bold with *asterisks*). */
export function quoteWhatsApp(doc: QuoteDoc): string {
  const t = quoteTotals(doc)
  const scope = doc.scope === 'full_house' ? 'full house' : 'single room'
  const lines = doc.lines.map((l) =>
    l.qty === 1 ? `• ${l.label}: ${pkr(l.amount)}` : `• ${l.label}: ${pkr(l.unit_amount)} × ${l.qty} = ${pkr(l.amount)}`,
  )
  const notes = (doc.notes ?? DEFAULT_QUOTE_NOTES).split('\n').filter(Boolean)
  return [
    `*QUOTATION: ${doc.property_name.toUpperCase()}*`,
    `Issued by ${doc.brand} · ${doc.number}`,
    `Date: ${formatDate(doc.issue_date)}`,
    `Prepared for: ${doc.prepared_for}`,
    `Stay: ${formatDate(doc.check_in)} to ${formatDate(doc.check_out)} (${t.nights} night${t.nights === 1 ? '' : 's'}, ${scope}${doc.guest_count ? `, ${doc.guest_count} guests` : ''})`,
    '',
    '*Charges*',
    ...lines,
    `*Total payable: ${pkr(t.total)}*`,
    '',
    '*Payment schedule*',
    `• Advance (${doc.advance_pct}%), to confirm the booking: ${pkr(t.advance)}`,
    `• Remaining (${100 - doc.advance_pct}%), at check-in: ${pkr(t.balance)}`,
    ...(t.deposit > 0
      ? ['', `Security deposit, refundable on final inspection, collected at check-in: ${pkr(t.deposit)}. It is separate from, and not included in, the total above.`]
      : []),
    '',
    '*Notes*',
    ...notes.map((n, i) => `${i + 1}. ${n}`),
    ...(doc.valid_until ? ['', `This quotation is valid until ${formatDate(doc.valid_until)}.`] : []),
    '',
    'We look forward to hosting you.',
  ].join('\n')
}

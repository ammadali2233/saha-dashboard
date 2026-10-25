import { formatDate, formatMoney } from '@/domain/format'
import { DEFAULT_QUOTE_NOTES, quoteTotals, type QuoteDoc } from '@/domain/quote'

const pkr = (n: number) => formatMoney(n, 'PKR')

/** The quote as the guest sees it: same layout as the sheet's "Quotation - Final". */
export function QuoteDocument({ doc }: { doc: QuoteDoc }) {
  const t = quoteTotals(doc)
  const notes = (doc.notes ?? DEFAULT_QUOTE_NOTES).split('\n').filter(Boolean)
  return (
    <article className="mx-auto w-full max-w-2xl rounded-lg border bg-card p-5 text-sm shadow-sm sm:p-8">
      <header className="mb-5 border-b pb-4 text-center">
        <h2 className="text-xl font-bold tracking-wide">QUOTATION: {doc.property_name.toUpperCase()}</h2>
        <p className="text-muted-foreground">Issued by {doc.brand}</p>
      </header>
      <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Quote</dt>
        <dd>{doc.number}</dd>
        <dt className="text-muted-foreground">Date</dt>
        <dd>{formatDate(doc.issue_date)}</dd>
        <dt className="text-muted-foreground">Prepared for</dt>
        <dd className="font-medium">{doc.prepared_for}</dd>
        <dt className="text-muted-foreground">Stay</dt>
        <dd>
          {formatDate(doc.check_in)} to {formatDate(doc.check_out)} · {t.nights} night{t.nights === 1 ? '' : 's'} ·{' '}
          {doc.scope === 'full_house' ? 'full house' : 'single room'}
          {doc.guest_count ? ` · ${doc.guest_count} guests` : ''}
        </dd>
      </dl>

      <h3 className="mb-2 font-semibold">Charges</h3>
      <div className="mb-5 overflow-x-auto">
        <table className="w-full">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Item</th>
              <th className="py-1 text-right font-normal">Rate</th>
              <th className="py-1 text-right font-normal">Qty</th>
              <th className="py-1 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {doc.lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1.5 pr-2">{l.label}</td>
                <td className="py-1.5 text-right tabular-nums">{pkr(l.unit_amount)}</td>
                <td className="py-1.5 text-right tabular-nums">{l.qty}</td>
                <td className="py-1.5 text-right tabular-nums">{pkr(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-semibold">
              <td className="py-2" colSpan={3}>
                Total payable
              </td>
              <td className="py-2 text-right tabular-nums">{pkr(t.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h3 className="mb-2 font-semibold">Payment schedule</h3>
      <table className="mb-3 w-full">
        <tbody className="divide-y">
          <tr>
            <td className="py-1.5">Advance ({doc.advance_pct}%)</td>
            <td className="py-1.5 text-muted-foreground">To confirm the booking</td>
            <td className="py-1.5 text-right tabular-nums">{pkr(t.advance)}</td>
          </tr>
          <tr>
            <td className="py-1.5">Remaining ({100 - doc.advance_pct}%)</td>
            <td className="py-1.5 text-muted-foreground">At check-in</td>
            <td className="py-1.5 text-right tabular-nums">{pkr(t.balance)}</td>
          </tr>
        </tbody>
      </table>
      {t.deposit > 0 && (
        <p className="mb-5 rounded-md bg-muted p-3">
          Security deposit (refundable on final inspection), at check-in: <strong>{pkr(t.deposit)}</strong>. The security deposit
          is separate from, and not included in, the total payable above.
        </p>
      )}

      <h3 className="mb-2 font-semibold">Notes</h3>
      <ol className="mb-4 list-decimal space-y-1 pl-5">
        {notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ol>
      {doc.valid_until && <p className="text-muted-foreground">Valid until {formatDate(doc.valid_until)}.</p>}
      <p className="mt-4 font-medium">We look forward to hosting you.</p>
    </article>
  )
}

import { fromCents, toCents } from './money'
import { realizedDate, realizedPkr, type Payment } from './payments'
import type { CapitalMovement, Expense } from './partners'

export type LedgerKind =
  | 'contribution'
  | 'distribution'
  | 'capital_return'
  | 'revenue'
  | 'guest_refund'
  | 'deposit_in'
  | 'deposit_refund'
  | 'expense'
  | 'reimbursement'

export interface LedgerEntry {
  date: string
  kind: LedgerKind
  amount: number // signed PKR: + into the project account, - out
}

/** Cash effect of a payment on the project account. deposit_withheld moves no cash (it was already in). */
const PAYMENT_CASH: Partial<Record<Payment['kind'], { kind: LedgerKind; sign: 1 | -1 }>> = {
  advance: { kind: 'revenue', sign: 1 },
  balance: { kind: 'revenue', sign: 1 },
  full: { kind: 'revenue', sign: 1 },
  airbnb_payout: { kind: 'revenue', sign: 1 },
  booking_com_payout: { kind: 'revenue', sign: 1 },
  cancellation_payout: { kind: 'revenue', sign: 1 },
  guest_refund: { kind: 'guest_refund', sign: -1 },
  deposit_in: { kind: 'deposit_in', sign: 1 },
  deposit_refund: { kind: 'deposit_refund', sign: -1 },
}

/**
 * Rule 14. Project account = contributions + money received into it - expenses paid from it
 * - reimbursements - distributions. Capital returns also leave the account. Deposits pass
 * through it (in at check-in, out on refund) and are listed so bank reconciliation matches.
 */
export function projectLedger(movements: CapitalMovement[], payments: Payment[], expenses: Expense[]): LedgerEntry[] {
  const out: LedgerEntry[] = []
  for (const m of movements) {
    out.push({ date: m.date, kind: m.type, amount: m.type === 'contribution' ? m.amountPkr : -m.amountPkr })
  }
  for (const p of payments) {
    const effect = PAYMENT_CASH[p.kind]
    const date = realizedDate(p)
    const pkr = realizedPkr(p)
    if (!effect || !date || pkr == null) continue
    out.push({ date, kind: effect.kind, amount: effect.sign * pkr })
  }
  for (const e of expenses) {
    if (e.status !== 'paid' || !e.paidDate) continue
    if (!e.paidByPartnerId) out.push({ date: e.paidDate, kind: 'expense', amount: -e.amountPkr })
    else if (e.kind === 'operating' && e.reimbursable && e.reimbursedDate) {
      out.push({ date: e.reimbursedDate, kind: 'reimbursement', amount: -e.amountPkr })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export function ledgerBalance(entries: LedgerEntry[], asOf?: string): number {
  return fromCents(entries.filter((e) => !asOf || e.date <= asOf).reduce((a, e) => a + toCents(e.amount), 0))
}

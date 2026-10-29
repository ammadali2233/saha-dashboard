// Monthly partner statement: the partner's position at the end of a month, plus that month's activity.
// Same rules as the Partners page (rules 11-15), cut off at the month's last day.
import { fromCents, toCents } from './money'
import { partnerSummaries, realizedNetProfit, type CapitalMovement, type Expense, type Partner, type PartnerSummary } from './partners'
import { realizedDate, realizedRevenuePkr, type Payment } from './payments'

export interface StatementInput {
  partners: Partner[]
  partnerId: string
  movements: CapitalMovement[]
  expenses: (Expense & { item?: string; category?: string })[]
  payments: Payment[]
  month: string // YYYY-MM
}

export interface Statement {
  monthStart: string
  monthEnd: string
  asOf: PartnerSummary
  month: { realizedRevenue: number; paidOperating: number; netProfit: number; share: number }
  movements: CapitalMovement[]
  paidPersonally: StatementInput['expenses']
}

export function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const start = `${month}-01`
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) // last day
  return { start, end }
}

export function partnerStatement(i: StatementInput): Statement {
  const { start, end } = monthBounds(i.month)
  const upTo = (d: string | null | undefined) => !!d && d <= end
  const inMonth = (d: string | null | undefined) => !!d && d >= start && d <= end

  const revenueTo = (cut: (d: string | null) => boolean) =>
    fromCents(i.payments.filter((p) => cut(realizedDate(p))).reduce((a, p) => a + toCents(realizedRevenuePkr(p)), 0))

  // expenses as they stood at month end: unpaid then = not paid; reimbursed later = still owed then
  const expensesAtEnd: Expense[] = i.expenses
    .filter((e) => e.status === 'paid' && upTo(e.paidDate))
    .map((e) => ({ ...e, reimbursedDate: upTo(e.reimbursedDate) ? e.reimbursedDate : null }))
  const movementsAtEnd = i.movements.filter((m) => upTo(m.date))
  const profitToDate = realizedNetProfit(revenueTo(upTo), expensesAtEnd)
  const asOf = partnerSummaries(i.partners, movementsAtEnd, expensesAtEnd, profitToDate).find((p) => p.partnerId === i.partnerId)
  if (!asOf) throw new Error('Partner not found')

  const realizedRevenue = revenueTo(inMonth)
  const paidOperating = fromCents(
    i.expenses.filter((e) => e.kind === 'operating' && e.status === 'paid' && inMonth(e.paidDate)).reduce((a, e) => a + toCents(e.amountPkr), 0),
  )
  const netProfit = fromCents(toCents(realizedRevenue) - toCents(paidOperating))
  return {
    monthStart: start,
    monthEnd: end,
    asOf,
    month: { realizedRevenue, paidOperating, netProfit, share: fromCents(Math.round((toCents(netProfit) * asOf.agreedSharePct) / 100)) },
    movements: i.movements.filter((m) => m.partnerId === i.partnerId && inMonth(m.date)),
    paidPersonally: i.expenses.filter((e) => e.paidByPartnerId === i.partnerId && inMonth(e.paidDate)),
  }
}

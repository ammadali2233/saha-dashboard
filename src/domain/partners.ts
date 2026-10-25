import { fromCents, roundCents, toCents } from './money'

export type CapitalType = 'contribution' | 'distribution' | 'capital_return'

export interface Partner {
  id: string
  name: string
  agreedSharePct: number
}

export interface CapitalMovement {
  partnerId: string
  type: CapitalType
  amountPkr: number
  date: string
}

export interface Expense {
  kind: 'setup' | 'operating'
  amountPkr: number
  status: 'due' | 'paid'
  paidDate: string | null
  paidByPartnerId: string | null // null = project account
  reimbursable: boolean
  reimbursedDate: string | null
}

export interface PartnerSummary {
  partnerId: string
  name: string
  agreedSharePct: number
  cashContributed: number
  setupPaidPersonally: number
  capitalReturned: number
  totalInvested: number
  capitalPct: number // 0..1, rule 12 (informational)
  shortfallToEqual: number
  profitShare: number
  distributions: number
  undistributed: number
  reimbursementsOwed: number
  capitalRecoveredPct: number | null // 0..1
}

/** Rule 13. Realized net profit = realized revenue - paid operating expenses (setup is capital). */
export function realizedNetProfit(realizedRevenuePkr: number, expenses: Expense[], asOf?: string): number {
  let paidOperating = 0
  for (const e of expenses) {
    if (e.kind !== 'operating' || e.status !== 'paid' || !e.paidDate) continue
    if (asOf && e.paidDate > asOf) continue
    paidOperating += toCents(e.amountPkr)
  }
  return fromCents(toCents(realizedRevenuePkr) - paidOperating)
}

/**
 * Rules 11-15 per partner.
 * - Total invested = cash contributions + setup costs paid personally - capital returns.
 * - Capital % = own invested / everyone's invested (shown, but profit uses the agreed share).
 * - Shortfall to equal capital: what the partner would add for invested capital to match their
 *   agreed share, given the best-funded partner (0 for the best-funded).
 * - Profit share = agreed share x cumulative realized net profit; distributions reduce the
 *   undistributed balance, never ownership.
 * - Operating expenses paid personally and marked reimbursable are owed back until reimbursed.
 */
export function partnerSummaries(
  partners: Partner[],
  movements: CapitalMovement[],
  expenses: Expense[],
  netProfit: number,
): PartnerSummary[] {
  const base = partners.map((p) => {
    let cash = 0
    let setup = 0
    let returned = 0
    let distributions = 0
    let owed = 0
    for (const m of movements) {
      if (m.partnerId !== p.id) continue
      const c = toCents(m.amountPkr)
      if (m.type === 'contribution') cash += c
      else if (m.type === 'capital_return') returned += c
      else distributions += c
    }
    for (const e of expenses) {
      if (e.paidByPartnerId !== p.id || e.status !== 'paid') continue
      if (e.kind === 'setup') setup += toCents(e.amountPkr)
      else if (e.reimbursable && !e.reimbursedDate) owed += toCents(e.amountPkr)
    }
    return { p, cash, setup, returned, distributions, owed, invested: cash + setup - returned }
  })

  const totalInvested = base.reduce((a, b) => a + b.invested, 0)
  const required = Math.max(0, ...base.map((b) => (b.p.agreedSharePct > 0 ? b.invested / b.p.agreedSharePct : 0)))

  return base.map((b) => {
    const share = roundCents((toCents(netProfit) * b.p.agreedSharePct) / 100)
    const undistributed = share - b.distributions
    const target = roundCents(required * b.p.agreedSharePct)
    return {
      partnerId: b.p.id,
      name: b.p.name,
      agreedSharePct: b.p.agreedSharePct,
      cashContributed: fromCents(b.cash),
      setupPaidPersonally: fromCents(b.setup),
      capitalReturned: fromCents(b.returned),
      totalInvested: fromCents(b.invested),
      capitalPct: totalInvested > 0 ? b.invested / totalInvested : 0,
      shortfallToEqual: fromCents(Math.max(0, target - b.invested)),
      profitShare: fromCents(share),
      distributions: fromCents(b.distributions),
      undistributed: fromCents(undistributed),
      reimbursementsOwed: fromCents(b.owed),
      capitalRecoveredPct: b.invested > 0 ? (b.distributions + undistributed) / b.invested : null,
    }
  })
}

import { describe, expect, it } from 'vitest'
import { monthBounds, partnerStatement } from './statement'
import type { Payment } from './payments'

const partners = ['A', 'H', 'M', 'S'].map((id) => ({ id, name: id, agreedSharePct: 25 }))
const pay = (p: Partial<Payment>): Payment => ({
  kind: 'full',
  status: 'received',
  currency: 'PKR',
  amount_received: 0,
  received_date: null,
  received_by_partner_id: null,
  pkr_received: null,
  forwarded_date: null,
  ...p,
})
const exp = (e: Record<string, unknown>) => ({
  kind: 'operating' as const,
  amountPkr: 0,
  status: 'paid' as const,
  paidDate: null as string | null,
  paidByPartnerId: null as string | null,
  reimbursable: false,
  reimbursedDate: null as string | null,
  ...e,
})

const input = {
  partners,
  partnerId: 'S',
  movements: [
    { partnerId: 'A', type: 'contribution' as const, amountPkr: 1_000_000, date: '2026-09-15' },
    { partnerId: 'S', type: 'contribution' as const, amountPkr: 1_000_000, date: '2026-09-15' },
    { partnerId: 'S', type: 'distribution' as const, amountPkr: 20_000, date: '2026-11-30' },
    { partnerId: 'S', type: 'distribution' as const, amountPkr: 50_000, date: '2026-12-31' }, // after November
  ],
  expenses: [
    exp({ kind: 'setup', amountPkr: 50_000, paidDate: '2026-09-20', paidByPartnerId: 'S' }),
    exp({ amountPkr: 150_000, paidDate: '2026-11-01' }), // rent
    exp({ amountPkr: 8_000, paidDate: '2026-11-05', paidByPartnerId: 'S', reimbursable: true, reimbursedDate: '2026-12-02' }),
    exp({ amountPkr: 9_999, status: 'due', paidDate: null }),
  ],
  payments: [
    pay({ amount_received: 87_500, received_date: '2026-10-20' }),
    pay({ kind: 'airbnb_payout', currency: 'USD', amount_received: 506.14, received_date: '2026-10-25', received_by_partner_id: 'A', pkr_received: 140_000, forwarded_date: '2026-11-03' }),
    pay({ amount_received: 31_500, received_date: '2026-12-10' }), // after November
  ],
  month: '2026-11',
}

describe('partner statement', () => {
  const s = partnerStatement(input)

  it('covers the calendar month', () => {
    expect(monthBounds('2026-11')).toEqual({ start: '2026-11-01', end: '2026-11-30' })
    expect(monthBounds('2027-02')).toEqual({ start: '2027-02-01', end: '2027-02-28' })
  })

  it("this month's project P&L is cash in November: forwarded payout minus paid costs", () => {
    expect(s.month).toEqual({ realizedRevenue: 140_000, paidOperating: 158_000, netProfit: -18_000, share: -4_500 })
  })

  it('position at month end ignores anything after it', () => {
    // profit to 30 Nov: 87,500 + 140,000 - 150,000 - 8,000 = 69,500; 25% = 17,375
    expect(s.asOf.profitShare).toBe(17_375)
    expect(s.asOf.distributions).toBe(20_000)
    expect(s.asOf.undistributed).toBe(-2_625)
    expect(s.asOf.totalInvested).toBe(1_050_000)
  })

  it('an expense reimbursed in December was still owed at the end of November', () => {
    expect(s.asOf.reimbursementsOwed).toBe(8_000)
  })

  it("lists only this partner's own movements and personal payments in the month", () => {
    expect(s.movements.map((m) => m.amountPkr)).toEqual([20_000])
    expect(s.paidPersonally.map((e) => e.amountPkr)).toEqual([8_000])
  })
})

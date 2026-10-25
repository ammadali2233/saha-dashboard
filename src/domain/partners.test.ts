import { describe, expect, it } from 'vitest'
import { partnerSummaries, realizedNetProfit, type CapitalMovement, type Expense, type Partner } from './partners'
import { ledgerBalance, projectLedger } from './ledger'
import type { Payment } from './payments'

const partners: Partner[] = [
  { id: 'A', name: 'Ammad', agreedSharePct: 25 },
  { id: 'H', name: 'Hamza', agreedSharePct: 25 },
  { id: 'M', name: 'Azeem', agreedSharePct: 25 },
  { id: 'S', name: 'Saad', agreedSharePct: 25 },
]

const contribution = (partnerId: string, amountPkr: number, date = '2026-09-15'): CapitalMovement => ({
  partnerId,
  type: 'contribution',
  amountPkr,
  date,
})

const expense = (e: Partial<Expense>): Expense => ({
  kind: 'operating',
  amountPkr: 0,
  status: 'paid',
  paidDate: '2026-11-01',
  paidByPartnerId: null,
  reimbursable: false,
  reimbursedDate: null,
  ...e,
})

const movements: CapitalMovement[] = [
  contribution('A', 1_000_000),
  contribution('H', 800_000),
  contribution('M', 1_000_000),
  contribution('S', 1_000_000),
  { partnerId: 'A', type: 'distribution', amountPkr: 30_000, date: '2026-12-31' },
]

const expenses: Expense[] = [
  expense({ kind: 'setup', amountPkr: 50_000, paidByPartnerId: 'M', paidDate: '2026-09-20' }),
  expense({ kind: 'setup', amountPkr: 200_000, paidDate: '2026-09-25' }),
  expense({ amountPkr: 150_000, paidDate: '2026-11-01' }), // rent from project account
  expense({ amountPkr: 8_000, paidByPartnerId: 'S', reimbursable: true, paidDate: '2026-11-05' }),
  expense({ amountPkr: 2_000, paidByPartnerId: 'S', reimbursable: true, reimbursedDate: '2026-11-10' }),
  expense({ amountPkr: 9_999, status: 'due', paidDate: null }),
]

describe('realized net profit (rule 13)', () => {
  it('is realized revenue minus paid operating expenses; setup and unpaid rows are excluded', () => {
    expect(realizedNetProfit(560_000, expenses)).toBe(400_000)
  })
  it('can be cut off at a date', () => {
    // rent 150,000 and the 2,000 reimbursed expense are both paid on 1 Nov; the 8,000 on 5 Nov is not counted
    expect(realizedNetProfit(560_000, expenses, '2026-11-01')).toBe(408_000)
  })
})

describe('partner capital and profit share (rules 11-15, agreed 25% each)', () => {
  const rows = partnerSummaries(partners, movements, expenses, 400_000)
  const by = Object.fromEntries(rows.map((r) => [r.partnerId, r]))

  it('setup paid personally is capital; operating paid personally is not', () => {
    expect(by.M?.setupPaidPersonally).toBe(50_000)
    expect(by.M?.totalInvested).toBe(1_050_000)
    expect(by.S?.totalInvested).toBe(1_000_000)
  })

  it('reports capital % and the shortfall to equal capital', () => {
    expect(by.H?.capitalPct).toBeCloseTo(800_000 / 3_850_000, 10)
    expect(by.H?.shortfallToEqual).toBe(250_000)
    expect(by.A?.shortfallToEqual).toBe(50_000)
    expect(by.M?.shortfallToEqual).toBe(0)
  })

  it('splits profit by the agreed share, not by capital', () => {
    expect(rows.map((r) => r.profitShare)).toEqual([100_000, 100_000, 100_000, 100_000])
  })

  it('distributions reduce the undistributed balance, not ownership', () => {
    expect(by.A?.distributions).toBe(30_000)
    expect(by.A?.undistributed).toBe(70_000)
    expect(by.A?.agreedSharePct).toBe(25)
    expect(by.A?.capitalRecoveredPct).toBeCloseTo(0.1, 10)
  })

  it('tracks reimbursements owed to a partner until repaid', () => {
    expect(by.S?.reimbursementsOwed).toBe(8_000)
  })
})

describe('project account (rule 14)', () => {
  const payments: Payment[] = [
    {
      kind: 'advance',
      status: 'received',
      currency: 'PKR',
      amount_received: 10_950,
      received_date: '2026-11-01',
      received_by_partner_id: null,
      pkr_received: null,
      forwarded_date: null,
    },
    {
      kind: 'deposit_in',
      status: 'received',
      currency: 'PKR',
      amount_received: 7_300,
      received_date: '2026-11-13',
      received_by_partner_id: null,
      pkr_received: null,
      forwarded_date: null,
    },
    {
      kind: 'deposit_withheld',
      status: 'received',
      currency: 'PKR',
      amount_received: 2_000,
      received_date: '2026-11-17',
      received_by_partner_id: null,
      pkr_received: null,
      forwarded_date: null,
    },
    {
      kind: 'airbnb_payout',
      status: 'received',
      currency: 'USD',
      amount_received: 490.1,
      received_date: '2026-12-28',
      received_by_partner_id: 'S',
      pkr_received: null,
      forwarded_date: null,
    },
  ]
  const entries = projectLedger(movements, payments, expenses)

  it('adds contributions and money received; subtracts expenses, reimbursements and distributions', () => {
    // 3,800,000 contributions - 30,000 distribution + 10,950 advance + 7,300 deposit
    // - 200,000 setup - 150,000 rent - 2,000 reimbursement
    expect(ledgerBalance(entries)).toBe(3_436_250)
  })

  it('withheld deposits and USD still held by a partner move no cash', () => {
    expect(entries.filter((e) => e.kind === 'revenue').map((e) => e.amount)).toEqual([10_950])
    expect(entries.filter((e) => e.kind === 'deposit_in').map((e) => e.amount)).toEqual([7_300])
  })

  it('personally paid setup costs and unreimbursed expenses do not touch the account', () => {
    expect(entries.some((e) => e.amount === -50_000 || e.amount === -8_000)).toBe(false)
  })

  it('can be read as of a date', () => {
    expect(ledgerBalance(entries, '2026-09-30')).toBe(3_600_000)
  })
})

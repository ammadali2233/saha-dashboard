import { describe, expect, it } from 'vitest'
import {
  depositState,
  directSchedule,
  effectiveRate,
  isHeldByPartner,
  realizedDate,
  realizedRevenuePkr,
  toPkr,
  type Payment,
} from './payments'
import { G1, G2 } from './golden'

const pay = (p: Partial<Payment>): Payment => ({
  kind: 'advance',
  status: 'received',
  currency: 'PKR',
  amount_received: null,
  received_date: null,
  received_by_partner_id: null,
  pkr_received: null,
  forwarded_date: null,
  ...p,
})

const airbnbPayout = pay({
  kind: 'airbnb_payout',
  currency: 'USD',
  amount_received: 490.1,
  received_date: '2026-12-28',
  received_by_partner_id: 'partner-saad',
  pkr_received: 133_000,
  forwarded_date: '2026-12-30',
})

describe('currency (rule 1) and Airbnb payouts (rule 9)', () => {
  it('estimates USD at the default rate until a payout is logged', () => {
    expect(toPkr(G1.expected.net, 'USD', [], G1.defaultRate)).toEqual({
      pkr: G1.expected.estPkr,
      rate: 267,
      isEstimate: true,
    })
  })

  it('uses the actual rate once the payout is forwarded in PKR', () => {
    const v = toPkr(G1.expected.net, 'USD', [airbnbPayout], G1.defaultRate)
    expect(v.isEstimate).toBe(false)
    expect(v.pkr).toBe(133_000)
    expect(effectiveRate([airbnbPayout])).toBeCloseTo(271.37, 2)
  })

  it('PKR amounts are their own value', () => {
    expect(toPkr(36_500, 'PKR', [], 267)).toEqual({ pkr: 36_500, rate: 1, isEstimate: false })
  })

  it('USD held by a partner is not realized until forwarded', () => {
    const held = { ...airbnbPayout, pkr_received: null, forwarded_date: null }
    expect(isHeldByPartner(held)).toBe(true)
    expect(realizedDate(held)).toBeNull()
    expect(realizedRevenuePkr(held)).toBe(0)
    expect(realizedDate(airbnbPayout)).toBe('2026-12-30')
    expect(realizedRevenuePkr(airbnbPayout)).toBe(133_000)
  })

  it('direct money paid to a partner counts as received into the project account', () => {
    const p = pay({ kind: 'balance', amount_received: 25_550, received_date: '2026-11-13' })
    expect(realizedDate(p)).toBe('2026-11-13')
    expect(realizedRevenuePkr(p)).toBe(25_550)
  })

  it('scheduled payments and deposits are not revenue; guest refunds reverse it', () => {
    expect(realizedRevenuePkr(pay({ status: 'scheduled', amount_received: 100 }))).toBe(0)
    expect(realizedRevenuePkr(pay({ kind: 'deposit_in', amount_received: 7_300, received_date: '2026-11-13' }))).toBe(0)
    expect(realizedRevenuePkr(pay({ kind: 'guest_refund', amount_received: 1_000, received_date: '2026-11-20' }))).toBe(
      -1_000,
    )
  })

  it('a cancellation payout is revenue on its received date (rule 6)', () => {
    const p = pay({ kind: 'cancellation_payout', amount_received: 5_000, received_date: '2026-12-01' })
    expect(realizedRevenuePkr(p)).toBe(5_000)
  })
})

describe('direct payment schedule and deposits (rule 8)', () => {
  it('splits advance and balance; deposit is separate from the total', () => {
    const s = directSchedule(G2.expected.net, 30, 20, '2026-11-01', G2.checkIn)
    expect(s.advance).toEqual({ amount: G2.expected.advance, due: '2026-11-01' })
    expect(s.balance).toEqual({ amount: G2.expected.balance, due: G2.checkIn })
    expect(s.deposit).toEqual({ amount: G2.expected.deposit, due: G2.checkIn })
  })

  it('tracks a deposit from held to refunded with a withheld part as damage recovery', () => {
    const inP = pay({ kind: 'deposit_in', amount_received: 7_300, received_date: '2026-11-13' })
    expect(depositState([inP]).held).toBe(7_300)
    const refund = pay({ kind: 'deposit_refund', amount_received: 5_300, received_date: '2026-11-17' })
    const withheld = pay({ kind: 'deposit_withheld', amount_received: 2_000, received_date: '2026-11-17' })
    const s = depositState([inP, refund, withheld])
    expect(s).toEqual({ collected: 7_300, refunded: 5_300, withheld: 2_000, held: 0, overReleased: false })
    expect(realizedRevenuePkr(withheld)).toBe(2_000)
  })

  it('flags releasing more than was collected', () => {
    const s = depositState([
      pay({ kind: 'deposit_in', amount_received: 1_000, received_date: '2026-11-13' }),
      pay({ kind: 'deposit_refund', amount_received: 1_500, received_date: '2026-11-17' }),
    ])
    expect(s.overReleased).toBe(true)
  })
})

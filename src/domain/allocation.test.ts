import { describe, expect, it } from 'vitest'
import { allocateNights, byMonth } from './allocation'
import { G1, G2 } from './golden'
import { toCents } from './money'

const sum = (xs: number[]) => xs.reduce((a, b) => a + toCents(b), 0) / 100

describe('night allocation (rule 4)', () => {
  const rows = allocateNights(G1.checkIn, G1.checkOut, G1.lines, G1.feePct, G1.defaultRate)

  it('puts 5 nights in December and 9 in January for 27 Dec to 10 Jan', () => {
    const m = byMonth(rows)
    expect(m.get('2026-12')?.nights).toBe(G1.expected.decNights)
    expect(m.get('2027-01')?.nights).toBe(G1.expected.janNights)
  })

  it('splits net and PKR by month and reconciles to the booking total', () => {
    const m = byMonth(rows)
    expect(m.get('2026-12')?.net).toBe(G1.expected.decNet)
    expect(m.get('2027-01')?.net).toBe(G1.expected.janNet)
    expect(m.get('2026-12')?.netPkr).toBe(G1.expected.decPkr)
    expect(m.get('2027-01')?.netPkr).toBe(G1.expected.janPkr)
    expect(sum(rows.map((r) => r.net))).toBe(G1.expected.net)
    expect(sum(rows.map((r) => r.netPkr))).toBe(G1.expected.estPkr)
  })

  it('lands one-time fees on the check-in night only', () => {
    expect(rows[0]?.fees).toBe(20)
    expect(rows.slice(1).every((r) => r.fees === 0)).toBe(true)
  })

  it('spreads accommodation evenly and the platform fee pro-rata to gross', () => {
    expect(rows.every((r) => r.accommodation === 40)).toBe(true)
    expect(rows[0]?.platformFee).toBe(-9.3)
    expect(rows[1]?.platformFee).toBe(-6.2)
    expect(sum(rows.map((r) => r.platformFee))).toBe(G1.expected.platformFee)
  })

  it('puts the rounding remainder on the last night', () => {
    const r = allocateNights('2026-11-01', '2026-11-04', [{ kind: 'accommodation', amount: 100 }], 0, 1)
    expect(r.map((x) => x.accommodation)).toEqual([33.33, 33.33, 33.34])
  })

  it('spreads discounts with accommodation (PKR direct booking)', () => {
    const r = allocateNights(G2.checkIn, G2.checkOut, G2.lines, 0, 1)
    expect(r.map((x) => x.discounts)).toEqual([-1000, -1000, -1000])
    expect(r.map((x) => x.net)).toEqual([14_500, 11_000, 11_000])
    expect(sum(r.map((x) => x.net))).toBe(G2.expected.net)
  })

  it('handles a stay crossing a month boundary inside a year', () => {
    const r = allocateNights('2026-10-30', '2026-11-02', [{ kind: 'accommodation', amount: 30_000 }], 0, 1)
    const m = byMonth(r)
    expect(m.get('2026-10')?.nights).toBe(2)
    expect(m.get('2026-11')?.nights).toBe(1)
    expect(m.get('2026-10')?.netPkr).toBe(20_000)
  })
})

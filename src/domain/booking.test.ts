import { describe, expect, it } from 'vitest'
import { bookingTotals, nightsBetween, rangesOverlap, revenueState, rolledStatus, stayNights } from './booking'
import { G1, G2 } from './golden'

describe('bookingTotals (rule 2)', () => {
  it('USD Airbnb booking: platform fee is channel % of gross', () => {
    const t = bookingTotals(G1.lines, G1.feePct)
    expect(t.gross).toBe(G1.expected.gross)
    expect(t.platformFee).toBe(G1.expected.platformFee)
    expect(t.platformFeeIsActual).toBe(false)
    expect(t.net).toBe(G1.expected.net)
  })

  it('an actual platform fee line overrides the computed %', () => {
    const t = bookingTotals([...G1.lines, { kind: 'platform_fee', amount: -87.5 }], G1.feePct)
    expect(t.platformFee).toBe(-87.5)
    expect(t.platformFeeIsActual).toBe(true)
    expect(t.net).toBe(492.5)
  })

  it('PKR direct booking: discounts reduce net, no platform fee', () => {
    const t = bookingTotals(G2.lines, G2.feePct)
    expect(t.accommodation).toBe(36_000)
    expect(t.fees).toBe(3_500)
    expect(t.gross).toBe(G2.expected.gross)
    expect(t.discounts).toBe(-3_000)
    expect(t.platformFee).toBe(0)
    expect(t.net).toBe(G2.expected.net)
  })

  it('tax is pass-through: reported but not in gross or net', () => {
    const t = bookingTotals([...G2.lines, { kind: 'tax', amount: 500 }], 0)
    expect(t.tax).toBe(500)
    expect(t.net).toBe(G2.expected.net)
  })

  it('keeps cents exact (no float drift)', () => {
    const t = bookingTotals(
      [
        { kind: 'accommodation', amount: 0.1 },
        { kind: 'cleaning_fee', amount: 0.2 },
      ],
      0,
    )
    expect(t.gross).toBe(0.3)
  })
})

describe('dates', () => {
  it('counts nights across a year boundary', () => {
    expect(nightsBetween('2026-12-27', '2027-01-10')).toBe(14)
    expect(stayNights('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01'])
  })
  it('back-to-back turnovers do not overlap', () => {
    expect(rangesOverlap('2026-11-01', '2026-11-05', '2026-11-05', '2026-11-07')).toBe(false)
    expect(rangesOverlap('2026-11-01', '2026-11-05', '2026-11-04', '2026-11-07')).toBe(true)
  })
})

describe('revenue states (rules 3 and 6)', () => {
  it('maps statuses to booked / earned / excluded', () => {
    expect(revenueState('confirmed')).toBe('booked')
    expect(revenueState('in_house')).toBe('booked')
    expect(revenueState('completed')).toBe('earned')
    expect(revenueState('tentative')).toBe('tentative')
    for (const s of ['cancelled', 'no_show', 'fraud'] as const) expect(revenueState(s)).toBe('excluded')
  })
  it('rolls confirmed to in-house on check-in and to completed on check-out', () => {
    expect(rolledStatus('confirmed', '2026-11-13', '2026-11-16', '2026-11-12')).toBe('confirmed')
    expect(rolledStatus('confirmed', '2026-11-13', '2026-11-16', '2026-11-13')).toBe('in_house')
    expect(rolledStatus('in_house', '2026-11-13', '2026-11-16', '2026-11-16')).toBe('completed')
    expect(rolledStatus('confirmed', '2026-11-13', '2026-11-16', '2026-11-20')).toBe('completed')
    expect(rolledStatus('cancelled', '2026-11-13', '2026-11-16', '2026-11-20')).toBe('cancelled')
  })
})

import { describe, expect, it } from 'vitest'
import { distributeForward, expectedPkr } from './forward'
import { toCents } from './money'

// the six payouts held by Ammad after the import
const held = [
  { id: 'hamza', usd: 33.8 },
  { id: 'azeem', usd: 67.6 },
  { id: 'zumer', usd: 41.4 },
  { id: 'zeeshan', usd: 33.8 },
  { id: 'anica', usd: 105.62 },
  { id: 'talha', usd: 223.92 },
]
const sumPkr = (xs: { pkr: number }[]) => xs.reduce((a, x) => a + toCents(x.pkr), 0) / 100

describe('splitting one withdrawal across payouts', () => {
  it('adds up to exactly the PKR that arrived', () => {
    const shares = distributeForward(held, 140_000)
    expect(sumPkr(shares)).toBe(140_000)
  })

  it('splits in proportion to each payout in USD', () => {
    const shares = distributeForward(
      [
        { id: 'a', usd: 100 },
        { id: 'b', usd: 300 },
      ],
      110_000,
    )
    expect(shares).toEqual([
      { id: 'a', usd: 100, pkr: 27_500, rate: 275 },
      { id: 'b', usd: 300, pkr: 82_500, rate: 275 },
    ])
  })

  it('every payout gets the same effective rate, up to a cent of rounding', () => {
    const shares = distributeForward(held, 140_000)
    const rate = 140_000 / 506.14
    for (const s of shares) expect(Math.abs(s.pkr - s.usd * rate)).toBeLessThan(0.02)
  })

  it('a single payout takes the whole amount', () => {
    expect(distributeForward([{ id: 'x', usd: 223.92 }], 61_000)).toEqual([{ id: 'x', usd: 223.92, pkr: 61_000, rate: 61_000 / 223.92 }])
  })

  it('expected PKR at the quoted rate shows the fee gap', () => {
    expect(expectedPkr(held, 280)).toBe(141_719.2)
  })
})

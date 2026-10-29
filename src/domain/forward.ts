// Rule 9, bulk: one Payoneer withdrawal (USD -> PKR) covering several Airbnb payouts held by a partner.
// The PKR that actually reached the project account is split across the payouts in proportion to their
// USD, in cents, with the rounding remainder on the last one, so the parts always add up to the total.
import { fromCents, splitProRata, toCents } from './money'

export interface HeldPayout {
  id: string
  usd: number
}

export interface ForwardShare {
  id: string
  usd: number
  pkr: number
  rate: number // effective PKR per $ for this payout (pkr / usd)
}

export function distributeForward(payouts: HeldPayout[], totalPkr: number): ForwardShare[] {
  const parts = splitProRata(
    toCents(totalPkr),
    payouts.map((p) => toCents(p.usd)),
  )
  return payouts.map((p, i) => {
    const pkr = fromCents(parts[i] ?? 0)
    return { id: p.id, usd: p.usd, pkr, rate: p.usd > 0 ? pkr / p.usd : 0 }
  })
}

/** What the withdrawal "should" be at the quoted rate; the gap to the actual total is fees and rounding. */
export function expectedPkr(payouts: HeldPayout[], rate: number): number {
  const usdCents = payouts.reduce((a, p) => a + toCents(p.usd), 0)
  return fromCents(Math.round(usdCents * rate))
}

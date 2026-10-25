import { stayNights, type BookingLine, bookingTotals } from './booking'
import { fromCents, roundCents, splitEven, splitProRata, toCents } from './money'

export interface NightRow {
  date: string
  accommodation: number
  fees: number
  discounts: number
  platformFee: number
  net: number
  netPkr: number
}

/**
 * Rule 4. Each night belongs to the month it falls in.
 * - Accommodation spreads evenly across nights (remainder on the last night).
 * - Discounts spread with accommodation, the same way.
 * - One-time fees land on the check-in night.
 * - Platform fee is split pro-rata to each night's gross (remainder on the last night).
 * - PKR = net x rate per night, remainder on the last night so nights sum to round(net x rate).
 */
export function allocateNights(
  checkIn: string,
  checkOut: string,
  lines: BookingLine[],
  channelFeePct: number,
  rate: number,
): NightRow[] {
  const dates = stayNights(checkIn, checkOut)
  const n = dates.length
  if (n === 0) return []
  const t = bookingTotals(lines, channelFeePct)

  const acc = splitEven(toCents(t.accommodation), n)
  const disc = splitEven(toCents(t.discounts), n)
  const fees = dates.map((_, i) => (i === 0 ? toCents(t.fees) : 0))
  const gross = acc.map((a, i) => a + (fees[i] ?? 0))
  const fee = splitProRata(toCents(t.platformFee), gross)
  const net = gross.map((g, i) => g + (disc[i] ?? 0) + (fee[i] ?? 0))

  const totalNet = net.reduce((a, b) => a + b, 0)
  const pkr = net.map((x) => roundCents(x * rate))
  pkr[n - 1] = roundCents(totalNet * rate) - pkr.slice(0, -1).reduce((a, b) => a + b, 0)

  return dates.map((date, i) => ({
    date,
    accommodation: fromCents(acc[i] ?? 0),
    fees: fromCents(fees[i] ?? 0),
    discounts: fromCents(disc[i] ?? 0),
    platformFee: fromCents(fee[i] ?? 0),
    net: fromCents(net[i] ?? 0),
    netPkr: fromCents(pkr[i] ?? 0),
  }))
}

/** Sum night rows by month (`YYYY-MM`). */
export function byMonth(rows: NightRow[]): Map<string, { nights: number; net: number; netPkr: number }> {
  const out = new Map<string, { nights: number; net: number; netPkr: number }>()
  for (const r of rows) {
    const key = r.date.slice(0, 7)
    const cur = out.get(key) ?? { nights: 0, net: 0, netPkr: 0 }
    cur.nights += 1
    cur.net = fromCents(toCents(cur.net) + toCents(r.net))
    cur.netPkr = fromCents(toCents(cur.netPkr) + toCents(r.netPkr))
    out.set(key, cur)
  }
  return out
}


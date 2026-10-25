import { COUNTS_AS_STAY, HOLDS_DATES, rangesOverlap, stayNights, type BookingStatus, type BookingType } from './booking'

export interface Stay {
  id?: string
  checkIn: string
  checkOut: string
  status: BookingStatus
  bookingType: BookingType
}

export interface Block {
  id?: string
  start: string
  end: string
  reason: 'owner_use' | 'maintenance' | 'channel_hold'
}

export interface Occupancy {
  occupied: number
  available: number
  rate: number // 0..1
}

/**
 * Rule 5. Occupancy = occupied nights / available nights over [start, end), counted as distinct
 * dates, so it can never exceed 100%.
 * - Nights before go-live are not available.
 * - Owner-use and maintenance nights are not available (unless a stay occupies them anyway).
 * - Channel holds are soft: ignored.
 * - Rule 7: with `excludeNonStandard`, partner_friends and promotional nights are removed from
 *   both occupied and available, so they neither inflate nor dilute the KPI.
 */
export function occupancy(
  start: string,
  end: string,
  stays: Stay[],
  blocks: Block[],
  opts: { goLive: string; excludeNonStandard?: boolean },
): Occupancy {
  const occupied = new Set<string>()
  const excluded = new Set<string>()
  for (const s of stays) {
    if (!COUNTS_AS_STAY.includes(s.status)) continue
    const nonStandard = s.bookingType !== 'standard'
    for (const d of stayNights(s.checkIn, s.checkOut)) {
      if (opts.excludeNonStandard && nonStandard) excluded.add(d)
      else occupied.add(d)
    }
  }
  for (const b of blocks) {
    if (b.reason === 'channel_hold') continue
    for (const d of stayNights(b.start, b.end)) excluded.add(d)
  }

  let occ = 0
  let avail = 0
  for (const d of stayNights(start, end)) {
    if (d < opts.goLive) continue
    if (occupied.has(d)) {
      occ += 1
      avail += 1
    } else if (!excluded.has(d)) {
      avail += 1
    }
  }
  return { occupied: occ, available: avail, rate: avail === 0 ? 0 : occ / avail }
}

export interface Conflict {
  a: string
  b: string
  start: string
  end: string
}

/** Pairs of items that hold the house over the same nights. Channel holds never conflict. */
export function findConflicts(stays: Stay[], blocks: Block[]): Conflict[] {
  const items = [
    ...stays
      .filter((s) => HOLDS_DATES.includes(s.status))
      .map((s) => ({ id: s.id ?? '', start: s.checkIn, end: s.checkOut })),
    ...blocks.filter((b) => b.reason !== 'channel_hold').map((b) => ({ id: b.id ?? '', start: b.start, end: b.end })),
  ].sort((x, y) => x.start.localeCompare(y.start))

  const out: Conflict[] = []
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const x = items[i]!
      const y = items[j]!
      if (y.start >= x.end) break
      if (rangesOverlap(x.start, x.end, y.start, y.end)) {
        out.push({ a: x.id, b: y.id, start: y.start, end: x.end < y.end ? x.end : y.end })
      }
    }
  }
  return out
}

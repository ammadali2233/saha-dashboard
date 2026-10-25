// iCal import rules, kept pure so they can be unit-tested without a network or a database.
//
// Airbnb's export has, per event: dates, "Reserved" or "Airbnb (Not available)", a reservation URL
// and the guest's last 4 phone digits. No name, no price. Booking.com's export has blocked dates only.
import ical from 'node-ical'

export type ChannelCode = 'airbnb' | 'booking_com'

export interface FeedEvent {
  uid: string
  start: string // YYYY-MM-DD
  end: string // YYYY-MM-DD, exclusive (the check-out day)
  summary: string
  kind: 'reservation' | 'hold'
  code: string | null // Airbnb confirmation code, e.g. HMABCD1234
  phoneLast4: string | null
}

const isoDay = (d: Date & { dateOnly?: boolean }) =>
  // VALUE=DATE values are local-midnight Dates in node-ical: read local parts so the day never shifts
  d.dateOnly
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : d.toISOString().slice(0, 10)

/** Confirmation code from the reservation URL, falling back to a bare HM-code in the text. */
export function extractCode(description: string): string | null {
  const fromUrl = description.match(/reservations\/details\/([A-Z0-9]{6,})/i)?.[1]
  if (fromUrl) return fromUrl.toUpperCase()
  return description.match(/\b(HM[A-Z0-9]{8})\b/)?.[1] ?? null
}

export function parseFeed(text: string, channel: ChannelCode): FeedEvent[] {
  const data = ical.sync.parseICS(text)
  const out: FeedEvent[] = []
  for (const ev of Object.values(data)) {
    if (!ev || ev.type !== 'VEVENT' || !ev.start || !ev.end) continue
    const summary = String(typeof ev.summary === 'object' ? (ev.summary as { val: string }).val : (ev.summary ?? '')).trim()
    const description = String(typeof ev.description === 'object' ? (ev.description as { val: string }).val : (ev.description ?? ''))
    const code = channel === 'airbnb' ? extractCode(description) : null
    const reservation = channel === 'airbnb' && (/^reserved$/i.test(summary) || !!code)
    out.push({
      uid: String(ev.uid),
      start: isoDay(ev.start as Date & { dateOnly?: boolean }),
      end: isoDay(ev.end as Date & { dateOnly?: boolean }),
      summary,
      kind: reservation ? 'reservation' : 'hold',
      code: reservation ? code : null,
      phoneLast4: description.match(/Last 4 Digits\)?:\s*(\d{4})/i)?.[1] ?? null,
    })
  }
  return out.filter((e) => e.end > e.start)
}

export interface ExistingBooking {
  id: string
  ref: string | null
  ical_uid: string | null
  check_in: string
  check_out: string
  status: string
  source: string
  possibly_cancelled_at: string | null
}
export interface ExistingHold {
  id: string
  external_uid: string | null
  start_date: string
  end_date: string
}
export interface Range {
  start: string
  end: string
}

export interface SyncPlan {
  create: FeedEvent[]
  update: { id: string; check_in: string; check_out: string; ical_uid: string; ref: string | null; clearFlag: boolean }[]
  flagMissing: string[]
  createHolds: FeedEvent[]
  updateHolds: { id: string; start: string; end: string }[]
  removeHolds: string[]
  echoes: number
}

const ACTIVE = ['tentative', 'confirmed', 'in_house']

/** Is [s, e) fully covered by the union of ranges? (Used to spot our own blocks echoed back.) */
export function covered(s: string, e: string, ranges: Range[]): boolean {
  let cursor = s
  for (const r of [...ranges].sort((a, b) => a.start.localeCompare(b.start))) {
    if (r.start > cursor) break
    if (r.end > cursor) cursor = r.end
    if (cursor >= e) return true
  }
  return cursor >= e
}

/**
 * Match feed reservations to bookings by confirmation code, then by UID, then by exact dates.
 * - New reservation (current or future) -> stub booking that needs details.
 * - Dates changed -> update.
 * - A synced future booking no longer in the feed -> flagged "possibly cancelled", never auto-cancelled.
 * - "Not available" events -> channel holds, unless they only echo our own bookings/blocks.
 */
export function planSync(input: {
  events: FeedEvent[]
  bookings: ExistingBooking[] // this channel's bookings
  holds: ExistingHold[] // this channel's existing holds
  occupied: Range[] // active bookings and owner/maintenance blocks from everywhere else
  today: string
}): SyncPlan {
  const { events, bookings, holds, occupied, today } = input
  const plan: SyncPlan = { create: [], update: [], flagMissing: [], createHolds: [], updateHolds: [], removeHolds: [], echoes: 0 }
  const matched = new Set<string>()

  for (const ev of events.filter((e) => e.kind === 'reservation')) {
    const match =
      (ev.code && bookings.find((b) => b.ref?.toUpperCase() === ev.code)) ||
      bookings.find((b) => b.ical_uid === ev.uid) ||
      bookings.find((b) => !b.ical_uid && b.check_in === ev.start && b.check_out === ev.end && ACTIVE.includes(b.status))
    if (match) {
      matched.add(match.id)
      const changed = match.check_in !== ev.start || match.check_out !== ev.end || match.ical_uid !== ev.uid || (!match.ref && !!ev.code)
      if (changed || match.possibly_cancelled_at) {
        plan.update.push({
          id: match.id,
          check_in: ev.start,
          check_out: ev.end,
          ical_uid: ev.uid,
          ref: match.ref ?? ev.code,
          clearFlag: !!match.possibly_cancelled_at,
        })
      }
    } else if (ev.end >= today) {
      plan.create.push(ev)
    }
  }

  for (const b of bookings) {
    const synced = b.source === 'ical' || !!b.ical_uid
    if (synced && !matched.has(b.id) && ACTIVE.includes(b.status) && b.check_in > today && !b.possibly_cancelled_at) {
      plan.flagMissing.push(b.id)
    }
  }

  const feedHolds = events.filter((e) => e.kind === 'hold' && e.end >= today)
  const keep = new Set<string>()
  for (const ev of feedHolds) {
    if (covered(ev.start, ev.end, occupied)) {
      plan.echoes += 1
      continue
    }
    const existing = holds.find((h) => h.external_uid === ev.uid)
    if (existing) {
      keep.add(existing.id)
      if (existing.start_date !== ev.start || existing.end_date !== ev.end) plan.updateHolds.push({ id: existing.id, start: ev.start, end: ev.end })
    } else {
      plan.createHolds.push(ev)
    }
  }
  for (const h of holds) if (!keep.has(h.id)) plan.removeHolds.push(h.id)
  return plan
}

import { describe, expect, it } from 'vitest'
import { covered, extractCode, parseFeed, planSync, type ExistingBooking } from './ical'

// Shaped like Airbnb's export (codes and phone digits are made up)
const AIRBNB = `BEGIN:VCALENDAR
PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 1.0//EN
CALSCALE:GREGORIAN
VERSION:2.0
BEGIN:VEVENT
DTEND;VALUE=DATE:20261110
DTSTART;VALUE=DATE:20261107
UID:1418fb94e984-aaaa@airbnb.com
DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMTEST0001\\nPhone Number (Last 4 Digits): 4321
SUMMARY:Reserved
END:VEVENT
BEGIN:VEVENT
DTEND;VALUE=DATE:20270105
DTSTART;VALUE=DATE:20261230
UID:1418fb94e984-bbbb@airbnb.com
DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMNEW00002\\nPhone Number (Last 4 Digits): 9876
SUMMARY:Reserved
END:VEVENT
BEGIN:VEVENT
DTEND;VALUE=DATE:20261126
DTSTART;VALUE=DATE:20261122
UID:hold-echo@airbnb.com
SUMMARY:Airbnb (Not available)
END:VEVENT
BEGIN:VEVENT
DTEND;VALUE=DATE:20261203
DTSTART;VALUE=DATE:20261201
UID:hold-real@airbnb.com
SUMMARY:Airbnb (Not available)
END:VEVENT
END:VCALENDAR`

const BOOKING_COM = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Booking.com//EN
BEGIN:VEVENT
UID:bcom-1
DTSTART;VALUE=DATE:20261215
DTEND;VALUE=DATE:20261218
SUMMARY:CLOSED - Not available
END:VEVENT
END:VCALENDAR`

const booking = (b: Partial<ExistingBooking>): ExistingBooking => ({
  id: 'x',
  ref: null,
  ical_uid: null,
  check_in: '2026-01-01',
  check_out: '2026-01-02',
  status: 'confirmed',
  source: 'manual',
  possibly_cancelled_at: null,
  ...b,
})

describe('parsing', () => {
  it('reads Airbnb reservations with code, dates and phone digits', () => {
    const ev = parseFeed(AIRBNB, 'airbnb')
    expect(ev[0]).toMatchObject({ kind: 'reservation', code: 'HMTEST0001', start: '2026-11-07', end: '2026-11-10', phoneLast4: '4321' })
    expect(ev.filter((e) => e.kind === 'hold')).toHaveLength(2)
  })
  it('treats every Booking.com event as a hold', () => {
    expect(parseFeed(BOOKING_COM, 'booking_com')).toEqual([
      expect.objectContaining({ kind: 'hold', start: '2026-12-15', end: '2026-12-18', code: null }),
    ])
  })
  it('extracts the code from the URL, or a bare HM-code', () => {
    expect(extractCode('https://www.airbnb.com/hosting/reservations/details/hmabcd1234')).toBe('HMABCD1234')
    expect(extractCode('Booking HMZZZZ9999 confirmed')).toBe('HMZZZZ9999')
    expect(extractCode('nothing here')).toBeNull()
  })
})

describe('planning', () => {
  const events = parseFeed(AIRBNB, 'airbnb')
  const today = '2026-10-26'

  it('matches by code and updates changed dates; creates stubs for new reservations', () => {
    const p = planSync({
      events,
      bookings: [booking({ id: 'waseem', ref: 'HMTEST0001', check_in: '2026-11-07', check_out: '2026-11-09', source: 'import' })],
      holds: [],
      occupied: [],
      today,
    })
    expect(p.update).toEqual([
      { id: 'waseem', check_in: '2026-11-07', check_out: '2026-11-10', ical_uid: '1418fb94e984-aaaa@airbnb.com', ref: 'HMTEST0001', clearFlag: false },
    ])
    expect(p.create.map((e) => e.code)).toEqual(['HMNEW00002'])
  })

  it('is idempotent: a second run with synced rows changes nothing', () => {
    const p = planSync({
      events,
      bookings: [
        booking({ id: 'a', ref: 'HMTEST0001', ical_uid: '1418fb94e984-aaaa@airbnb.com', check_in: '2026-11-07', check_out: '2026-11-10', source: 'ical' }),
        booking({ id: 'b', ref: 'HMNEW00002', ical_uid: '1418fb94e984-bbbb@airbnb.com', check_in: '2026-12-30', check_out: '2027-01-05', source: 'ical' }),
      ],
      holds: [{ id: 'h', external_uid: 'hold-real@airbnb.com', start_date: '2026-12-01', end_date: '2026-12-03' }],
      occupied: [{ start: '2026-11-22', end: '2026-11-29' }],
      today,
    })
    expect(p).toEqual({ create: [], update: [], flagMissing: [], createHolds: [], updateHolds: [], removeHolds: [], echoes: 1 })
  })

  it('flags a synced future booking that left the feed, but never cancels it', () => {
    const p = planSync({
      events: [],
      bookings: [booking({ id: 'gone', ref: 'HMGONE0001', ical_uid: 'u', check_in: '2026-12-01', check_out: '2026-12-03', source: 'ical' })],
      holds: [],
      occupied: [],
      today,
    })
    expect(p.flagMissing).toEqual(['gone'])
  })

  it('does not flag past stays or bookings that were never synced', () => {
    const p = planSync({
      events: [],
      bookings: [
        booking({ id: 'past', ical_uid: 'u', source: 'ical', check_in: '2026-10-01', check_out: '2026-10-03' }),
        booking({ id: 'manual', source: 'manual', check_in: '2026-12-01', check_out: '2026-12-03' }),
      ],
      holds: [],
      occupied: [],
      today,
    })
    expect(p.flagMissing).toEqual([])
  })

  it('links a manually entered booking by exact dates when it has no code yet', () => {
    const p = planSync({
      events: [events[1]!],
      bookings: [booking({ id: 'typed', check_in: '2026-12-30', check_out: '2027-01-05' })],
      holds: [],
      occupied: [],
      today,
    })
    expect(p.create).toEqual([])
    expect(p.update[0]).toMatchObject({ id: 'typed', ref: 'HMNEW00002' })
  })

  it('skips holds that only echo our own bookings, keeps real ones, removes vanished ones', () => {
    const p = planSync({
      events,
      bookings: [],
      holds: [{ id: 'old', external_uid: 'gone@airbnb.com', start_date: '2026-11-01', end_date: '2026-11-02' }],
      occupied: [
        { start: '2026-11-22', end: '2026-11-24' },
        { start: '2026-11-24', end: '2026-11-29' },
      ],
      today,
    })
    expect(p.echoes).toBe(1)
    expect(p.createHolds.map((h) => h.uid)).toEqual(['hold-real@airbnb.com'])
    expect(p.removeHolds).toEqual(['old'])
  })

  it('covered() handles adjacent and overlapping ranges', () => {
    expect(covered('2026-11-22', '2026-11-26', [{ start: '2026-11-22', end: '2026-11-24' }, { start: '2026-11-24', end: '2026-11-27' }])).toBe(true)
    expect(covered('2026-11-22', '2026-11-26', [{ start: '2026-11-22', end: '2026-11-24' }])).toBe(false)
  })
})

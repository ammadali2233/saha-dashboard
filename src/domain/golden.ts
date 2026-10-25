// Golden scenarios shared by the Vitest suite and mirrored, number for number, in
// supabase/tests/views_golden.test.sql so the TS rules and the SQL views cannot drift.
import type { BookingLine } from './booking'

/** G1: Airbnb, USD, 27 Dec 2026 to 10 Jan 2027 (14 nights), fee computed at 15.5%. */
export const G1 = {
  checkIn: '2026-12-27',
  checkOut: '2027-01-10',
  feePct: 15.5,
  defaultRate: 267,
  lines: [
    { kind: 'accommodation', amount: 560 },
    { kind: 'cleaning_fee', amount: 20 },
  ] satisfies BookingLine[],
  expected: {
    gross: 580,
    platformFee: -89.9,
    net: 490.1,
    estPkr: 130_856.7,
    decNights: 5,
    janNights: 9,
    decNet: 185.9,
    janNet: 304.2,
    decPkr: 49_635.3,
    janPkr: 81_221.4,
  },
}

/** G2: Direct, PKR, 3 nights, friends and family discount, mattress and cleaning. */
export const G2 = {
  checkIn: '2026-11-13',
  checkOut: '2026-11-16',
  feePct: 0,
  lines: [
    { kind: 'accommodation', amount: 36_000 },
    { kind: 'discount', amount: -3_000 },
    { kind: 'extra_mattress', amount: 2_000 },
    { kind: 'cleaning_fee', amount: 1_500 },
  ] satisfies BookingLine[],
  expected: { gross: 39_500, net: 36_500, advance: 10_950, balance: 25_550, deposit: 7_300 },
}

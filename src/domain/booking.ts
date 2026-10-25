import { fromCents, roundCents, toCents } from './money'
import type { Currency } from './format'

export type LineKind =
  | 'accommodation'
  | 'cleaning_fee'
  | 'extra_guest'
  | 'extra_mattress'
  | 'airport_pickup'
  | 'late_checkout'
  | 'other_fee'
  | 'discount'
  | 'platform_fee'
  | 'tax'

export const FEE_KINDS: readonly LineKind[] = [
  'cleaning_fee',
  'extra_guest',
  'extra_mattress',
  'airport_pickup',
  'late_checkout',
  'other_fee',
]

export const LINE_KIND_LABELS: Record<LineKind, string> = {
  accommodation: 'Accommodation',
  cleaning_fee: 'Cleaning fee',
  extra_guest: 'Extra guest',
  extra_mattress: 'Extra mattress',
  airport_pickup: 'Airport pickup',
  late_checkout: 'Late checkout',
  other_fee: 'Other fee',
  discount: 'Discount',
  platform_fee: 'Platform fee',
  tax: 'Tax (pass-through)',
}

export type BookingStatus = 'tentative' | 'confirmed' | 'in_house' | 'completed' | 'cancelled' | 'no_show' | 'fraud'
export type BookingType = 'standard' | 'partner_friends' | 'promotional'

/** Statuses that hold the house (conflict checks). */
export const HOLDS_DATES: readonly BookingStatus[] = ['tentative', 'confirmed', 'in_house', 'completed']
/** Statuses that count towards nights and revenue (rule 6; tentative is not yet a stay). */
export const COUNTS_AS_STAY: readonly BookingStatus[] = ['confirmed', 'in_house', 'completed']

export interface BookingLine {
  kind: LineKind
  amount: number // signed: discounts and platform fees are negative
}

export interface BookingTotals {
  accommodation: number
  fees: number
  gross: number
  discounts: number
  platformFee: number
  platformFeeIsActual: boolean
  net: number
  tax: number
}

/**
 * Rule 2. Gross = accommodation + fees. Platform fee = channel % of gross unless an actual
 * platform_fee line was entered. Net = gross + discounts + platform fee. Tax lines are
 * pass-through: reported, but not part of gross or net.
 */
export function bookingTotals(lines: BookingLine[], channelFeePct: number): BookingTotals {
  let accommodation = 0
  let fees = 0
  let discounts = 0
  let actualFee = 0
  let hasActualFee = false
  let tax = 0
  for (const line of lines) {
    const c = toCents(line.amount)
    if (line.kind === 'accommodation') accommodation += c
    else if (FEE_KINDS.includes(line.kind)) fees += c
    else if (line.kind === 'discount') discounts += c
    else if (line.kind === 'platform_fee') {
      actualFee += c
      hasActualFee = true
    } else if (line.kind === 'tax') tax += c
  }
  const gross = accommodation + fees
  const platformFee = hasActualFee ? actualFee : -roundCents((gross * channelFeePct) / 100)
  return {
    accommodation: fromCents(accommodation),
    fees: fromCents(fees),
    gross: fromCents(gross),
    discounts: fromCents(discounts),
    platformFee: fromCents(platformFee) || 0,
    platformFeeIsActual: hasActualFee,
    net: fromCents(gross + discounts + platformFee),
    tax: fromCents(tax),
  }
}

export type RevenueState = 'excluded' | 'tentative' | 'booked' | 'earned'

/**
 * Rule 3. Booked = confirmed/in-house (stay not finished). Earned = completed.
 * Cancelled, no-show and fraud are excluded (rule 6); tentative is not revenue yet.
 */
export function revenueState(status: BookingStatus): RevenueState {
  if (status === 'completed') return 'earned'
  if (status === 'confirmed' || status === 'in_house') return 'booked'
  if (status === 'tentative') return 'tentative'
  return 'excluded'
}

/** Rule 5 roll-forward: the status a booking should have on `today` (Karachi date). */
export function rolledStatus(status: BookingStatus, checkIn: string, checkOut: string, today: string): BookingStatus {
  if (status === 'confirmed' && today >= checkIn) status = 'in_house'
  if (status === 'in_house' && today >= checkOut) status = 'completed'
  return status
}

/** All lines in one booking share the booking's currency. */
export function bookingCurrency(lines: { currency: Currency }[]): Currency | 'mixed' | null {
  const set = new Set(lines.map((l) => l.currency))
  if (set.size === 0) return null
  if (set.size > 1) return 'mixed'
  return [...set][0] as Currency
}

/** Number of nights between two ISO dates (check-out exclusive). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000)
}

/** ISO dates for each night of a stay: check-in up to, not including, check-out. */
export function stayNights(checkIn: string, checkOut: string): string[] {
  const out: string[] = []
  const end = Date.parse(checkOut)
  for (let t = Date.parse(checkIn); t < end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate) + days * 86_400_000).toISOString().slice(0, 10)
}

/** [a1, a2) overlaps [b1, b2): back-to-back turnovers (a2 === b1) do not overlap. */
export function rangesOverlap(a1: string, a2: string, b1: string, b2: string): boolean {
  return a1 < b2 && b1 < a2
}

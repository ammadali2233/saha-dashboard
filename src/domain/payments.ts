import { fromCents, roundCents, toCents } from './money'
import type { Currency } from './format'

export type PaymentKind =
  | 'advance'
  | 'balance'
  | 'full'
  | 'airbnb_payout'
  | 'booking_com_payout'
  | 'deposit_in'
  | 'deposit_refund'
  | 'deposit_withheld'
  | 'guest_refund'
  | 'cancellation_payout'

export type PaymentStatus = 'scheduled' | 'due' | 'received' | 'overdue' | 'waived'

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  advance: 'Advance',
  balance: 'Balance',
  full: 'Full payment',
  airbnb_payout: 'Airbnb payout',
  booking_com_payout: 'Booking.com payout',
  deposit_in: 'Security deposit received',
  deposit_refund: 'Security deposit refunded',
  deposit_withheld: 'Deposit withheld (damage recovery)',
  guest_refund: 'Refund to guest',
  cancellation_payout: 'Cancellation payout',
}

export const PAYOUT_KINDS: readonly PaymentKind[] = ['airbnb_payout', 'booking_com_payout']

/** Kinds that are revenue when realized (sign +1) or reverse revenue (-1). Deposits in/out are liabilities. */
export const REVENUE_SIGN: Partial<Record<PaymentKind, 1 | -1>> = {
  advance: 1,
  balance: 1,
  full: 1,
  airbnb_payout: 1,
  booking_com_payout: 1,
  cancellation_payout: 1,
  deposit_withheld: 1, // "Damage recovery" revenue on its date (rule 8)
  guest_refund: -1,
}

export interface Payment {
  kind: PaymentKind
  status: PaymentStatus
  currency: Currency
  amount_received: number | null
  received_date: string | null
  received_by_partner_id: string | null
  pkr_received: number | null
  forwarded_date: string | null
}

/**
 * When money is in the project account in PKR. Money that lands with a partner (Airbnb USD)
 * counts once the partner forwards PKR to the project account (rule 9).
 */
export function realizedDate(p: Payment): string | null {
  if (p.status !== 'received') return null
  return p.received_by_partner_id ? p.forwarded_date : p.received_date
}

/** PKR value once realized, or null while not yet in the project account. */
export function realizedPkr(p: Payment): number | null {
  if (!realizedDate(p)) return null
  if (p.currency === 'PKR') return p.amount_received
  return p.pkr_received
}

/** Signed realized revenue in PKR for one payment (0 for deposits in/out and unrealized money). */
export function realizedRevenuePkr(p: Payment): number {
  const sign = REVENUE_SIGN[p.kind]
  const pkr = realizedPkr(p)
  if (!sign || pkr == null) return 0
  return sign * pkr
}

/** Received in USD by a partner but not yet forwarded as PKR: shown as "held by <partner>". */
export function isHeldByPartner(p: Payment): boolean {
  return p.status === 'received' && !!p.received_by_partner_id && !p.forwarded_date
}

export interface PkrValue {
  pkr: number
  rate: number
  isEstimate: boolean
}

/**
 * Rule 1. PKR value of an amount in the booking's currency. USD uses the effective rate of the
 * booking's logged payouts (Σ PKR received / Σ USD received); before any payout is logged it uses
 * the settings default rate and is an estimate.
 */
export function toPkr(amount: number, currency: Currency, payments: Payment[], defaultRate: number): PkrValue {
  if (currency === 'PKR') return { pkr: amount, rate: 1, isEstimate: false }
  const rate = effectiveRate(payments)
  const used = rate ?? defaultRate
  return { pkr: fromCents(roundCents(toCents(amount) * used)), rate: used, isEstimate: rate == null }
}

export function effectiveRate(payments: Payment[]): number | null {
  let usd = 0
  let pkr = 0
  for (const p of payments) {
    if (!PAYOUT_KINDS.includes(p.kind) || p.currency !== 'USD') continue
    if (p.status !== 'received' || p.pkr_received == null || !p.amount_received) continue
    usd += toCents(p.amount_received)
    pkr += toCents(p.pkr_received)
  }
  return usd > 0 ? pkr / usd : null
}

export interface DepositState {
  collected: number
  refunded: number
  withheld: number
  held: number
  overReleased: boolean
}

/** Rule 8. Deposit is a liability: held = in - refunded - withheld. Withheld becomes revenue. */
export function depositState(payments: Payment[]): DepositState {
  let collected = 0
  let refunded = 0
  let withheld = 0
  for (const p of payments) {
    if (p.status !== 'received' || p.amount_received == null) continue
    const c = toCents(p.amount_received)
    if (p.kind === 'deposit_in') collected += c
    else if (p.kind === 'deposit_refund') refunded += c
    else if (p.kind === 'deposit_withheld') withheld += c
  }
  const held = collected - refunded - withheld
  return {
    collected: fromCents(collected),
    refunded: fromCents(refunded),
    withheld: fromCents(withheld),
    held: fromCents(held),
    overReleased: held < 0,
  }
}

export interface DirectSchedule {
  advance: { amount: number; due: string }
  balance: { amount: number; due: string }
  deposit: { amount: number; due: string }
}

/**
 * Rule 8. Direct bookings: advance % of net due on confirmation, the rest due on check-in.
 * Deposit is a % of net, collected at check-in, and is not part of the total.
 */
export function directSchedule(
  net: number,
  advancePct: number,
  depositPct: number,
  confirmedOn: string,
  checkIn: string,
): DirectSchedule {
  const total = toCents(net)
  const advance = roundCents((total * advancePct) / 100)
  return {
    advance: { amount: fromCents(advance), due: confirmedOn },
    balance: { amount: fromCents(total - advance), due: checkIn },
    deposit: { amount: fromCents(roundCents((total * depositPct) / 100)), due: checkIn },
  }
}

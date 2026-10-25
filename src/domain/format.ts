import { formatInTimeZone } from 'date-fns-tz'

export const PROPERTY_TZ = 'Asia/Karachi'

export type Currency = 'PKR' | 'USD'

const pkr = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `PKR 150,000` or `$40.00`. Negative amounts get a leading minus. */
export function formatMoney(amount: number, currency: Currency): string {
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  return currency === 'PKR' ? `${sign}PKR ${pkr.format(Math.round(abs))}` : `${sign}$${usd.format(abs)}`
}

/** Today's date in Karachi as `YYYY-MM-DD`, whatever timezone the code runs in. */
export function pkToday(now: Date = new Date()): string {
  return formatInTimeZone(now, PROPERTY_TZ, 'yyyy-MM-dd')
}

/** `2026-10-25` → `25 Oct 2026`. Accepts an ISO date string (calendar date, no timezone shift). */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return isoDate
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** A timestamp shown in Karachi time: `25 Oct 2026, 14:05`. */
export function formatTimestamp(ts: string | Date): string {
  return formatInTimeZone(ts, PROPERTY_TZ, 'd MMM yyyy, HH:mm')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

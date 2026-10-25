import { describe, expect, it } from 'vitest'
import { formatDate, formatMoney, formatTimestamp, pkToday } from './format'

describe('formatMoney', () => {
  it('formats PKR without decimals', () => {
    expect(formatMoney(150000, 'PKR')).toBe('PKR 150,000')
    expect(formatMoney(1234.6, 'PKR')).toBe('PKR 1,235')
  })
  it('formats USD with cents', () => {
    expect(formatMoney(40, 'USD')).toBe('$40.00')
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50')
  })
  it('keeps the sign on negatives', () => {
    expect(formatMoney(-5000, 'PKR')).toBe('-PKR 5,000')
    expect(formatMoney(-6.2, 'USD')).toBe('-$6.20')
  })
})

describe('dates in Asia/Karachi', () => {
  it('formats calendar dates as 25 Oct 2026', () => {
    expect(formatDate('2026-10-25')).toBe('25 Oct 2026')
    expect(formatDate('2027-01-05')).toBe('5 Jan 2027')
  })
  it('pkToday rolls over at Karachi midnight, not UTC midnight', () => {
    // 19:30 UTC on 24 Oct is 00:30 on 25 Oct in Karachi (UTC+5)
    expect(pkToday(new Date('2026-10-24T19:30:00Z'))).toBe('2026-10-25')
    expect(pkToday(new Date('2026-10-24T18:59:00Z'))).toBe('2026-10-24')
  })
  it('shows timestamps in Karachi time', () => {
    expect(formatTimestamp('2026-10-25T09:05:00Z')).toBe('25 Oct 2026, 14:05')
  })
})

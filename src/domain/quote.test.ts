import { describe, expect, it } from 'vitest'
import { defaultDeposit, quoteTotals, quoteWhatsApp, type QuoteDoc } from './quote'

// the sheet's "Quotation - Final", with a made-up guest name
const doc: QuoteDoc = {
  number: 'Q-2026-001',
  issue_date: '2026-10-19',
  prepared_for: 'Test Guest',
  check_in: '2026-11-22',
  check_out: '2026-11-29',
  scope: 'full_house',
  guest_count: 6,
  advance_pct: 30,
  deposit_amount: 21000,
  valid_until: '2026-10-26',
  notes: null,
  property_name: 'DHA Retreat',
  brand: 'SAHA Residences',
  lines: [
    { kind: 'accommodation', label: 'Nightly rate, full house (22-29 Nov)', qty: 7, unit_amount: 20000, amount: 140000 },
    { kind: 'discount', label: 'Friends and family discount', qty: 7, unit_amount: -5000, amount: -35000 },
  ],
}

describe('quote totals', () => {
  it('reproduces the sheet: 105,000 total, 31,500 advance, 73,500 at check-in', () => {
    expect(quoteTotals(doc)).toEqual({ nights: 7, subtotal: 140000, discounts: -35000, total: 105000, advance: 31500, balance: 73500, deposit: 21000 })
  })
  it('the deposit is 20% of the total and never part of it', () => {
    expect(defaultDeposit(105000, 20)).toBe(21000)
    expect(defaultDeposit(164500, 20)).toBe(32900)
  })
  it('handles the rough quote with a half-rent single-room night and cleaning', () => {
    const t = quoteTotals({
      ...doc,
      check_in: '2026-12-16',
      check_out: '2026-12-26',
      lines: [
        { kind: 'accommodation', label: 'Nightly rate', qty: 9, unit_amount: 20000, amount: 180000 },
        { kind: 'discount', label: 'Friends and family', qty: 9, unit_amount: -3000, amount: -27000 },
        { kind: 'accommodation', label: 'Special deal (half rent)', qty: 1, unit_amount: 8500, amount: 8500 },
        { kind: 'cleaning_fee', label: 'Cleaning', qty: 3, unit_amount: 1000, amount: 3000 },
      ],
    })
    expect(t.total).toBe(164500)
    expect(t.advance).toBe(49350)
    expect(t.balance).toBe(115150)
  })
})

describe('WhatsApp text', () => {
  const text = quoteWhatsApp(doc)
  it('has the header, charges, total and schedule', () => {
    expect(text).toContain('*QUOTATION: DHA RETREAT*')
    expect(text).toContain('Issued by SAHA Residences · Q-2026-001')
    expect(text).toContain('Stay: 22 Nov 2026 to 29 Nov 2026 (7 nights, full house, 6 guests)')
    expect(text).toContain('• Friends and family discount: -PKR 5,000 × 7 = -PKR 35,000')
    expect(text).toContain('*Total payable: PKR 105,000*')
    expect(text).toContain('• Advance (30%), to confirm the booking: PKR 31,500')
    expect(text).toContain('• Remaining (70%), at check-in: PKR 73,500')
  })
  it('states the deposit separately and excluded from the total', () => {
    expect(text).toMatch(/Security deposit.*PKR 21,000\. It is separate from, and not included in, the total above\./)
  })
  it('references the House Rules shared on WhatsApp', () => {
    expect(text).toContain('1. Terms and rules are set out in the House Rules, shared separately on WhatsApp.')
  })
})

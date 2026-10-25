// Reconciliation logic of the sheet import, on a small synthetic workbook shaped like the real export.
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { buildPlan, type Corrections } from './plan'

function workbook() {
  const wb = new ExcelJS.Workbook()
  const tab = (name: string, headerRow: number, headers: string[], rows: unknown[][]) => {
    const ws = wb.addWorksheet(name)
    ws.getRow(headerRow).values = headers
    rows.forEach((r, i) => (ws.getRow(headerRow + 1 + i).values = r as ExcelJS.CellValue[]))
  }
  const d = (s: string) => new Date(`${s}T00:00:00Z`)
  tab('Revenue', 4,
    ['Booking Ref', 'Channel', 'Guest Name', 'Check-in', 'Check-out', 'Nights', 'Guests', 'Nightly Rate', 'Accommodation', 'Cleaning Fee', 'Gross', 'Fee %', 'Platform Fee', 'Additional Fees', 'Discounts', 'Net Payout', 'PKR payout approximation', 'Payment Status', 'Month', 'Notes'],
    [
      ['HMAAAA0001', 'Airbnb', 'Partner', d('2026-10-01'), d('2026-10-03'), 2, 2, 40, 80, null, 80, 0.155, 12.4, null, null, 67.6, 18049, 'Received', null, 'Fake listing for reviews'],
      ['HMBBBB0002', 'Airbnb', 'Guest B', d('2026-12-27'), d('2027-01-10'), 14, 6, 48, 672, null, 672, 0.155, 104.16, null, null, 567.84, 151613, 'Pending', null, 'Make his Airport Pickup Arrangement'],
      ['HMCCCC0003', 'Airbnb', 'Guest C', d('2026-10-20'), d('2026-10-22'), 2, 9, 60, 120, 5, 125, 0.155, 19.375, 6000, null, 105.625, 34201, 'Received', null, null],
      ['HMDDDD0004', 'Airbnb', 'Guest D', d('2026-10-10'), d('2026-10-11'), 1, 4, 56, 56, 5, 61, 0.155, 9.455, null, null, 51.545, 13762, 'Cancelled', null, null],
      ['-', 'Booking.com', 'Scammer', d('2026-10-11'), d('2026-10-15'), 4, 5, 72.45, 289.8, null, 289.8, 0.15, 43.47, null, null, 246.33, 65770, 'Cancelled', null, 'Scam'],
      ['-', 'Direct / WhatsApp', 'Direct Guest', d('2026-11-22'), d('2026-11-29'), 7, 6, null, null, null, null, null, null, 105000, null, null, 105000, 'Pending', null, '31500 advance received'],
    ])
  tab('Setup Costs', 4,
    ['#', 'Category', 'Item', 'Vendor', 'Budget (PKR)', 'Actual Paid (PKR)', 'Variance (PKR)', 'Paid By', 'Payment Date', 'Status', 'Notes', 'Source Area', 'Buy Date'],
    [
      [1, 'Lease', 'Security deposit', 'Landlord', 450000, 450000, 0, 'Hamza Mahad Dar', d('2026-09-21'), 'Paid'],
      [2, 'Furniture', 'Sofa', 'The Beige Theory', 400000, 450000, -50000, 'Project Account', d('2026-09-22'), 'Paid'],
      [3, 'Interiors', 'Throws', null, 20000, null, 20000],
      [4, null, 'Scam', null, 24000, 24000, 0, 'Project Account'],
      [5],
    ])
  tab('Investment', 4, ['Date', 'Partner', 'Type', 'Amount (PKR)', 'Mode', 'Notes'], [
    [d('2026-09-25'), 'Mohammed Azeem', 'Contribution', 100000, 'Bank Transfer'],
    [d('2026-09-25'), 'Mohammed Azeem', 'Contribution', 100000, 'Bank Transfer'],
  ])
  tab('Operating Expenses', 4, ['Date', 'Month', 'Category', 'Description', 'Amount (PKR)', 'Paid By', 'Reimbursed?', 'Notes'], [
    [d('2026-10-05'), null, 'Internet & TV', 'Internet Bill', 4483, 'Project Account', 'No'],
    [d('2026-10-19'), null, 'Cleaning', null, 1000, 'Saad Raza'],
  ])
  tab('Tasks & Gantt', 5, ['#', 'Phase', 'Task', 'Source Area', 'Cost Item', 'Qty', 'Owner', 'Start', 'Days', 'End', 'Status', '% Done', 'Budget (PKR)', 'Notes'], [
    [1, 'Lease', 'Finalise lease', null, null, null, 'Hamza Mahad Dar', d('2026-09-21'), 1, d('2026-09-21'), 'Done'],
    [2, 'Launch', 'Hire caretaker / cleaner', null, null, null, 'Hamza Mahad Dar', d('2026-09-28'), 5, d('2026-10-02'), 'Not Started'],
  ])
  return (name: string) => wb.getWorksheet(name)!
}

const corrections: Corrections = {
  airbnbPayoutPartner: 'Ammad Ali',
  receivedPayoutsForwarded: false,
  advanceDates: { 'Direct Guest': '2026-10-19' },
  setupCategories: { '4': 'operating:Loss / Fraud' },
  setupRenames: {},
  setupMissingPaidDate: '2026-10-06',
  partnerFriendsRefs: ['HMAAAA0001'],
  extraChargeDates: { HMCCCC0003: '2026-10-22' },
  vendorQuotes: [{ vendor: 'The Beige Theory', amount: 400000, matchVendor: 'The Beige Theory' }],
  directQuotes: {
    'Direct Guest': {
      lines: [
        { kind: 'accommodation', label: 'Nightly rate', qty: 7, unit_amount: 20000 },
        { kind: 'discount', discount_subtype: 'friends_family', label: 'F&F', qty: 7, unit_amount: 5000 },
      ],
      advance: 31500,
      deposit: 21000,
    },
  },
}

describe('sheet import plan', () => {
  const plan = buildPlan(workbook(), corrections, '2026-10-25')
  const recon = (tab: string, measure: string) => plan.recon.find((r) => r.tab === tab && r.measure === measure)

  it('imports every booking row, including dash refs, with distinct keys', () => {
    expect(plan.bookings).toHaveLength(6)
    expect(new Set(plan.bookings.map((b) => b.import_key)).size).toBe(6)
    expect(plan.bookings.filter((b) => b.ref === null)).toHaveLength(2)
  })

  it('reconciles booking counts and nights with the sheet', () => {
    expect(recon('Revenue', 'Non-cancelled bookings')).toMatchObject({ source: 4, plan: 4 })
    expect(recon('Revenue', 'Non-cancelled nights')).toMatchObject({ source: 25, plan: 25 })
  })

  it('maps statuses: cancelled, scam to fraud, and rolls dates forward', () => {
    const status = Object.fromEntries(plan.bookings.map((b) => [b.import_key, b.status]))
    expect(status['rev:HMDDDD0004']).toBe('cancelled')
    expect(status['rev:booking_com:scammer:2026-10-11']).toBe('fraud')
    expect(status['rev:HMAAAA0001']).toBe('completed')
    expect(status['rev:HMBBBB0002']).toBe('confirmed')
  })

  it('rebuilds direct bookings from the quote and blocks nothing when dates are known', () => {
    const lines = plan.lines.filter((l) => l.booking_key === 'rev:direct:direct-guest:2026-11-22')
    expect(lines.map((l) => l.amount)).toEqual([140000, -35000])
    expect(plan.issues.filter((i) => i.level === 'blocking')).toEqual([])
  })

  it('keeps Airbnb received payouts held by the partner, and PKR extras separate', () => {
    const payout = plan.payments.find((p) => p.import_key === 'rev:HMAAAA0001:pay:payout')
    expect(payout).toMatchObject({ status: 'received', amount_received: 67.6, received_by_partner: 'Ammad Ali', currency: 'USD' })
    expect(plan.payments.find((p) => p.kind === 'extra_charge')).toMatchObject({ amount_received: 6000, currency: 'PKR' })
  })

  it('reconciles setup, investment and operating totals; moves the scam row to operating', () => {
    expect(recon('Setup Costs', 'Actual paid (PKR)')).toMatchObject({ source: 924000, plan: 924000 })
    expect(plan.expenses.find((e) => e.import_key === 'setup:4')).toMatchObject({ kind: 'operating', category: 'Loss / Fraud', paid_date: '2026-10-06' })
    expect(plan.expenses.find((e) => e.import_key === 'setup:3')).toMatchObject({ status: 'due', amount: 0, budget_amount: 20000 })
    expect(recon('Investment', 'Contributions (PKR)')).toMatchObject({ source: 200000, plan: 200000 })
    expect(new Set(plan.capital.map((m) => m.import_key)).size).toBe(2) // same-day duplicates kept apart
    expect(recon('Operating Expenses', 'Total (PKR)')).toMatchObject({ source: 5483, plan: 5483 })
    expect(plan.expenses.find((e) => e.item === 'Cleaning')).toMatchObject({ paid_by_partner: 'Saad Raza', reimbursable: true })
  })

  it('flags an overpaid vendor and turns note action items and open setup tasks into tasks', () => {
    expect(plan.issues.some((i) => i.level === 'review' && i.text.includes('The Beige Theory'))).toBe(true)
    expect(plan.tasks.map((t) => t.title).sort()).toEqual(['Arrange airport pickup', 'Hire caretaker / cleaner'])
  })

  it('blocks the import while an advance date is unknown', () => {
    const p = buildPlan(workbook(), { ...corrections, advanceDates: { 'Direct Guest': null } }, '2026-10-25')
    expect(p.issues.filter((i) => i.level === 'blocking')).toHaveLength(1)
  })
})

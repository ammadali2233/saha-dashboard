// Turns the sheet into an import plan: normalized rows for each table, the deliberate corrections
// made along the way, open issues, and source-vs-plan totals for the reconciliation report.
import { addDays, bookingTotals, nightsBetween, rolledStatus, type BookingLine, type BookingStatus } from '../../src/domain/booking'
import { fromCents, toCents } from '../../src/domain/money'
import { readTable, type SheetRow } from './workbook'
import type ExcelJS from 'exceljs'

export interface Corrections {
  airbnbPayoutPartner: string
  receivedPayoutsForwarded: boolean
  /** Date each direct-booking advance was received (YYYY-MM-DD), keyed by guest name. null = not known yet. */
  advanceDates: Record<string, string | null>
  /** Setup row "#" -> category. "operating:<category>" moves the row to operating expenses. */
  setupCategories: Record<string, string>
  setupRenames: Record<string, string>
  setupMissingPaidDate: string
  /** Rows whose notes mark a stay by partners/close contacts (rule 7 booking type). */
  partnerFriendsRefs: string[]
  /** PKR collected outside the Airbnb payout (Revenue "Additional Fees" on a USD booking). */
  extraChargeDates: Record<string, string>
  vendorQuotes: { vendor: string; amount: number; matchVendor: string }[]
  /** Direct bookings, rebuilt from their quotes (rule 2: never a total in a fee column). */
  directQuotes: Record<
    string,
    {
      lines: { kind: BookingLine['kind']; discount_subtype?: string; label: string; qty: number; unit_amount: number }[]
      advance: number
      deposit: number
    }
  >
}

export interface Issue {
  level: 'blocking' | 'review' | 'info'
  text: string
}

type Rec = Record<string, string | number | boolean | null>

export interface Plan {
  guests: Rec[]
  bookings: Rec[]
  lines: Rec[]
  payments: Rec[]
  vendorQuotes: Rec[]
  expenses: Rec[]
  capital: Rec[]
  tasks: Rec[]
  corrections: string[]
  issues: Issue[]
  recon: { tab: string; measure: string; source: number | string; plan: number | string; note?: string }[]
}

const CHANNEL_CODE: Record<string, string> = {
  Airbnb: 'airbnb',
  'Booking.com': 'booking_com',
  'Direct / WhatsApp': 'direct',
  Direct: 'direct',
  Other: 'other',
}
const FEE_PCT: Record<string, number> = { airbnb: 15.5, booking_com: 15, direct: 0, other: 0 }
const SETUP_CATEGORIES = ['Lease', 'Furniture', 'Appliances', 'Interiors', 'Site Works', 'Launch', 'Misc']
const OPERATING_CATEGORIES = [
  'Rent', 'Electricity', 'Gas', 'Water', 'Internet & TV', 'Staff Salary', 'Cleaning', 'Laundry',
  'Maintenance & Repairs', 'Guest Supplies', 'Marketing', 'Bank & Payment Charges', 'Loss / Fraud', 'Other',
]
const sum = (xs: (number | null | undefined)[]) => fromCents(xs.reduce<number>((a, x) => a + toCents(x ?? 0), 0))
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function buildPlan(sheet: (name: string) => ExcelJS.Worksheet, c: Corrections, today: string): Plan {
  const plan: Plan = {
    guests: [], bookings: [], lines: [], payments: [], vendorQuotes: [], expenses: [], capital: [], tasks: [],
    corrections: [], issues: [], recon: [],
  }
  const partnerNames = new Set(['Hamza Mahad Dar', 'Mohammed Azeem', 'Saad Raza', 'Ammad Ali'])

  plan.corrections.push('Property is "DHA Retreat", brand "SAHA Residences"; the sheet\'s "Bliss Haven" name is not imported (issue 1).')
  plan.corrections.push('Master, Monthly P&L and Shopping Runs are formula outputs and are not imported; every figure is recomputed from raw rows (issue 11).')

  // ------------------------------------------------------------------ Revenue -> bookings
  const rev = readTable(sheet('Revenue'), 4, 'Channel')
  const guestKeys = new Map<string, string>()
  let srcNights = 0
  let srcActive = 0
  const srcReceivedPkr: (number | null)[] = []
  const srcPendingPkr: (number | null)[] = []

  for (const r of rev) {
    const channelName = r.str('Channel')
    const code = CHANNEL_CODE[channelName]
    if (!code) {
      plan.issues.push({ level: 'blocking', text: `Revenue row ${r.row}: unknown channel "${channelName}".` })
      continue
    }
    const refRaw = r.str('Booking Ref')
    const ref = refRaw && !/^[-–—]+$/.test(refRaw) ? refRaw : null // '-' means no ref
    const guest = r.str('Guest Name')
    const checkIn = r.date('Check-in')
    const checkOut = r.date('Check-out')
    if (!checkIn || !checkOut) {
      plan.issues.push({ level: 'blocking', text: `Revenue row ${r.row} (${guest}): missing dates.` })
      continue
    }
    const key = `rev:${ref ?? `${code}:${slug(guest)}:${checkIn}`}`
    const status = r.str('Payment Status')
    const notes = r.str('Notes')
    const nights = nightsBetween(checkIn, checkOut)
    const cancelled = status === 'Cancelled'
    const scam = /scam/i.test(notes)

    if (!cancelled) {
      srcActive += 1
      srcNights += nights
    }
    if (status === 'Received') srcReceivedPkr.push(r.num('PKR payout approximation'))
    if (status === 'Pending') srcPendingPkr.push(r.num('PKR payout approximation'))
    if (r.num('Nights') != null && r.num('Nights') !== nights) {
      plan.issues.push({ level: 'review', text: `${guest}: sheet says ${r.num('Nights')} nights, dates give ${nights}.` })
    }

    // guest
    let guestKey = guestKeys.get(guest.toLowerCase())
    if (!guestKey && guest) {
      guestKey = `guest:${slug(guest)}`
      guestKeys.set(guest.toLowerCase(), guestKey)
      plan.guests.push({ import_key: guestKey, name: guest, source: channelName })
    }

    // status: rolled forward to today (rule 5), cancellations kept, scam = fraud
    const bStatus: BookingStatus = cancelled ? (scam ? 'fraud' : 'cancelled') : rolledStatus('confirmed', checkIn, checkOut, today)
    if (cancelled && scam) {
      plan.corrections.push(`${channelName} booking for ${guest} (${checkIn}) marked "Scam": imported with status fraud (issue 10).`)
    }
    const partnerFriends = (ref && c.partnerFriendsRefs.includes(ref)) || false
    if (partnerFriends) {
      plan.corrections.push(`${guest} (${ref}): stay for reviews by partners/close contacts, imported as booking type partner_friends (issue 14).`)
    }

    // lines
    type Line = { kind: BookingLine['kind']; discount_subtype?: string; label: string; qty: number; unit_amount: number; amount: number }
    const lines: Line[] = []
    const signed = (k: BookingLine['kind'], n: number) => (k === 'discount' || k === 'platform_fee' ? -Math.abs(n) : Math.abs(n))
    const lineOf = (l: Omit<Line, 'amount'>, amount?: number): Line => ({ ...l, amount: signed(l.kind, amount ?? fromCents(Math.round((toCents(l.qty) * toCents(l.unit_amount)) / 100))) })
    let currency: 'PKR' | 'USD' = 'USD'
    if (code === 'direct') {
      currency = 'PKR'
      const q = c.directQuotes[guest]
      if (!q) {
        plan.issues.push({ level: 'blocking', text: `Direct booking ${guest}: no quote mapping in corrections.directQuotes.` })
        continue
      }
      lines.push(...q.lines.map((l) => lineOf(l)))
      plan.corrections.push(
        `${guest}: sheet had PKR ${r.num('Additional Fees')?.toLocaleString('en-US')} in "Additional Fees" with Gross 0; rebuilt as PKR line items from the quote (issue 3).`,
      )
    } else {
      const rate = r.num('Nightly Rate') ?? 0
      const acc = r.num('Accommodation') ?? 0
      if (Math.abs(toCents(rate * nights) - toCents(acc)) > 1) {
        plan.issues.push({ level: 'review', text: `${guest}: nightly rate x nights (${rate} x ${nights}) differs from Accommodation ${acc}; using Accommodation.` })
      }
      // amount is the sheet's exact Accommodation total; unit is the nightly rate
      lines.push(lineOf({ kind: 'accommodation', label: `${nights} night${nights === 1 ? '' : 's'}`, qty: nights, unit_amount: rate || fromCents(Math.round(toCents(acc) / nights)) }, acc))
      const clean = r.num('Cleaning Fee')
      if (clean) lines.push(lineOf({ kind: 'cleaning_fee', label: 'Cleaning fee', qty: 1, unit_amount: clean }))
      if (r.num('Discounts')) {
        plan.issues.push({ level: 'review', text: `${guest}: has a Discounts value (${r.num('Discounts')}); imported as a custom discount.` })
        lines.push(lineOf({ kind: 'discount', discount_subtype: 'custom', label: 'Discount', qty: 1, unit_amount: Math.abs(r.num('Discounts')!) }))
      }
    }

    const totals = bookingTotals(lines, FEE_PCT[code]!)

    if (code !== 'direct') {
      const sheetNet = r.num('Net Payout')
      if (sheetNet != null && Math.abs(toCents(sheetNet) - toCents(totals.net)) > 1) {
        plan.issues.push({ level: 'review', text: `${guest}: sheet net ${sheetNet} vs recomputed ${totals.net} (rounding of the platform fee).` })
      }
    } else if (Math.abs(toCents(r.num('Additional Fees') ?? 0) - toCents(totals.net)) > 0) {
      plan.issues.push({ level: 'blocking', text: `${guest}: quote lines total PKR ${totals.net}, sheet says ${r.num('Additional Fees')}.` })
    }

    plan.bookings.push({
      import_key: key,
      ref,
      channel_code: code,
      guest_key: guestKey ?? null,
      check_in: checkIn,
      check_out: checkOut,
      guest_count: r.num('Guests'),
      booking_type: partnerFriends ? 'partner_friends' : 'standard',
      status: bStatus,
      notes: notes || null,
    })
    lines.forEach((l, i) => {
      plan.lines.push({
        import_key: `${key}:line:${i + 1}`,
        booking_key: key,
        kind: l.kind,
        discount_subtype: l.discount_subtype ?? null,
        label: l.label,
        qty: l.qty,
        unit_amount: signed(l.kind, l.unit_amount),
        amount: l.amount,
        currency,
        sort_order: i,
      })
    })

    // payments
    if (code === 'direct') {
      const q = c.directQuotes[guest]!
      const advDate = c.advanceDates[guest] ?? null
      if (!advDate) plan.issues.push({ level: 'blocking', text: `${guest}: date the advance of PKR ${q.advance.toLocaleString('en-US')} was received is not known yet (corrections.advanceDates).` })
      plan.payments.push({
        import_key: `${key}:pay:advance`, booking_key: key, kind: 'advance', currency: 'PKR',
        amount_due: q.advance, due_date: advDate, status: 'received', amount_received: q.advance,
        received_date: advDate, method: null, received_by_partner: null, notes: 'Imported from the sheet notes',
      })
      plan.payments.push({
        import_key: `${key}:pay:balance`, booking_key: key, kind: 'balance', currency: 'PKR',
        amount_due: fromCents(toCents(totals.net) - toCents(q.advance)), due_date: checkIn, status: 'scheduled',
        amount_received: null, received_date: null, method: null, received_by_partner: null, notes: null,
      })
      plan.payments.push({
        import_key: `${key}:pay:deposit`, booking_key: key, kind: 'deposit_in', currency: 'PKR',
        amount_due: q.deposit, due_date: checkIn, status: 'scheduled', amount_received: null, received_date: null,
        method: null, received_by_partner: null, notes: 'Refundable security deposit, per the quote',
      })
    } else if (!cancelled) {
      const due = addDays(checkIn, 1)
      const kind = code === 'booking_com' ? 'booking_com_payout' : 'airbnb_payout'
      if (status === 'Received') {
        plan.payments.push({
          import_key: `${key}:pay:payout`, booking_key: key, kind, currency: 'USD', amount_due: totals.net, due_date: due,
          status: 'received', amount_received: totals.net, received_date: due, method: 'airbnb_payout',
          received_by_partner: c.airbnbPayoutPartner,
          forwarded: c.receivedPayoutsForwarded,
          notes: 'Imported: received date estimated as check-in + 1 day. PKR to be confirmed when forwarded.',
        })
      } else {
        plan.payments.push({
          import_key: `${key}:pay:payout`, booking_key: key, kind, currency: 'USD', amount_due: totals.net, due_date: due,
          status: 'scheduled', amount_received: null, received_date: null, method: null, received_by_partner: null, notes: null,
        })
      }
      const extra = code !== 'direct' ? r.num('Additional Fees') : null
      if (extra) {
        const date = ref ? c.extraChargeDates[ref] : undefined
        if (!date) {
          plan.issues.push({ level: 'blocking', text: `${guest}: PKR ${extra} additional fee has no mapping (corrections.extraChargeDates).` })
        } else {
          plan.payments.push({
            import_key: `${key}:pay:extra`, booking_key: key, kind: 'extra_charge', currency: 'PKR', amount_due: extra,
            due_date: date, status: 'received', amount_received: extra, received_date: date, method: 'cash',
            received_by_partner: null, notes: 'Extra guests, paid in cash (PKR) on top of the Airbnb payout',
          })
          plan.corrections.push(`${guest}: PKR ${extra.toLocaleString('en-US')} cash for extra guests imported as a PKR "extra charge" payment on ${date}, separate from the USD payout.`)
        }
      }
    }

    // tasks from notes (issue 13)
    for (const t of tasksFromNotes(notes, checkIn)) {
      plan.tasks.push({ import_key: `${key}:task:${slug(t.title)}`, booking_key: key, ...t })
    }
  }

  plan.recon.push(
    { tab: 'Revenue', measure: 'Booking rows', source: rev.length, plan: plan.bookings.length },
    { tab: 'Revenue', measure: 'Non-cancelled bookings', source: srcActive, plan: plan.bookings.filter((b) => !['cancelled', 'fraud'].includes(String(b.status))).length,
      note: 'Brief expected 16 / 88 nights; this export has these rows' },
    { tab: 'Revenue', measure: 'Non-cancelled nights', source: srcNights, plan: sumNights(plan.bookings) },
    { tab: 'Revenue', measure: '"Received" PKR approximation (267)', source: sum(srcReceivedPkr), plan: 0,
      note: c.receivedPayoutsForwarded ? '' : `Held by ${c.airbnbPayoutPartner} until forwarded: realized PKR is 0 until then` },
    { tab: 'Revenue', measure: '"Pending" PKR approximation', source: sum(srcPendingPkr), plan: '-', note: 'On the books; not realized' },
  )
  plan.corrections.push('Direct bookings without a ref now count (Master dropped them by counting Booking Ref) (issue 2).')
  plan.corrections.push('Nights are allocated to the month they fall in, so no month exceeds 100% occupancy (issue 4).')
  plan.corrections.push('Profit "to date" counts only realized money and completed stays, never future bookings (issue 5).')
  plan.corrections.push('USD stays keep USD; PKR is estimated at the default rate (267) and labelled "est." until the actual payout PKR is entered (issue 7).')

  // ------------------------------------------------------------------ Setup Costs
  const setup = readTable(sheet('Setup Costs'), 4, '#')
  let srcBudget = 0
  let srcActual = 0
  let setupCount = 0
  const seenItems = new Map<string, string>()
  for (const r of setup) {
    const n = String(r.num('#'))
    let item = r.str('Item')
    const actual = r.num('Actual Paid (PKR)')
    const budget = r.num('Budget (PKR)')
    if (!item && actual == null && budget == null) continue // empty numbered rows
    srcBudget += toCents(budget ?? 0)
    srcActual += toCents(actual ?? 0)
    setupCount += 1

    let category = r.str('Category')
    if (category === 'Misc.') category = 'Misc'
    const mapped = c.setupCategories[n]
    if (!category && mapped) {
      category = mapped
      plan.corrections.push(`Setup #${n} "${item}": no category in the sheet, set to ${mapped.replace('operating:', 'operating expense ')} (issue 8).`)
    }
    if (c.setupRenames[n]) {
      plan.corrections.push(`Setup #${n}: renamed "${item}" to "${c.setupRenames[n]}" (duplicate item name, issue 8).`)
      item = c.setupRenames[n]!
    }
    if (seenItems.has(item)) plan.issues.push({ level: 'review', text: `Setup #${n} "${item}" duplicates #${seenItems.get(item)}.` })
    seenItems.set(item, n)

    const operating = category.startsWith('operating:')
    const cat = operating ? category.slice('operating:'.length) : category
    if (!(operating ? OPERATING_CATEGORIES : SETUP_CATEGORIES).includes(cat)) {
      plan.issues.push({ level: 'blocking', text: `Setup #${n} "${item}": category "${category || '(blank)'}" is not valid.` })
      continue
    }
    const paidBy = r.str('Paid By')
    const partner = paidBy && paidBy !== 'Project Account' ? paidBy : null
    if (partner && !partnerNames.has(partner)) plan.issues.push({ level: 'blocking', text: `Setup #${n}: unknown payer "${paidBy}".` })
    const statusRaw = r.str('Status')
    const paid = actual != null && actual > 0
    let paidDate = r.date('Payment Date')
    if (paid && !paidDate) {
      paidDate = c.setupMissingPaidDate
      plan.corrections.push(`Setup #${n} "${item}": no payment date, set to ${paidDate} (flagged in notes).`)
    }
    if (!paid) {
      plan.issues.push({ level: 'info', text: `Setup #${n} "${item}": budget PKR ${(budget ?? 0).toLocaleString('en-US')}, nothing paid yet. Imported as an unpaid line (amount 0) so the budget still counts.` })
    }
    const vendor = r.str('Vendor') || null
    const vq = c.vendorQuotes.find((v) => vendor && v.matchVendor === vendor)
    plan.expenses.push({
      import_key: `setup:${n}`,
      kind: operating ? 'operating' : 'setup',
      category: cat,
      item,
      vendor,
      vendor_quote_key: vq ? `vq:${slug(vq.vendor)}` : null,
      budget_amount: operating ? null : budget,
      amount: actual ?? 0,
      status: paid && (!statusRaw || statusRaw === 'Paid') ? 'paid' : 'due',
      expense_date: paidDate ?? r.date('Buy Date') ?? c.setupMissingPaidDate,
      paid_date: paid ? paidDate : null,
      paid_by_partner: partner,
      reimbursable: false,
      reimbursed_date: null,
      notes: [r.str('Notes'), r.date('Payment Date') ? '' : 'Payment date estimated at import'].filter(Boolean).join(' · ') || null,
    })
    if (operating) {
      plan.corrections.push(`Setup #${n} "${item}" (${actual?.toLocaleString('en-US')}) moved to operating expenses as ${cat}: a loss, not capital (issue 10).`)
    }
  }
  for (const v of c.vendorQuotes) {
    plan.vendorQuotes.push({ import_key: `vq:${slug(v.vendor)}`, vendor: v.vendor, quoted_amount: v.amount })
    const paidToVendor = sum(plan.expenses.filter((e) => e.vendor === v.matchVendor).map((e) => Number(e.amount)))
    if (paidToVendor > v.amount) {
      plan.issues.push({
        level: 'review',
        text: `${v.vendor}: PKR ${paidToVendor.toLocaleString('en-US')} paid against a PKR ${v.amount.toLocaleString('en-US')} quote, PKR ${(paidToVendor - v.amount).toLocaleString('en-US')} over. Shown as a negative vendor balance for review (issue 9).`,
      })
    }
  }
  const setupPlanned = plan.expenses.filter((e) => String(e.import_key).startsWith('setup:'))
  plan.recon.push(
    { tab: 'Setup Costs', measure: 'Item rows', source: setupCount, plan: setupPlanned.length },
    { tab: 'Setup Costs', measure: 'Budget (PKR)', source: fromCents(srcBudget), plan: sum(setupPlanned.map((e) => e.budget_amount as number)),
      note: 'Difference = budget of rows moved to operating (operating expenses carry no budget)' },
    { tab: 'Setup Costs', measure: 'Actual paid (PKR)', source: fromCents(srcActual), plan: sum(setupPlanned.map((e) => e.amount as number)),
      note: `of which setup ${sum(setupPlanned.filter((e) => e.kind === 'setup').map((e) => e.amount as number)).toLocaleString('en-US')}, moved to operating ${sum(setupPlanned.filter((e) => e.kind === 'operating').map((e) => e.amount as number)).toLocaleString('en-US')}` },
  )

  // ------------------------------------------------------------------ Investment
  const inv = readTable(sheet('Investment'), 4, 'Date')
  const seenInv = new Map<string, number>()
  for (const r of inv) {
    const partner = r.str('Partner')
    const type = r.str('Type').toLowerCase()
    const amount = r.num('Amount (PKR)')
    const date = r.date('Date')
    if (!partner || !partnerNames.has(partner) || !date || !amount) {
      if (partner) plan.issues.push({ level: 'blocking', text: `Investment row ${r.row}: could not read partner/date/amount.` })
      continue
    }
    if (!['contribution', 'distribution'].includes(type)) {
      plan.issues.push({ level: 'blocking', text: `Investment row ${r.row}: unknown type "${r.str('Type')}".` })
      continue
    }
    const base = `inv:${date}:${slug(partner)}:${amount}`
    const k = (seenInv.get(base) ?? 0) + 1
    seenInv.set(base, k)
    plan.capital.push({
      import_key: `${base}:${k}`, movement_date: date, partner, type, amount,
      mode: r.str('Mode') || null, notes: r.str('Notes') || null,
    })
  }
  plan.recon.push(
    { tab: 'Investment', measure: 'Rows', source: inv.filter((r) => r.str('Partner')).length, plan: plan.capital.length },
    { tab: 'Investment', measure: 'Contributions (PKR)', source: sum(inv.map((r) => r.num('Amount (PKR)'))), plan: sum(plan.capital.map((m) => m.amount as number)) },
  )

  // ------------------------------------------------------------------ Operating Expenses
  const op = readTable(sheet('Operating Expenses'), 4, 'Date')
  const seenOp = new Map<string, number>()
  for (const r of op) {
    const date = r.date('Date')
    const amount = r.num('Amount (PKR)')
    const category = r.str('Category')
    if (!date || !amount) continue
    if (!OPERATING_CATEGORIES.includes(category)) {
      plan.issues.push({ level: 'blocking', text: `Operating row ${r.row}: unknown category "${category}".` })
      continue
    }
    const paidBy = r.str('Paid By')
    const partner = paidBy && paidBy !== 'Project Account' ? paidBy : null
    const desc = r.str('Description') || category
    const base = `opex:${date}:${slug(desc)}:${amount}`
    const k = (seenOp.get(base) ?? 0) + 1
    seenOp.set(base, k)
    plan.expenses.push({
      import_key: `${base}:${k}`, kind: 'operating', category, item: desc, vendor: null, vendor_quote_key: null,
      budget_amount: null, amount, status: 'paid', expense_date: date, paid_date: date, paid_by_partner: partner,
      reimbursable: !!partner, reimbursed_date: partner && /yes/i.test(r.str('Reimbursed?')) ? date : null,
      notes: r.str('Notes') || null,
    })
    if (!r.str('Description')) plan.corrections.push(`Operating ${date} ${category} ${amount}: no description, item set to "${category}".`)
  }
  const opPlanned = plan.expenses.filter((e) => String(e.import_key).startsWith('opex:'))
  plan.recon.push(
    { tab: 'Operating Expenses', measure: 'Rows', source: op.filter((r) => r.num('Amount (PKR)')).length, plan: opPlanned.length },
    { tab: 'Operating Expenses', measure: 'Total (PKR)', source: sum(op.map((r) => r.num('Amount (PKR)'))), plan: sum(opPlanned.map((e) => e.amount as number)) },
  )
  plan.corrections.push('Rent: the template accrues PKR 150,000 on the 1st from 1 Nov 2026; the setup "Advance rent" covered 21 Sep to 31 Oct, so nothing is back-filled (issue 6).')
  plan.issues.push({ level: 'info', text: 'Electricity, gas, water, internet and staff salary templates exist with no amount: fill them in Settings to start generating (issue 6).' })

  // ------------------------------------------------------------------ Tasks & Gantt (open items only)
  const tasks = readTable(sheet('Tasks & Gantt'), 5, 'Task')
  for (const r of tasks) {
    const st = r.str('Status')
    if (!st || st === 'Done') continue
    plan.tasks.push({
      import_key: `gantt:${r.num('#')}`,
      booking_key: null,
      title: r.str('Task'),
      due_date: r.date('End'),
      status: st === 'Blocked' ? 'blocked' : st === 'In Progress' ? 'doing' : 'todo',
      category: /hire|caretaker/i.test(r.str('Task')) ? 'admin' : 'purchase',
      assignee: r.str('Owner') || null,
      notes: [r.str('Notes'), r.str('Source Area') && `Where: ${r.str('Source Area')}`].filter(Boolean).join(' · ') || null,
    })
  }
  plan.recon.push({ tab: 'Tasks & Gantt', measure: 'Open tasks', source: tasks.filter((r) => r.str('Status') && r.str('Status') !== 'Done').length, plan: plan.tasks.filter((t) => String(t.import_key).startsWith('gantt:')).length })
  plan.recon.push({ tab: 'Revenue', measure: 'Tasks from booking notes', source: '-', plan: plan.tasks.filter((t) => String(t.import_key).startsWith('rev:')).length })

  return plan
}

function sumNights(bookings: Rec[]) {
  return bookings
    .filter((b) => !['cancelled', 'fraud'].includes(String(b.status)))
    .reduce((a, b) => a + nightsBetween(String(b.check_in), String(b.check_out)), 0)
}

/** Issue 13: action items hidden in booking notes become tasks linked to the booking. */
function tasksFromNotes(notes: string, checkIn: string) {
  const out: { title: string; due_date: string; status: string; category: string; assignee: null; notes: string }[] = []
  for (const part of notes.split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
    const followUp = part.match(/follow up on (\d{1,2})(?:st|nd|rd|th)? (\w+)/i)
    if (/airport pickup/i.test(part)) out.push({ title: 'Arrange airport pickup', due_date: checkIn, status: 'todo', category: 'guest_request', assignee: null, notes: part })
    else if (/matt?ress/i.test(part)) out.push({ title: 'Provide extra mattresses', due_date: checkIn, status: 'todo', category: 'guest_request', assignee: null, notes: part })
    else if (/show .*listing/i.test(part)) out.push({ title: "Show the guest's friend the listing", due_date: checkIn, status: 'todo', category: 'admin', assignee: null, notes: part })
    else if (followUp) {
      const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
      const m = months.indexOf(followUp[2]!.toLowerCase()) + 1
      const due = m > 0 ? `${checkIn.slice(0, 4)}-${String(m).padStart(2, '0')}-${followUp[1]!.padStart(2, '0')}` : checkIn
      out.push({ title: 'Follow up: does the guest rebook?', due_date: due, status: 'todo', category: 'admin', assignee: null, notes: part })
    }
  }
  return out
}

export function lit(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return `'${String(v).replace(/'/g, "''")}'`
}

export type { SheetRow }

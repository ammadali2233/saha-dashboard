// Nightly read-only copy of the main tables in a Google Sheet, so partners always have a spreadsheet.
// Auth: a Google service account (JSON key in GOOGLE_SERVICE_ACCOUNT_JSON); the sheet must be shared
// with the service account's email as Editor. Each tab is cleared and rewritten every night.
import { createSign } from 'node:crypto'

export type Cell = string | number | boolean | null
export type Tabs = Record<string, Cell[][]>

type Row = Record<string, unknown>
const n = (v: unknown) => (v == null || v === '' ? null : Number(v))
const s = (v: unknown) => (v == null ? '' : String(v))

/** Turn database rows into sheet tabs (header row + data rows). Pure: unit-tested. */
export function buildTabs(d: {
  bookings: Row[]
  payments: Row[]
  expenses: Row[]
  capital: Row[]
  partners: Row[]
  pnlAccrual: Row[]
  pnlCash: Row[]
  ledger: Row[]
  generatedAt: string
}): Tabs {
  return {
    'Read me': [
      ['DHA Retreat Ops: read-only copy'],
      [`Refreshed ${d.generatedAt} (Karachi). Overwritten every night; make changes in the app, not here.`],
      ['Amounts in PKR unless a Currency column says USD. "PKR est." uses the default rate until the payout is forwarded.'],
    ],
    Bookings: [
      ['Ref', 'Guest', 'Channel', 'Check-in', 'Check-out', 'Nights', 'Status', 'Type', 'Currency', 'Gross', 'Discounts', 'Platform fee', 'Net', 'Net PKR', 'PKR is estimate'],
      ...d.bookings.map((b) => [
        s(b.ref), s(b.guest_name), s(b.channel_name), s(b.check_in), s(b.check_out), n(b.nights), s(b.status), s(b.booking_type),
        s(b.currency), n(b.gross), n(b.discounts), n(b.platform_fee), n(b.net), n(b.net_pkr), b.pkr_is_estimate ? 'yes' : 'no',
      ]),
    ],
    Payments: [
      ['Booking', 'Guest', 'Kind', 'Currency', 'Amount due', 'Due', 'Status', 'Amount received', 'Received on', 'Held by', 'Rate', 'PKR received', 'Forwarded on', 'Realized on'],
      ...d.payments.map((p) => [
        s(p.ref), s(p.guest), s(p.kind), s(p.currency), n(p.amount_due), s(p.due_date), s(p.status), n(p.amount_received),
        s(p.received_date), s(p.held_by), n(p.fx_rate), n(p.pkr_received), s(p.forwarded_date), s(p.realized_date),
      ]),
    ],
    Expenses: [
      ['Date', 'Kind', 'Category', 'Item', 'Vendor', 'Amount', 'Budget', 'Status', 'Paid on', 'Paid by', 'Reimbursable', 'Reimbursed on'],
      ...d.expenses.map((e) => [
        s(e.expense_date), s(e.kind), s(e.category), s(e.item), s(e.vendor), n(e.amount), n(e.budget_amount), s(e.status),
        s(e.paid_date), s(e.paid_by) || 'Project account', e.reimbursable ? 'yes' : 'no', s(e.reimbursed_date),
      ]),
    ],
    Capital: [
      ['Date', 'Partner', 'Type', 'Amount', 'Mode', 'Notes'],
      ...d.capital.map((m) => [s(m.movement_date), s(m.partner), s(m.type), n(m.amount), s(m.mode), s(m.notes)]),
    ],
    Partners: [
      ['Partner', 'Agreed share %', 'Cash contributed', 'Setup paid personally', 'Total invested', 'Capital %', 'To match equal share', 'Profit share', 'Distributions', 'Undistributed', 'Owed for expenses'],
      ...d.partners.map((p) => [
        s(p.name), n(p.agreed_share_pct), n(p.cash_contributed), n(p.setup_paid_personally), n(p.total_invested),
        p.capital_pct == null ? null : Math.round(Number(p.capital_pct) * 1000) / 10, n(p.shortfall_to_equal), n(p.profit_share),
        n(p.distributions), n(p.undistributed), n(p.reimbursements_owed),
      ]),
    ],
    'P&L accrual': [
      ['Month', 'Nights', 'Stay revenue', 'Earned', 'On the books', 'Other revenue', 'Operating costs', 'Net', 'Includes estimates'],
      ...d.pnlAccrual.map((r) => [
        s(r.month).slice(0, 7), n(r.nights), n(r.stay_revenue_pkr), n(r.earned_revenue_pkr), n(r.booked_revenue_pkr),
        n(r.other_revenue_pkr), n(r.operating_expenses_pkr), n(r.net_profit_pkr), r.has_estimates ? 'yes' : 'no',
      ]),
    ],
    'P&L cash': [
      ['Month', 'Realized revenue', 'Paid operating costs', 'Net'],
      ...d.pnlCash.map((r) => [s(r.month).slice(0, 7), n(r.realized_revenue_pkr), n(r.paid_operating_pkr), n(r.net_profit_pkr)]),
    ],
    'Project account': [
      ['Date', 'Kind', 'Description', 'Amount', 'Balance'],
      ...d.ledger.map((l) => [s(l.entry_date), s(l.kind), s(l.description), n(l.amount), n(l.balance)]),
    ],
  }
}

// ---------------------------------------------------------------- Google API (REST, no SDK)
interface ServiceAccount {
  client_email: string
  private_key: string
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

/** OAuth access token for the service account (JWT bearer grant). */
export async function googleToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }),
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  const jwt = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  return ((await res.json()) as { access_token: string }).access_token
}

/** Make sure every tab exists, clear them, and write the new values. */
export async function writeTabs(sheetId: string, tabs: Tabs, token: string) {
  const api = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`
  const call = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(
        res.status === 403 || res.status === 404
          ? `Google Sheet not reachable (${res.status}): share it with the service account email as Editor, and check GOOGLE_MIRROR_SHEET_ID.`
          : `Google Sheets error ${res.status}: ${text.slice(0, 200)}`,
      )
    }
    return res.json() as Promise<Record<string, unknown>>
  }
  const meta = (await call(`${api}?fields=sheets.properties.title`)) as { sheets?: { properties: { title: string } }[] }
  const have = new Set((meta.sheets ?? []).map((x) => x.properties.title))
  const missing = Object.keys(tabs).filter((t) => !have.has(t))
  if (missing.length) {
    await call(`${api}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
    })
  }
  const quote = (t: string) => `'${t.replace(/'/g, "''")}'`
  await call(`${api}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: Object.keys(tabs).map(quote) }) })
  await call(`${api}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: Object.entries(tabs).map(([t, values]) => ({ range: `${quote(t)}!A1`, values })),
    }),
  })
}

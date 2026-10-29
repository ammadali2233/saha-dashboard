import { generateKeyPairSync, createVerify } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { filesToPrune } from './backup'
import { buildTabs, googleToken } from './sheet-mirror'

describe('backup retention', () => {
  it('keeps 30 days and ignores files that are not snapshots', () => {
    const names = ['2026-09-29.json', '2026-09-30.json', '2026-10-29.json', 'notes.txt']
    expect(filesToPrune(names, '2026-10-30', 30)).toEqual(['2026-09-29.json'])
  })
})

describe('sheet mirror tabs', () => {
  const tabs = buildTabs({
    bookings: [{ ref: 'HMTEST0001', guest_name: 'Guest', channel_name: 'Airbnb', check_in: '2026-11-01', check_out: '2026-11-03', nights: 2, status: 'confirmed', booking_type: 'standard', currency: 'USD', gross: '100.00', discounts: '0', platform_fee: '-15.50', net: '84.50', net_pkr: '22561.50', pkr_is_estimate: true }],
    payments: [],
    expenses: [{ expense_date: '2026-11-01', kind: 'operating', category: 'Rent', item: 'Rent Nov', amount: '150000.00', status: 'due', paid_by: '' }],
    capital: [],
    partners: [{ name: 'Ammad Ali', agreed_share_pct: '25', capital_pct: '0.253088', total_invested: '750000' }],
    pnlAccrual: [{ month: '2026-12-01', nights: 27, stay_revenue_pkr: '100', has_estimates: true }],
    pnlCash: [],
    ledger: [],
    generatedAt: '30 Oct 2026, 01:15',
  })

  it('has a header row per tab and numbers as numbers', () => {
    expect(tabs.Bookings![0]![0]).toBe('Ref')
    expect(tabs.Bookings![1]).toContain(22561.5)
    expect(tabs.Bookings![1]![14]).toBe('yes')
  })
  it('labels the project account and rounds capital % for reading', () => {
    expect(tabs.Expenses![1]![9]).toBe('Project account')
    expect(tabs.Partners![1]![5]).toBe(25.3)
    expect(tabs['P&L accrual']![1]![0]).toBe('2026-12')
  })
  it('says it is a read-only copy', () => {
    expect(String(tabs['Read me']![1]![0])).toContain('Overwritten every night')
  })
})

describe('Google service-account sign-in', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('sends a correctly signed RS256 JWT', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    let assertion = ''
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      assertion = new URLSearchParams(String(init.body)).get('assertion')!
      return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
    })
    const token = await googleToken({ client_email: 'mirror@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() })
    expect(token).toBe('tok')
    const [h, c, sig] = assertion.split('.')
    const v = createVerify('RSA-SHA256')
    v.update(`${h}.${c}`)
    expect(v.verify(publicKey, Buffer.from(sig!, 'base64url'))).toBe(true)
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toMatchObject({
      iss: 'mirror@test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/spreadsheets',
    })
  })
})

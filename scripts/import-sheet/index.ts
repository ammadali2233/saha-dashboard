/**
 * One-off import of the Google Sheet export into the database.
 *
 *   npx tsx scripts/import-sheet/index.ts                    dry run against local Supabase
 *   npx tsx scripts/import-sheet/index.ts --target linked    dry run against the hosted project
 *   npx tsx scripts/import-sheet/index.ts --target linked --apply
 *
 * Reads import/*.xlsx and import/corrections.json (created with proposals on first run).
 * Writes import/reports/<target>-<timestamp>.md and the SQL it would run. Idempotent: every row
 * carries an import_key, re-runs update in place, and rows that left the sheet are soft-deleted.
 * --apply refuses while any blocking issue is open.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openWorkbook } from './workbook'
import { buildPlan, lit, type Corrections, type Plan } from './plan'
import { pkToday, formatMoney } from '../../src/domain/format'
import { bookingTotals, stayNights, nightsBetween } from '../../src/domain/booking'
import { partnerSummaries, realizedNetProfit, type Expense } from '../../src/domain/partners'
import { projectLedger, ledgerBalance } from '../../src/domain/ledger'
import { realizedRevenuePkr, type Payment } from '../../src/domain/payments'

const IMPORT_DIR = path.resolve('import')
const args = process.argv.slice(2)
const target = (args[args.indexOf('--target') + 1] && args.includes('--target') ? args[args.indexOf('--target') + 1] : 'local') as
  | 'local'
  | 'linked'
const apply = args.includes('--apply')
if (!['local', 'linked'].includes(target)) throw new Error('--target must be local or linked')

// The decisions themselves (guest names, booking refs, quote lines) contain guest data, so they live
// only in the gitignored import/corrections.json. This skeleton just shows the shape.
const CORRECTIONS_SKELETON: Corrections = {
  airbnbPayoutPartner: '',
  receivedPayoutsForwarded: false,
  advanceDates: {},
  setupCategories: {},
  setupRenames: {},
  setupMissingPaidDate: '',
  partnerFriendsRefs: [],
  extraChargeDates: {},
  vendorQuotes: [],
  directQuotes: {},
}

function loadCorrections(): Corrections {
  const file = args.includes('--corrections') ? path.resolve(args[args.indexOf('--corrections') + 1]!) : path.join(IMPORT_DIR, 'corrections.json')
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(CORRECTIONS_SKELETON, null, 2) + '\n')
    throw new Error(`Fill in ${file} (a blank skeleton was written) and run again.`)
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Corrections
}

/** Run SQL via the Supabase CLI (local Docker or the linked project). SQL goes through a file, not the shell. */
function query<T = Record<string, unknown>>(sql: string): T[] {
  const file = path.join(os.tmpdir(), `import-query-${process.pid}.sql`)
  fs.writeFileSync(file, sql)
  const out = execFileSync('npx', ['supabase', 'db', 'query', `--${target}`, '--output-format', 'json', '-f', `"${file}"`], {
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
  })
  const json = JSON.parse(out.slice(out.indexOf('{')))
  return (json.rows ?? []) as T[]
}

// ------------------------------------------------------------------ SQL
const IMPORTED = {
  bookings: "import_key like 'rev:%'",
  booking_lines: "import_key like 'rev:%'",
  payments: "import_key like 'rev:%'",
  tasks: "(import_key like 'rev:%' or import_key like 'gantt:%')",
  expenses: "(import_key like 'setup:%' or import_key like 'opex:%')",
  capital_movements: "import_key like 'inv:%'",
  guests: "import_key like 'guest:%'",
  vendor_quotes: "import_key like 'vq:%'",
} as const

function toSql(plan: Plan): string {
  // one DO block = one statement for the CLI, and one all-or-nothing transaction
  const s: string[] = ['do $import$', 'begin']
  const id = (table: string, key: unknown) => (key == null ? 'null' : `(select id from public.${table} where import_key = ${lit(key)})`)
  const partner = (name: unknown) => (name == null ? 'null' : `(select id from public.partners where name = ${lit(name)})`)

  for (const g of plan.guests) {
    s.push(`insert into public.guests (import_key, name, source) values (${lit(g.import_key)}, ${lit(g.name)}, ${lit(g.source)})
  on conflict (import_key) do update set name = excluded.name, source = excluded.source, deleted_at = null;`)
  }
  for (const v of plan.vendorQuotes) {
    s.push(`insert into public.vendor_quotes (import_key, vendor, quoted_amount) values (${lit(v.import_key)}, ${lit(v.vendor)}, ${lit(v.quoted_amount)})
  on conflict (import_key) do update set vendor = excluded.vendor, quoted_amount = excluded.quoted_amount, deleted_at = null;`)
  }
  for (const b of plan.bookings) {
    const ref =
      b.ref != null
        ? lit(b.ref)
        : b.channel_code === 'direct'
          ? `coalesce((select ref from public.bookings where import_key = ${lit(b.import_key)}), public.next_doc_number('D', ${String(b.check_in).slice(0, 4)}))`
          : 'null'
    s.push(`insert into public.bookings (import_key, ref, channel_id, guest_id, check_in, check_out, guest_count, booking_type, status, source, needs_details, notes)
  values (${lit(b.import_key)}, ${ref}, (select id from public.channels where code = ${lit(b.channel_code)}), ${id('guests', b.guest_key)},
          ${lit(b.check_in)}, ${lit(b.check_out)}, ${lit(b.guest_count)}, ${lit(b.booking_type)}, ${lit(b.status)}, 'import', false, ${lit(b.notes)})
  on conflict (import_key) do update set ref = excluded.ref, channel_id = excluded.channel_id, guest_id = excluded.guest_id,
    check_in = excluded.check_in, check_out = excluded.check_out, guest_count = excluded.guest_count,
    booking_type = excluded.booking_type, status = excluded.status, notes = excluded.notes, deleted_at = null;`)
  }
  for (const l of plan.lines) {
    s.push(`insert into public.booking_lines (import_key, booking_id, kind, discount_subtype, label, qty, unit_amount, amount, currency, sort_order)
  values (${lit(l.import_key)}, ${id('bookings', l.booking_key)}, ${lit(l.kind)}, ${lit(l.discount_subtype)}, ${lit(l.label)}, ${lit(l.qty)},
          ${lit(l.unit_amount)}, ${lit(l.amount)}, ${lit(l.currency)}, ${lit(l.sort_order)})
  on conflict (import_key) do update set kind = excluded.kind, discount_subtype = excluded.discount_subtype, label = excluded.label,
    qty = excluded.qty, unit_amount = excluded.unit_amount, amount = excluded.amount, currency = excluded.currency,
    sort_order = excluded.sort_order, deleted_at = null;`)
  }
  for (const p of plan.payments) {
    s.push(`insert into public.payments (import_key, booking_id, kind, currency, amount_due, due_date, status, amount_received, received_date,
    received_by_partner_id, method, notes)
  values (${lit(p.import_key)}, ${id('bookings', p.booking_key)}, ${lit(p.kind)}, ${lit(p.currency)}, ${lit(p.amount_due)}, ${lit(p.due_date)},
          ${lit(p.status)}, ${lit(p.amount_received)}, ${lit(p.received_date)}, ${partner(p.received_by_partner)}, ${lit(p.method)}, ${lit(p.notes)})
  on conflict (import_key) do update set kind = excluded.kind, currency = excluded.currency, amount_due = excluded.amount_due,
    due_date = excluded.due_date, status = excluded.status, amount_received = excluded.amount_received,
    received_date = excluded.received_date, received_by_partner_id = excluded.received_by_partner_id,
    method = excluded.method, notes = excluded.notes, deleted_at = null;`)
  }
  for (const e of plan.expenses) {
    s.push(`insert into public.expenses (import_key, kind, category, item, vendor, vendor_quote_id, budget_amount, amount, currency, status,
    expense_date, paid_date, paid_by_partner_id, reimbursable, reimbursed_date, notes)
  values (${lit(e.import_key)}, ${lit(e.kind)}, ${lit(e.category)}, ${lit(e.item)}, ${lit(e.vendor)}, ${id('vendor_quotes', e.vendor_quote_key)},
          ${lit(e.budget_amount)}, ${lit(e.amount)}, 'PKR', ${lit(e.status)}, ${lit(e.expense_date)}, ${lit(e.paid_date)},
          ${partner(e.paid_by_partner)}, ${lit(e.reimbursable)}, ${lit(e.reimbursed_date)}, ${lit(e.notes)})
  on conflict (import_key) do update set kind = excluded.kind, category = excluded.category, item = excluded.item, vendor = excluded.vendor,
    vendor_quote_id = excluded.vendor_quote_id, budget_amount = excluded.budget_amount, amount = excluded.amount,
    status = excluded.status, expense_date = excluded.expense_date, paid_date = excluded.paid_date,
    paid_by_partner_id = excluded.paid_by_partner_id, reimbursable = excluded.reimbursable,
    reimbursed_date = excluded.reimbursed_date, notes = excluded.notes, deleted_at = null;`)
  }
  for (const m of plan.capital) {
    s.push(`insert into public.capital_movements (import_key, movement_date, partner_id, type, amount, mode, notes)
  values (${lit(m.import_key)}, ${lit(m.movement_date)}, ${partner(m.partner)}, ${lit(m.type)}, ${lit(m.amount)}, ${lit(m.mode)}, ${lit(m.notes)})
  on conflict (import_key) do update set movement_date = excluded.movement_date, partner_id = excluded.partner_id, type = excluded.type,
    amount = excluded.amount, mode = excluded.mode, notes = excluded.notes, deleted_at = null;`)
  }
  for (const t of plan.tasks) {
    s.push(`insert into public.tasks (import_key, title, booking_id, due_date, status, category, assignee_id, notes)
  values (${lit(t.import_key)}, ${lit(t.title)}, ${id('bookings', t.booking_key)}, ${lit(t.due_date)}, ${lit(t.status)}, ${lit(t.category)},
          ${t.assignee ? `(select id from public.app_users where display_name = ${lit(t.assignee)})` : 'null'}, ${lit(t.notes)})
  on conflict (import_key) do update set title = excluded.title, booking_id = excluded.booking_id, due_date = excluded.due_date,
    category = excluded.category, assignee_id = excluded.assignee_id, notes = excluded.notes, deleted_at = null;`)
  }

  // rows imported earlier that are no longer in the sheet
  const keys: Record<keyof typeof IMPORTED, unknown[]> = {
    bookings: plan.bookings.map((x) => x.import_key),
    booking_lines: plan.lines.map((x) => x.import_key),
    payments: plan.payments.map((x) => x.import_key),
    tasks: plan.tasks.map((x) => x.import_key),
    expenses: plan.expenses.map((x) => x.import_key),
    capital_movements: plan.capital.map((x) => x.import_key),
    guests: plan.guests.map((x) => x.import_key),
    vendor_quotes: plan.vendorQuotes.map((x) => x.import_key),
  }
  for (const [table, where] of Object.entries(IMPORTED)) {
    const list = keys[table as keyof typeof IMPORTED]
    const notIn = list.length ? ` and import_key not in (${list.map(lit).join(', ')})` : ''
    s.push(`update public.${table} set deleted_at = now() where deleted_at is null and ${where}${notIn};`)
  }
  s.push('end', '$import$;')
  return s.join('\n') + '\n'
}

// ------------------------------------------------------------------ what the plan implies (computed with src/domain)
function projections(plan: Plan, today: string) {
  const active = plan.bookings.filter((b) => ['confirmed', 'in_house', 'completed'].includes(String(b.status)))
  const nightsByMonth = new Map<string, number>()
  for (const b of active) for (const d of stayNights(String(b.check_in), String(b.check_out))) nightsByMonth.set(d.slice(0, 7), (nightsByMonth.get(d.slice(0, 7)) ?? 0) + 1)

  const payments: Payment[] = plan.payments.map((p) => ({
    kind: p.kind as Payment['kind'],
    status: p.status as Payment['status'],
    currency: p.currency as Payment['currency'],
    amount_received: p.amount_received as number | null,
    received_date: p.received_date as string | null,
    received_by_partner_id: (p.received_by_partner as string | null) ?? null,
    pkr_received: null,
    forwarded_date: null,
  }))
  const expenses: Expense[] = plan.expenses.map((e) => ({
    kind: e.kind as Expense['kind'],
    amountPkr: Number(e.amount),
    status: e.status as Expense['status'],
    paidDate: (e.paid_date as string | null) ?? null,
    paidByPartnerId: (e.paid_by_partner as string | null) ?? null,
    reimbursable: !!e.reimbursable,
    reimbursedDate: (e.reimbursed_date as string | null) ?? null,
  }))
  const movements = plan.capital.map((m) => ({ partnerId: String(m.partner), type: m.type as 'contribution', amountPkr: Number(m.amount), date: String(m.movement_date) }))
  const realized = payments.reduce((a, p) => a + realizedRevenuePkr(p), 0)
  const profit = realizedNetProfit(realized, expenses)
  const partners = partnerSummaries(
    ['Ammad Ali', 'Hamza Mahad Dar', 'Mohammed Azeem', 'Saad Raza'].map((n) => ({ id: n, name: n, agreedSharePct: 25 })),
    movements,
    expenses,
    profit,
  )
  const ledger = projectLedger(movements, payments, expenses)
  const completedNights = active.filter((b) => String(b.check_out) <= today).reduce((a, b) => a + nightsBetween(String(b.check_in), String(b.check_out)), 0)
  const FEE: Record<string, number> = { airbnb: 15.5, booking_com: 15, direct: 0, other: 0 }
  const bookingRows = plan.bookings.map((b) => {
    const t = bookingTotals(
      plan.lines.filter((l) => l.booking_key === b.import_key).map((l) => ({ kind: l.kind as never, amount: Number(l.amount) })),
      FEE[String(b.channel_code)] ?? 0,
    )
    const cur = String(plan.lines.find((l) => l.booking_key === b.import_key)?.currency ?? 'PKR') as 'PKR' | 'USD'
    const estPkr = cur === 'USD' ? Math.round(t.net * 267 * 100) / 100 : t.net
    return { b, net: t.net, cur, estPkr }
  })
  const earnedEst = bookingRows.filter((r) => r.b.status === 'completed').reduce((a, r) => a + r.estPkr, 0)
    + plan.payments.filter((p) => p.kind === 'extra_charge' && bookingRows.some((r) => r.b.import_key === p.booking_key && r.b.status === 'completed')).reduce((x, p) => x + Number(p.amount_received ?? 0), 0)
  return { nightsByMonth, realized, profit, partners, balance: ledgerBalance(ledger), completedNights, bookingRows, earnedEst }
}

// ------------------------------------------------------------------ main
async function main() {
  const today = pkToday()
  const xlsx = fs.readdirSync(IMPORT_DIR).find((f) => f.toLowerCase().endsWith('.xlsx'))
  if (!xlsx) throw new Error(`No .xlsx file in ${IMPORT_DIR}`)
  const corrections = loadCorrections()
  const { sheet } = await openWorkbook(path.join(IMPORT_DIR, xlsx))
  const plan = buildPlan(sheet, corrections, today)
  const proj = projections(plan, today)
  const blocking = plan.issues.filter((i) => i.level === 'blocking')

  // diff against the target
  const existing = new Set(
    query<{ k: string }>(
      Object.entries(IMPORTED)
        .map(([t, w]) => `select '${t}:' || import_key as k from public.${t} where deleted_at is null and ${w}`)
        .join(' union all '),
    ).map((r) => r.k),
  )
  const counts = (table: keyof typeof IMPORTED, rows: { import_key: unknown }[]) => {
    const planned = new Set(rows.map((r) => `${table}:${r.import_key}`))
    const create = [...planned].filter((k) => !existing.has(k)).length
    const update = planned.size - create
    const remove = [...existing].filter((k) => k.startsWith(`${table}:`) && !planned.has(k)).length
    return { create, update, remove }
  }
  const diff = {
    guests: counts('guests', plan.guests as { import_key: unknown }[]),
    bookings: counts('bookings', plan.bookings as { import_key: unknown }[]),
    booking_lines: counts('booking_lines', plan.lines as { import_key: unknown }[]),
    payments: counts('payments', plan.payments as { import_key: unknown }[]),
    expenses: counts('expenses', plan.expenses as { import_key: unknown }[]),
    capital_movements: counts('capital_movements', plan.capital as { import_key: unknown }[]),
    tasks: counts('tasks', plan.tasks as { import_key: unknown }[]),
    vendor_quotes: counts('vendor_quotes', plan.vendorQuotes as { import_key: unknown }[]),
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const reportsDir = path.join(IMPORT_DIR, 'reports')
  fs.mkdirSync(reportsDir, { recursive: true })
  const sqlFile = path.join(reportsDir, `${target}-${stamp}.sql`)
  fs.writeFileSync(sqlFile, toSql(plan))

  let after = ''
  if (apply) {
    if (blocking.length) {
      console.error(`Refusing to apply: ${blocking.length} blocking issue(s). See the report.`)
    } else {
      execFileSync('npx', ['supabase', 'db', 'query', `--${target}`, '-f', `"${sqlFile}"`], { stdio: 'inherit', shell: true })
      after = afterReport(proj)
    }
  }

  const pkr = (n: number) => formatMoney(n, 'PKR')
  const fmt = (v: number | string) => (typeof v === 'number' ? v.toLocaleString('en-US') : v)
  const md: string[] = [
    `# Sheet import: ${apply && !blocking.length ? 'APPLIED' : 'dry run'} (${target})`,
    '',
    `Source: \`${xlsx}\` · Run: ${new Date().toISOString()} · Karachi date: ${today}`,
    '',
    blocking.length
      ? `**${blocking.length} blocking item(s) must be resolved before --apply.**`
      : 'No blocking items: ready to apply.',
    '',
    '## Reconciliation: sheet vs import',
    '',
    '| Tab | Measure | Sheet | Import | Note |',
    '|---|---|---:|---:|---|',
    ...plan.recon.map((r) => `| ${r.tab} | ${r.measure} | ${fmt(r.source)} | ${fmt(r.plan)} | ${r.note ?? (r.source === r.plan ? 'matches' : '')} |`),
    '',
    '## What the database will show',
    '',
    `- Nights by month (confirmed, in-house, completed): ${[...proj.nightsByMonth.entries()].sort().map(([m, n]) => `${m}: ${n}`).join(', ')}`,
    `- Completed-stay nights to date: ${proj.completedNights}`,
    `- Earned (completed stays incl. extra charges, USD at the 267 estimate): ${pkr(proj.earnedEst)} (brief: about 81,000)`,
    `- Realized revenue (PKR in the project account): ${pkr(proj.realized)}`,
    `- Realized net profit to date: ${pkr(proj.profit)}`,
    `- Project account balance: ${pkr(proj.balance)} (sheet: -26,803 excluding revenue, issue 12)`,
    '',
    '| Partner | Cash | Setup paid | Invested | Capital % | To equal share | Profit share (25%) |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...proj.partners.map(
      (p) =>
        `| ${p.name} | ${fmt(p.cashContributed)} | ${fmt(p.setupPaidPersonally)} | ${fmt(p.totalInvested)} | ${(p.capitalPct * 100).toFixed(1)}% | ${fmt(p.shortfallToEqual)} | ${fmt(p.profitShare)} |`,
    ),
    '',
    '## Bookings as they will be imported',
    '',
    '| Guest | Channel | Dates | Nights | Status | Type | Net | PKR (est. for USD) |',
    '|---|---|---|---:|---|---|---:|---:|',
    ...proj.bookingRows.map(({ b, net, cur, estPkr }) =>
      `| ${b.guest_key ? String(plan.guests.find((g) => g.import_key === b.guest_key)?.name) : '-'} | ${b.channel_code} | ${b.check_in} to ${b.check_out} | ${nightsBetween(String(b.check_in), String(b.check_out))} | ${b.status} | ${b.booking_type} | ${formatMoney(net, cur)} | ${pkr(estPkr)} |`,
    ),
    '',
    '## Changes in the target database',
    '',
    '| Table | Create | Update | Soft-delete (no longer in sheet) |',
    '|---|---:|---:|---:|',
    ...Object.entries(diff).map(([t, d]) => `| ${t} | ${d.create} | ${d.update} | ${d.remove} |`),
    '',
    '## Deliberate corrections',
    '',
    ...plan.corrections.map((c) => `- ${c}`),
    '',
    '## Open items',
    '',
    ...(['blocking', 'review', 'info'] as const).flatMap((lvl) => {
      const xs = plan.issues.filter((i) => i.level === lvl)
      return xs.length ? [`### ${lvl}`, '', ...xs.map((i) => `- ${i.text}`), ''] : []
    }),
    after,
    `SQL: \`${path.relative(process.cwd(), sqlFile)}\``,
  ]
  const reportFile = path.join(reportsDir, `${target}-${stamp}.md`)
  fs.writeFileSync(reportFile, md.join('\n'))
  console.log(`Report: ${reportFile}`)
  console.log(`Blocking: ${blocking.length} · review: ${plan.issues.filter((i) => i.level === 'review').length}`)
  if (apply && blocking.length) process.exitCode = 1
}

function afterReport(proj: ReturnType<typeof projections>) {
  const [b] = query<Record<string, string>>(`
    select
      (select count(*) from public.bookings where deleted_at is null and import_key like 'rev:%') as bookings,
      (select coalesce(sum(nights), 0) from public.bookings where deleted_at is null and import_key like 'rev:%'
         and status in ('confirmed', 'in_house', 'completed')) as nights,
      (select coalesce(sum(amount), 0) from public.expenses where deleted_at is null and kind = 'setup') as setup_actual,
      (select coalesce(sum(budget_amount), 0) from public.expenses where deleted_at is null and kind = 'setup') as setup_budget,
      (select coalesce(sum(amount), 0) from public.expenses where deleted_at is null and kind = 'operating') as operating,
      (select coalesce(sum(amount), 0) from public.capital_movements where deleted_at is null and type = 'contribution') as contributions,
      (select coalesce(sum(revenue_sign * realized_pkr), 0) from public.payment_facts where realized_date is not null) as realized,
      (select balance from public.project_account_ledger order by entry_date desc, source_table desc, source_id desc limit 1) as balance,
      (select count(*) from public.nightly_allocation where month = '2026-12-01') as dec_nights,
      (select count(*) from public.nightly_allocation where month = '2027-01-01') as jan_nights`)
  const pkr = (v: unknown) => formatMoney(Number(v ?? 0), 'PKR')
  return [
    '## After apply: read back from the database',
    '',
    `- Bookings: ${b?.bookings}, active nights: ${b?.nights}`,
    `- December nights ${b?.dec_nights} / January ${b?.jan_nights} (plan: ${proj.nightsByMonth.get('2026-12') ?? 0} / ${proj.nightsByMonth.get('2027-01') ?? 0})`,
    `- Setup actual ${pkr(b?.setup_actual)}, budget ${pkr(b?.setup_budget)}; operating ${pkr(b?.operating)}; contributions ${pkr(b?.contributions)}`,
    `- Realized revenue ${pkr(b?.realized)} (plan ${pkr(proj.realized)}); project account ${pkr(b?.balance)} (plan ${pkr(proj.balance)})`,
    '',
  ].join('\n')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})

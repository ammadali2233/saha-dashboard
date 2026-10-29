/**
 * Restore a nightly JSON backup (Storage bucket "backups", file YYYY-MM-DD.json).
 *
 *   npx tsx scripts/restore-backup.ts --file 2026-10-30.json                     dry run against local
 *   npx tsx scripts/restore-backup.ts --file 2026-10-30.json --target linked     dry run against live
 *   npx tsx scripts/restore-backup.ts --file 2026-10-30.json --target linked --apply
 *
 * Every row in the snapshot is put back exactly (inserted if missing, overwritten if changed), in one
 * transaction. Rows created after the snapshot are left alone: nothing is deleted. Our triggers (audit,
 * auto-tasks, overlap guards) are paused during the restore; foreign-key checks stay on.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BACKUP_TABLES, type Snapshot } from '../netlify/lib/backup'

const args = process.argv.slice(2)
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const file = arg('--file')
const target = (arg('--target') ?? 'local') as 'local' | 'linked'
const apply = args.includes('--apply')
if (!file) throw new Error('Pass --file <snapshot.json> (download it from Settings → Backups)')
if (!['local', 'linked'].includes(target)) throw new Error('--target must be local or linked')

function query<T = Record<string, unknown>>(sql: string): T[] {
  const tmp = path.join(os.tmpdir(), `restore-${process.pid}.sql`)
  fs.writeFileSync(tmp, sql)
  const out = execFileSync('npx', ['supabase', 'db', 'query', `--${target}`, '--output-format', 'json', '-f', `"${tmp}"`], {
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 200 * 1024 * 1024,
  })
  return (JSON.parse(out.slice(out.indexOf('{'))).rows ?? []) as T[]
}

const snap = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as Snapshot
if (snap.version !== 1) throw new Error('Unknown backup format')

// writable columns per table (generated columns such as bookings.nights are skipped)
const cols = new Map<string, string[]>()
for (const r of query<{ table_name: string; column_name: string }>(
  `select table_name, column_name from information_schema.columns
   where table_schema = 'public' and is_generated = 'NEVER' and table_name in (${BACKUP_TABLES.map((t) => `'${t}'`).join(',')})
   order by table_name, ordinal_position`,
)) {
  cols.set(r.table_name, [...(cols.get(r.table_name) ?? []), r.column_name])
}

const existing = new Map<string, number>()
for (const t of BACKUP_TABLES) {
  existing.set(t, Number(query<{ n: string }>(`select count(*) as n from public.${t}`)[0]?.n ?? 0))
}

console.log(`Snapshot ${path.basename(file)} taken ${snap.created_at} → ${target}${apply ? ' (APPLY)' : ' (dry run)'}`)
console.log('table'.padEnd(20), 'in backup'.padStart(10), 'in database'.padStart(12))
for (const t of BACKUP_TABLES) console.log(t.padEnd(20), String(snap.tables[t]?.length ?? 0).padStart(10), String(existing.get(t)).padStart(12))

if (!apply) {
  console.log('\nDry run only. Add --apply to restore these rows.')
  process.exit(0)
}

const tag = '$rs$'
// pause our triggers (audit, row meta, auto-tasks, overlap guards); foreign-key checks stay on
const sql: string[] = ['do $restore$', 'begin', ...BACKUP_TABLES.map((t) => `alter table public.${t} disable trigger user;`)]

// A fresh project's setup migrations seed settings, channels, partners, logins and bill templates
// with their own ids. Remove those seeded twins (same natural key, different id) so the backup's
// rows, with their original ids, can go back in. In the original database ids match: no-op.
const ids = (t: string) => JSON.stringify((snap.tables[t] ?? []).map((r) => r.id))
const twin = (t: string, keyExpr: string) =>
  `delete from public.${t} where id not in (select (jsonb_array_elements_text(${tag}${ids(t)}${tag}::jsonb))::uuid)
     and ${keyExpr} in (select ${keyExpr.replace(/\b(\w+)\b/g, "x->>'$1'")} from jsonb_array_elements(${tag}${JSON.stringify(snap.tables[t] ?? [])}${tag}::jsonb) x);`
sql.push(
  twin('partners', 'name'),
  `delete from public.recurring_expenses r where r.id not in (select (jsonb_array_elements_text(${tag}${ids('recurring_expenses')}${tag}::jsonb))::uuid)
     and not exists (select 1 from public.expenses e where e.recurring_template_id = r.id)
     and (r.category || '|' || r.item) in (select x->>'category' || '|' || (x->>'item') from jsonb_array_elements(${tag}${JSON.stringify(snap.tables.recurring_expenses ?? [])}${tag}::jsonb) x);`,
  twin('app_users', 'email'),
  twin('channels', 'code'),
  `delete from public.channel_secrets where channel_id not in (select id from public.channels);`,
  (snap.tables.settings?.length ?? 0) > 0
    ? `delete from public.settings where id not in (select (jsonb_array_elements_text(${tag}${ids('settings')}${tag}::jsonb))::uuid);`
    : '',
)
for (const t of BACKUP_TABLES) {
  const rows = (snap.tables[t] ?? []).map((r) => (t === 'inquiries' ? { ...r, quote_id: null } : r))
  if (!rows.length) continue
  const c = cols.get(t)
  if (!c) throw new Error(`Table ${t} not found in the target database`)
  const json = JSON.stringify(rows)
  if (json.includes(tag)) throw new Error(`Backup data contains ${tag}; cannot quote it safely`)
  const key = t === 'doc_counters' ? '(prefix, year)' : '(id)'
  const updates = c.filter((x) => !(t === 'doc_counters' ? ['prefix', 'year'] : ['id']).includes(x))
  sql.push(
    `insert into public.${t} (${c.join(', ')}) select ${c.join(', ')} from jsonb_populate_recordset(null::public.${t}, ${tag}${json}${tag}::jsonb)
  on conflict ${key} do update set ${updates.map((x) => `${x} = excluded.${x}`).join(', ')};`,
  )
}
// inquiries and quotes point at each other: link them once both exist
const links = (snap.tables.inquiries ?? []).filter((r) => r.quote_id).map((r) => ({ id: r.id, quote_id: r.quote_id }))
if (links.length) {
  sql.push(
    `update public.inquiries i set quote_id = x.quote_id from jsonb_to_recordset(${tag}${JSON.stringify(links)}${tag}::jsonb) as x(id uuid, quote_id uuid) where i.id = x.id;`,
  )
}
sql.push(...BACKUP_TABLES.map((t) => `alter table public.${t} enable trigger user;`), 'end', '$restore$;')

const tmp = path.join(os.tmpdir(), `restore-apply-${process.pid}.sql`)
fs.writeFileSync(tmp, sql.join('\n'))
execFileSync('npx', ['supabase', 'db', 'query', `--${target}`, '-f', `"${tmp}"`], { stdio: 'inherit', shell: true })

console.log('\nRestored. Rows now in the database:')
for (const t of BACKUP_TABLES) {
  const n = Number(query<{ n: string }>(`select count(*) as n from public.${t}`)[0]?.n ?? 0)
  console.log(t.padEnd(20), String(n).padStart(12), n >= (snap.tables[t]?.length ?? 0) ? '' : '  ← fewer than the backup!')
}

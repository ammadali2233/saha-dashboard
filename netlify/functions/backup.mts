// Nightly backup at 01:00 Karachi (20:00 UTC): JSON snapshot to Storage, 30 days kept, logged.
import type { Config } from '@netlify/functions'
import { adminClient } from '../lib/supabase'
import { createSnapshot, filesToPrune, rowCounts } from '../lib/backup'

const pkToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export default async () => {
  const sb = adminClient()
  const { data: run } = await sb.from('sync_runs').insert({ job_name: 'nightly_backup' }).select('id').single()
  try {
    const snap = await createSnapshot(sb)
    const name = `${pkToday()}.json`
    const up = await sb.storage.from('backups').upload(name, JSON.stringify(snap), { contentType: 'application/json', upsert: true })
    if (up.error) throw new Error(up.error.message)

    const { data: files } = await sb.storage.from('backups').list('', { limit: 1000 })
    const old = filesToPrune((files ?? []).map((f) => f.name), pkToday(), 30)
    if (old.length) await sb.storage.from('backups').remove(old)

    const counts = { file: name, removed: old.length, ...rowCounts(snap) }
    await sb.from('sync_runs').update({ result: 'ok', finished_at: new Date().toISOString(), counts }).eq('id', run!.id)
    return Response.json(counts)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await sb.from('sync_runs').update({ result: 'error', finished_at: new Date().toISOString(), error: message }).eq('id', run!.id)
    return new Response(message, { status: 500 })
  }
}

export const config: Config = { schedule: '0 20 * * *' }

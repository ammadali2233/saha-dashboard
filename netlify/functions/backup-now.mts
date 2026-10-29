// "Back up now" (owner): the same snapshot and Google Sheet copy as the nightly jobs, on demand.
import type { Config } from '@netlify/functions'
import { callerRole } from '../lib/supabase'
import nightly from './backup.mts'
import { runSheetMirror } from './sheet-mirror.mts'

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if ((await callerRole(req)) !== 'owner') return new Response('Not allowed', { status: 403 })
  const backup = await nightly()
  if (!backup.ok) return backup
  // and refresh the Google Sheet copy (skipped quietly if not configured)
  return Response.json({ backup: await backup.json(), sheet: await runSheetMirror() })
}

export const config: Config = { path: '/api/backup-now' }

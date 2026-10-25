// "Sync now" button: the same import, on demand, for the owner and partners.
import type { Config } from '@netlify/functions'
import { callerRole } from '../lib/supabase'
import { runIcalImport } from '../lib/ical-sync'

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const role = await callerRole(req)
  if (role !== 'owner' && role !== 'partner') return new Response('Not allowed', { status: 403 })
  return Response.json(await runIcalImport('manual'))
}

export const config: Config = { path: '/api/ical-sync' }

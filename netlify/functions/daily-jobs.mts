// Nightly roll-forward at 00:05 Karachi (19:05 UTC): statuses, payment due/overdue, booking tasks,
// recurring bills. All logic lives in the SQL function public.roll_forward (idempotent, logged).
import type { Config } from '@netlify/functions'
import { adminClient } from '../lib/supabase'

export default async () => {
  const { data, error } = await adminClient().rpc('roll_forward')
  if (error) {
    await adminClient().from('sync_runs').insert({ job_name: 'daily_roll_forward', result: 'error', error: error.message, finished_at: new Date().toISOString() })
    return new Response(error.message, { status: 500 })
  }
  return Response.json(data)
}

export const config: Config = { schedule: '5 19 * * *' }

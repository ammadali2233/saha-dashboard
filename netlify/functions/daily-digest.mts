// Morning email at 08:00 Karachi (03:00 UTC) to the owner and partners. Skipped until configured.
import type { Config } from '@netlify/functions'
import { adminClient } from '../lib/supabase'
import { buildDigest, gatherDigest, sendEmail } from '../lib/digest'

const pkToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date())
export const appUrl = () => process.env.URL ?? 'https://saha-dashboard.netlify.app' // Netlify sets URL to the site address

/** Send the digest to `only` (an email), or to every active owner and partner. */
export async function runDigest(only?: string) {
  if (!process.env.RESEND_API_KEY || !process.env.DIGEST_FROM) return { skipped: 'RESEND_API_KEY and DIGEST_FROM are not set' }
  const sb = adminClient()
  const { data: run } = await sb.from('sync_runs').insert({ job_name: 'daily_digest' }).select('id').single()
  try {
    const msg = buildDigest(await gatherDigest(sb, pkToday(), appUrl()))
    const { data: users, error } = await sb.from('app_users').select('email, role, active').is('deleted_at', null).eq('active', true).in('role', ['owner', 'partner'])
    if (error) throw new Error(error.message)
    const to = only ? [only] : (users ?? []).map((u) => u.email)
    const failed: string[] = []
    for (const email of to) {
      try {
        await sendEmail(email, msg)
      } catch (e) {
        failed.push(e instanceof Error ? e.message : String(e))
      }
    }
    if (failed.length) throw new Error(failed.join(' | '))
    const counts = { sent: to.length, subject: msg.subject }
    await sb.from('sync_runs').update({ result: 'ok', finished_at: new Date().toISOString(), counts }).eq('id', run!.id)
    return counts
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await sb.from('sync_runs').update({ result: 'error', finished_at: new Date().toISOString(), error: message }).eq('id', run!.id)
    return { error: message }
  }
}

export default async () => Response.json(await runDigest())

export const config: Config = { schedule: '0 3 * * *' }

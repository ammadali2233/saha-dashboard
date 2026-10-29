// "Send me today's digest" (owner/partner): the morning email, sent only to the person who asked.
import type { Config } from '@netlify/functions'
import { adminClient, callerRole } from '../lib/supabase'
import { runDigest } from './daily-digest.mts'

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const role = await callerRole(req)
  if (role !== 'owner' && role !== 'partner') return new Response('Not allowed', { status: 403 })
  const token = req.headers.get('authorization')?.replace(/^Bearer /i, '') ?? ''
  const { data } = await adminClient().auth.getUser(token)
  return Response.json(await runDigest(data.user!.email!))
}

export const config: Config = { path: '/api/digest-now' }

// Service-role client for Netlify Functions only. Never import this from src/.
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/database.types'

export function adminClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for functions')
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** The caller's role from their Supabase JWT, or null (not signed in / not on the allowlist). */
export async function callerRole(req: Request): Promise<'owner' | 'partner' | 'staff' | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer /i, '')
  if (!token) return null
  const sb = adminClient()
  const { data } = await sb.auth.getUser(token)
  const email = data.user?.email?.toLowerCase()
  if (!email) return null
  const { data: u } = await sb.from('app_users').select('role, active').eq('email', email).is('deleted_at', null).maybeSingle()
  return u?.active ? u.role : null
}

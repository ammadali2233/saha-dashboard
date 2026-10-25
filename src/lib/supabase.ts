import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see .env.example).')
}
if (url.includes('supabase.com/dashboard')) {
  // Easy mistake when copying from the dashboard: the API lives at https://<ref>.supabase.co
  throw new Error(`VITE_SUPABASE_URL is the dashboard link (${url}); use the API URL https://<project-ref>.supabase.co`)
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
})

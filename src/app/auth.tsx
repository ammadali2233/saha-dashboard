import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

export type Role = Database['public']['Enums']['app_role']

export interface Member {
  id: string
  email: string
  display_name: string
  role: Role
}

interface AuthState {
  session: Session | null
  loading: boolean
  member: Member | null
  memberLoading: boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const memberQuery = useQuery({
    queryKey: ['current-member', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('current_member')
      if (error) throw error
      return (data?.[0] as Member | undefined) ?? null
    },
  })

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        member: memberQuery.data ?? null,
        memberLoading: !!session && memberQuery.isPending,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

export function signOut() {
  return supabase.auth.signOut()
}

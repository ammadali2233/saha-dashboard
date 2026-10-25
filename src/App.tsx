import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { Toaster } from 'sonner'
import { AuthProvider, signOut, useAuth } from '@/app/auth'
import { AppLayout } from '@/app/AppLayout'
import { LoginPage } from '@/features/auth/LoginPage'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { CalendarPage } from '@/features/calendar/CalendarPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { Button } from '@/components/ui/button'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
})

function Gate() {
  const { session, loading, member, memberLoading } = useAuth()
  if (loading || memberLoading) {
    return <div className="flex min-h-dvh items-center justify-center text-muted-foreground">Loading…</div>
  }
  if (!session) return <LoginPage />
  if (!member) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold">No access</h1>
        <p className="max-w-sm text-muted-foreground">
          {session.user.email} is not on the DHA Retreat access list. Ask Ammad to add you, then sign in again.
        </p>
        <Button variant="outline" onClick={signOut}>
          Sign out
        </Button>
      </main>
    )
  }
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </AuthProvider>
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  )
}

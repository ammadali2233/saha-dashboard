import { lazy } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { Toaster } from 'sonner'
import { AuthProvider, signOut, useAuth } from '@/app/auth'
import { AppLayout } from '@/app/AppLayout'
import { LoginPage } from '@/features/auth/LoginPage'
import { Button } from '@/components/ui/button'

const OverviewPage = lazy(() => import('@/features/overview/OverviewPage').then((m) => ({ default: m.OverviewPage })))
const CalendarPage = lazy(() => import('@/features/calendar/CalendarPage').then((m) => ({ default: m.CalendarPage })))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const BookingsPage = lazy(() => import('@/features/bookings/BookingsPage').then((m) => ({ default: m.BookingsPage })))
const BookingDetailPage = lazy(() =>
  import('@/features/bookings/BookingDetailPage').then((m) => ({ default: m.BookingDetailPage })),
)
const BookingFormPage = lazy(() => import('@/features/bookings/BookingFormPage').then((m) => ({ default: m.BookingFormPage })))
const MoneyPage = lazy(() => import('@/features/money/MoneyPage').then((m) => ({ default: m.MoneyPage })))
const ExpenseFormPage = lazy(() => import('@/features/money/ExpenseFormPage').then((m) => ({ default: m.ExpenseFormPage })))
const TasksPage = lazy(() => import('@/features/tasks/TasksPage').then((m) => ({ default: m.TasksPage })))
const AuditPage = lazy(() => import('@/features/settings/AuditPage').then((m) => ({ default: m.AuditPage })))
const PartnersPage = lazy(() => import('@/features/partners/PartnersPage').then((m) => ({ default: m.PartnersPage })))

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
  if (member.role === 'staff') {
    // caretaker: calendar and tasks only; financial routes do not exist for them
    return (
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="*" element={<Navigate to="/tasks" replace />} />
        </Route>
      </Routes>
    )
  }
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="bookings" element={<BookingsPage />} />
        <Route path="bookings/new" element={<BookingFormPage />} />
        <Route path="bookings/:id" element={<BookingDetailPage />} />
        <Route path="bookings/:id/edit" element={<BookingFormPage />} />
        <Route path="money" element={<MoneyPage />} />
        <Route path="money/expenses/new" element={<ExpenseFormPage />} />
        <Route path="money/expenses/:id" element={<ExpenseFormPage />} />
        <Route path="partners" element={<PartnersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/audit" element={<AuditPage />} />
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

import { Suspense } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { BedDouble, CalendarDays, LayoutDashboard, LogOut, Settings, Users, Wallet } from 'lucide-react'
import { signOut, useAuth } from './auth'
import { cn } from '@/lib/utils'
import { Loading } from '@/components/common'

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, end: false },
  { to: '/bookings', label: 'Bookings', icon: BedDouble, end: false },
  { to: '/money', label: 'Money', icon: Wallet, end: false },
  { to: '/partners', label: 'Partners', icon: Users, end: false },
]

export function AppLayout() {
  const { member } = useAuth()
  const location = useLocation()
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r bg-card p-4 md:flex md:flex-col md:gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">SAHA Residences</p>
        <p className="mb-4 text-lg font-semibold">DHA Retreat</p>
        {[...NAV, { to: '/settings', label: 'Settings', icon: Settings, end: false }].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn('flex h-10 items-center gap-3 rounded-md px-3 text-sm', isActive ? 'bg-accent font-medium' : 'hover:bg-muted')
            }
          >
            <item.icon className="size-4" aria-hidden />
            {item.label}
          </NavLink>
        ))}
        <div className="mt-auto border-t pt-3 text-sm">
          <p className="font-medium">{member?.display_name}</p>
          <p className="capitalize text-muted-foreground">{member?.role}</p>
          <button onClick={signOut} className="mt-2 flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0 pb-20 md:pb-0">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:hidden">
          <span className="font-semibold">DHA Retreat</span>
          <div className="-mr-2 flex">
            <Link to="/settings" aria-label="Settings" className="flex size-11 items-center justify-center rounded-md hover:bg-muted">
              <Settings className="size-5" aria-hidden />
            </Link>
            <button onClick={signOut} aria-label="Sign out" className="flex size-11 items-center justify-center rounded-md hover:bg-muted">
              <LogOut className="size-5" aria-hidden />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl p-4 md:p-6">
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex h-16 flex-col items-center justify-center gap-1 text-[11px]',
                isActive ? 'font-semibold text-primary' : 'text-muted-foreground',
              )
            }
          >
            <item.icon className="size-5" aria-hidden />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

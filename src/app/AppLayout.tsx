import { NavLink, Outlet } from 'react-router'
import { CalendarDays, LayoutDashboard, LogOut, Settings } from 'lucide-react'
import { signOut, useAuth } from './auth'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
]

export function AppLayout() {
  const { member } = useAuth()
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r bg-card p-4 md:flex md:flex-col md:gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">SAHA Residences</p>
        <p className="mb-4 text-lg font-semibold">DHA Retreat</p>
        {NAV.map((item) => (
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

      <div className="pb-20 md:pb-0">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:hidden">
          <span className="font-semibold">DHA Retreat</span>
          <button
            onClick={signOut}
            aria-label="Sign out"
            className="flex size-11 items-center justify-center rounded-md hover:bg-muted"
          >
            <LogOut className="size-5" aria-hidden />
          </button>
        </header>
        <main className="mx-auto w-full max-w-5xl p-4 md:p-6">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex h-16 flex-col items-center justify-center gap-1 text-xs',
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

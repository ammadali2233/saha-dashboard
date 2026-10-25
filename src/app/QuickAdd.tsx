import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { BedDouble, CalendarX, ListChecks, MessageSquareQuote, Plus, Receipt, Wallet, X } from 'lucide-react'
import { useAuth } from './auth'
import { cn } from '@/lib/utils'

// Global "+" for the most common entries.
const ITEMS = [
  { to: '/bookings/new', label: 'Booking', icon: BedDouble },
  { to: '/inquiries?new=1', label: 'Inquiry', icon: MessageSquareQuote },
  { to: '/tasks?new=1', label: 'Task', icon: ListChecks },
  { to: '/money/expenses/new?kind=operating', label: 'Expense', icon: Receipt },
  { to: '/money?tab=incoming', label: 'Payment', icon: Wallet, hint: 'Pick the booking it belongs to' },
  { to: '/calendar', label: 'Block dates', icon: CalendarX, hint: 'Tap the dates on the calendar' },
]

export function QuickAdd() {
  const { member } = useAuth()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => setOpen(false), [location.pathname, location.search])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  if (member?.role === 'staff') return null
  return (
    <div ref={ref} className="fixed right-4 bottom-20 z-20 flex flex-col items-end gap-2 md:bottom-6">
      {open && (
        <ul className="flex flex-col gap-1 rounded-xl border bg-card p-1 shadow-xl" role="menu">
          {ITEMS.map((it) => (
            <li key={it.label} role="none">
              <Link
                role="menuitem"
                to={it.to}
                className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-muted"
              >
                <it.icon className="size-4" aria-hidden />
                <span>
                  {it.label}
                  {it.hint && <span className="block text-xs text-muted-foreground">{it.hint}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        aria-label={open ? 'Close quick add' : 'Quick add'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform',
          open && 'rotate-45',
        )}
      >
        {open ? <X className="size-6 -rotate-45" aria-hidden /> : <Plus className="size-6" aria-hidden />}
      </button>
    </div>
  )
}

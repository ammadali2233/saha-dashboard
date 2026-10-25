import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Info, LogIn, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { unwrap } from '@/lib/queries'
import { useAuth } from '@/app/auth'
import { EmptyState, ErrorNote, Loading, Money } from '@/components/common'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { addDays } from '@/domain/booking'
import { formatDate, pkToday } from '@/domain/format'
import { cn } from '@/lib/utils'

const EXCLUDE_KEY = 'overview.excludeNonStandard'

function readExclude() {
  try {
    return localStorage.getItem(EXCLUDE_KEY) === '1'
  } catch {
    return false
  }
}

const pct = (x: unknown) => (x == null ? '-' : `${Math.round(Number(x) * 100)}%`)
const monthName = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })

export function OverviewPage() {
  const { member } = useAuth()
  const today = pkToday()
  const thisMonth = today.slice(0, 7)
  const [y, m] = thisMonth.split('-').map(Number) as [number, number]
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  const [exclude, setExclude] = useState(readExclude)

  const kpis = useQuery({
    queryKey: ['overview_kpis', exclude],
    queryFn: async () => unwrap(await supabase.rpc('overview_kpis', { p_exclude_nonstandard: exclude }))[0],
  })
  const alerts = useQuery({
    queryKey: ['alerts'],
    queryFn: async () => unwrap(await supabase.from('alerts').select('*').order('alert_date', { ascending: true })),
  })
  const movements = useQuery({
    queryKey: ['overview_moves', today],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('booking_financials')
          .select('booking_id, guest_name, ref, channel_name, channel_color, check_in, check_out, nights, needs_details')
          .in('status', ['confirmed', 'in_house', 'completed', 'tentative'])
          .or(`and(check_in.gte.${today},check_in.lte.${addDays(today, 7)}),and(check_out.gte.${today},check_out.lte.${addDays(today, 7)})`),
      ),
  })
  const tasks = useQuery({
    queryKey: ['overview_tasks', today],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('tasks')
          .select('id, title, due_date, status, booking_id')
          .is('deleted_at', null)
          .neq('status', 'done')
          .lte('due_date', addDays(today, 7))
          .order('due_date'),
      ),
  })

  function toggleExclude() {
    const next = !exclude
    setExclude(next)
    try {
      localStorage.setItem(EXCLUDE_KEY, next ? '1' : '0')
    } catch {
      // private mode: the toggle still works for this visit
    }
  }

  const k = kpis.data
  const events = (movements.data ?? [])
    .flatMap((b) => [
      ...(b.check_in! >= today && b.check_in! <= addDays(today, 7) ? [{ date: b.check_in!, type: 'in' as const, b }] : []),
      ...(b.check_out! >= today && b.check_out! <= addDays(today, 7) ? [{ date: b.check_out!, type: 'out' as const, b }] : []),
    ])
    .sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'out' ? -1 : 1))

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{formatDate(today)}</p>
          <h1 className="text-2xl font-semibold">Salaam, {member?.display_name.split(' ')[0]}</h1>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={exclude} onChange={toggleExclude} />
          Exclude partner &amp; promo stays from occupancy/ADR
        </label>
      </div>

      <ErrorNote error={kpis.error} />
      {kpis.isPending ? (
        <Loading />
      ) : (
        k && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Kpi to={`/calendar?date=${thisMonth}-01`} label={`Occupancy ${monthName(today)}`} hint={`${k.occ_this_occupied}/${k.occ_this_available} nights · ${k.occ_this_completed} completed`}>
              {pct(k.occ_this_rate)}
            </Kpi>
            <Kpi to={`/calendar?date=${nextMonth}-01`} label={`Occupancy ${monthName(`${nextMonth}-01`)}`} hint={`${k.occ_next_occupied}/${k.occ_next_available} nights on the books`}>
              {pct(k.occ_next_rate)}
            </Kpi>
            <Kpi to={`/bookings?month=${thisMonth}`} label="ADR this month" hint="Net revenue per occupied night">
              <Money amount={k.adr_this_pkr} currency="PKR" estimate={!!k.adr_has_estimates} />
            </Kpi>
            <Kpi to="/money?tab=account" label="Realized revenue" hint={<>This month <Money amount={k.realized_mtd_pkr} currency="PKR" /></>}>
              <Money amount={k.realized_to_date_pkr} currency="PKR" />
            </Kpi>
            <Kpi to={`/money?tab=operating&month=${thisMonth}`} label="Operating costs this month">
              <Money amount={k.opex_mtd_pkr} currency="PKR" />
            </Kpi>
            <Kpi to="/partners" label="Realized net profit to date" hint="Cash in minus paid operating costs">
              <Money amount={k.realized_net_profit_pkr} currency="PKR" />
            </Kpi>
            <Kpi to="/money?tab=account" label="Project account">
              <Money amount={k.project_balance_pkr} currency="PKR" />
            </Kpi>
            <Kpi to="/bookings?status=confirmed" label="On the books" hint="Confirmed and in-house stays, not yet earned">
              <Money amount={k.on_the_books_pkr} currency="PKR" estimate={!!k.on_the_books_has_estimates} />
            </Kpi>
            <Kpi to="/money?tab=incoming&show=payouts" label="Pending payouts" hint={`${k.pending_payouts_count} payout${k.pending_payouts_count === 1 ? '' : 's'}, incl. held by partners`}>
              <Money amount={k.pending_payouts_pkr_est} currency="PKR" estimate />
            </Kpi>
            <Kpi to="/money?tab=incoming&show=guests" label="Due from direct guests">
              <Money amount={k.guest_balances_due_pkr} currency="PKR" />
            </Kpi>
            <Kpi to="/money?tab=incoming&show=deposits" label="Deposits held" hint="Refundable: not revenue">
              <Money amount={k.deposits_held_pkr} currency="PKR" />
            </Kpi>
            <Kpi to="/partners" label="Capital recovered" hint={<>of <Money amount={k.total_invested_pkr} currency="PKR" /> invested</>}>
              {pct(k.capital_recovered_pct)}
            </Kpi>
          </div>
        )
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <ErrorNote error={alerts.error} />
            {alerts.data?.length ? (
              <ul className="flex flex-col gap-1">
                {alerts.data.map((a, i) => (
                  <li key={`${a.kind}-${i}`}>
                    <Link
                      to={a.link ?? '/'}
                      className={cn(
                        'flex items-start gap-3 rounded-md p-2 text-sm hover:bg-muted',
                        a.severity === 'danger' && 'text-destructive',
                      )}
                    >
                      {a.severity === 'info' ? (
                        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                      ) : (
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{a.title}</span>
                        <span className="block text-muted-foreground">{a.detail}</span>
                      </span>
                      <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : alerts.isPending ? (
              <Loading />
            ) : (
              <EmptyState title="Nothing needs attention" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Next 7 days</CardTitle>
          </CardHeader>
          <CardContent>
            {events.length ? (
              <ul className="divide-y text-sm">
                {events.map((e) => (
                  <li key={`${e.type}-${e.b.booking_id}`}>
                    <Link to={`/bookings/${e.b.booking_id}`} className="flex items-center gap-3 py-2 hover:bg-muted/50">
                      {e.type === 'in' ? (
                        <LogIn className="size-4 text-emerald-600" aria-label="Check-in" />
                      ) : (
                        <LogOut className="size-4 text-muted-foreground" aria-label="Check-out" />
                      )}
                      <span className="w-20 shrink-0 text-muted-foreground">{formatDate(e.date).replace(/ \d{4}$/, '')}</span>
                      <span className="size-2 shrink-0 rounded-full" style={{ background: e.b.channel_color ?? undefined }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        {e.b.guest_name ?? e.b.ref ?? 'Guest details needed'}
                        <span className="text-muted-foreground"> · {e.type === 'in' ? `${e.b.nights} nights` : 'check-out'}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No check-ins or check-outs this week" />
            )}
            {(tasks.data?.length ?? 0) > 0 && (
              <>
                <p className="mt-4 mb-1 text-sm font-medium">Tasks due</p>
                <ul className="divide-y text-sm">
                  {tasks.data!.map((t) => (
                    <li key={t.id} className="flex justify-between gap-3 py-2">
                      {t.booking_id ? (
                        <Link to={`/bookings/${t.booking_id}`} className="hover:underline">
                          {t.title}
                        </Link>
                      ) : (
                        <span>{t.title}</span>
                      )}
                      <span className={cn('shrink-0', t.due_date && t.due_date < today ? 'text-destructive' : 'text-muted-foreground')}>
                        {t.due_date ? formatDate(t.due_date) : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Kpi({ to, label, hint, children }: { to: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Link to={to} className="group rounded-lg border bg-card p-3 hover:border-ring">
      <p className="flex items-center justify-between text-xs text-muted-foreground">
        {label}
        <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </p>
      <p className="mt-1 text-lg font-semibold">{children}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Link>
  )
}

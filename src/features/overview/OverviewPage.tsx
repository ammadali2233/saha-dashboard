import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Info, LogIn, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { unwrap } from '@/lib/queries'
import { useAuth } from '@/app/auth'
import { EmptyState, ErrorNote, Loading, Money } from '@/components/common'
import type { Database } from '@/lib/database.types'
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
  const [exclude, setExclude] = useState(readExclude)

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

      {/* every tile has its own period: a month, or the total so far */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Kpi label="Occupancy" initial={thisMonth} exclude={exclude}>
          {(k, p) => ({
            to: `/calendar?date=${p === 'all' ? today : `${p}-01`}`,
            value: pct(k.occ_rate),
            hint: `${k.occupied}/${k.available} nights${p === 'all' ? ' since go-live' : ''} · ${k.completed_nights} completed`,
          })}
        </Kpi>
        <Kpi label="ADR" initial={thisMonth} exclude={exclude}>
          {(k, p) => ({
            to: p === 'all' ? '/bookings' : `/bookings?month=${p}`,
            value: <Money amount={k.adr_pkr} currency="PKR" estimate={!!k.adr_has_estimates} />,
            hint: 'Net revenue per occupied night',
          })}
        </Kpi>
        <Kpi label="Realized revenue" initial="all" exclude={exclude}>
          {(k, p) => ({
            to: p === 'all' ? '/money?tab=incoming' : `/money?tab=incoming&month=${p}`,
            value: <Money amount={k.realized_pkr} currency="PKR" />,
            hint: 'Cash received, in PKR',
          })}
        </Kpi>
        <Kpi label="Revenue (by stay)" initial={thisMonth} exclude={exclude}>
          {(k, p) => ({
            to: '/reports',
            value: (
              <Money
                amount={Number(k.stay_earned_pkr) + Number(k.other_revenue_pkr)}
                currency="PKR"
                estimate={!!k.stay_has_estimates}
              />
            ),
            hint: (
              <>
                Earned from {p === 'all' ? 'completed stays' : 'nights this month'} · <Money amount={k.stay_booked_pkr} currency="PKR" /> more on the books
              </>
            ),
          })}
        </Kpi>
        <Kpi label="Operating costs" initial={thisMonth} exclude={exclude}>
          {(k, p) => ({
            to: p === 'all' ? '/money?tab=operating' : `/money?tab=operating&month=${p}`,
            value: <Money amount={k.opex_pkr} currency="PKR" />,
            hint: <>Incurred · paid <Money amount={k.opex_paid_pkr} currency="PKR" /></>,
          })}
        </Kpi>
        <Kpi label="Realized net profit" initial="all" exclude={exclude}>
          {(k) => ({
            to: '/partners',
            value: <Money amount={k.net_profit_pkr} currency="PKR" />,
            hint: 'Cash in minus paid operating costs',
          })}
        </Kpi>
        <Kpi label="Project account" initial="all" exclude={exclude}>
          {(k) => ({
            to: '/money?tab=account',
            value: <Money amount={k.project_balance_pkr} currency="PKR" />,
            hint: `As at ${formatDate(k.as_of)}`,
          })}
        </Kpi>
        <Kpi label="On the books" initial="all" exclude={exclude}>
          {(k, p) => ({
            to: '/bookings?status=confirmed',
            value: <Money amount={k.on_the_books_pkr} currency="PKR" estimate={!!k.on_the_books_has_estimates} />,
            hint: p === 'all' ? 'Confirmed stays, not yet earned' : 'Booked nights in this month',
          })}
        </Kpi>
        <Kpi label="Pending payouts" initial="all" exclude={exclude}>
          {(k, p) => ({
            to: '/money?tab=incoming&show=payouts',
            value: <Money amount={k.pending_payouts_pkr_est} currency="PKR" estimate />,
            hint: `${k.pending_payouts_count} payout${k.pending_payouts_count === 1 ? '' : 's'}${p === 'all' ? ', incl. held by partners' : ' expected this month'}`,
          })}
        </Kpi>
        <Kpi label="Due from direct guests" initial="all" exclude={exclude}>
          {(k, p) => ({
            to: '/money?tab=incoming&show=guests',
            value: <Money amount={k.guest_balances_due_pkr} currency="PKR" />,
            hint: p === 'all' ? 'All unpaid guest payments' : 'Falling due this month',
          })}
        </Kpi>
        <Kpi label="Deposits held" initial="all" exclude={exclude}>
          {(k) => ({
            to: '/money?tab=incoming&show=deposits',
            value: <Money amount={k.deposits_held_pkr} currency="PKR" />,
            hint: `Refundable, not revenue · as at ${formatDate(k.as_of)}`,
          })}
        </Kpi>
        <Kpi label="Capital recovered" initial="all" exclude={exclude}>
          {(k) => ({
            to: '/partners',
            value: pct(k.capital_recovered_pct),
            hint: <>of <Money amount={k.total_invested_pkr} currency="PKR" /> invested · as at {formatDate(k.as_of)}</>,
          })}
        </Kpi>
      </div>

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

type Period = 'all' | string // 'all' = total so far, else 'YYYY-MM'
type PeriodKpis = Database['public']['Functions']['kpi_period']['Returns'][number]

// first month with stays: live since 5 Oct 2026
const FIRST_MONTH = '2026-10'

const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

/** "Total so far", then every month from go-live to 6 months ahead, newest first. */
function periodOptions(thisMonth: string) {
  const out: { value: Period; label: string }[] = []
  for (let ym = addMonths(thisMonth, 6); ym >= FIRST_MONTH; ym = addMonths(ym, -1)) {
    out.push({ value: ym, label: `${monthName(`${ym}-01`).slice(0, 3)} ${ym.slice(0, 4)}` })
  }
  return [{ value: 'all', label: 'Total so far' }, ...out]
}

/** Figures for one period; tiles showing the same period share the request. */
function usePeriodKpis(period: Period, exclude: boolean) {
  return useQuery({
    // prefix kept so saves elsewhere that invalidate 'overview_kpis' refresh these too
    queryKey: ['overview_kpis', 'period', period, exclude],
    queryFn: async () =>
      unwrap(
        await supabase.rpc('kpi_period', {
          p_month: period === 'all' ? undefined : `${period}-01`,
          p_exclude_nonstandard: exclude,
        }),
      )[0],
  })
}

function Kpi({
  label,
  initial,
  exclude,
  children,
}: {
  label: string
  initial: Period
  exclude: boolean
  children: (k: PeriodKpis, period: Period) => { to: string; value: ReactNode; hint?: ReactNode }
}) {
  const [period, setPeriod] = useState<Period>(initial)
  const q = usePeriodKpis(period, exclude)
  const shown = q.data ? children(q.data, period) : null
  return (
    <div className="flex flex-col rounded-lg border bg-card p-3 has-[a:hover]:border-ring">
      <p className="text-xs text-muted-foreground">{label}</p>
      <select
        value={period}
        onChange={(e) => setPeriod(e.target.value)}
        className="mt-1 h-8 w-full min-w-0 rounded-md border bg-card px-1 text-xs"
        aria-label={`Period for ${label}`}
      >
        {periodOptions(pkToday().slice(0, 7)).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {shown ? (
        <Link to={shown.to} className="group mt-1 block flex-1">
          <p className="flex items-center justify-between text-lg font-semibold">
            {shown.value}
            <ArrowRight className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
          </p>
          {shown.hint && <p className="text-xs text-muted-foreground">{shown.hint}</p>}
        </Link>
      ) : (
        <p className="mt-1 text-lg font-semibold text-muted-foreground">{q.error ? 'Could not load' : '…'}</p>
      )}
    </div>
  )
}

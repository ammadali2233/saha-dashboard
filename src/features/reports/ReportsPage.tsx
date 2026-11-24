import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FileDown, Sheet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { unwrap } from '@/lib/queries'
import { downloadCsv } from '@/lib/csv'
import { ErrorNote, Loading, Money, PageHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoney, pkToday } from '@/domain/format'
import { cn } from '@/lib/utils'

// Channel colours: validated categorical palette (light on the card surface, own steps for dark).
const CHANNEL_COLORS: Record<string, { light: string; dark: string }> = {
  airbnb: { light: '#e34948', dark: '#e66767' },
  booking_com: { light: '#2a78d6', dark: '#3987e5' },
  direct: { light: '#008300', dark: '#008300' },
  other: { light: '#6250d6', dark: '#9085e9' },
}
const CHANNEL_ORDER = ['airbnb', 'booking_com', 'direct', 'other']
const LINE = { light: '#2a78d6', dark: '#3987e5' }

function useDark() {
  const q = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setDark(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return dark
}

const addMonths = (ym: string, k: number) => {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + k, 1))
  return d.toISOString().slice(0, 7)
}
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const pkrShort = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)))

export function ReportsPage() {
  const thisMonth = pkToday().slice(0, 7)
  const [from, setFrom] = useState(addMonths(thisMonth, -11) < '2026-09' ? '2026-09' : addMonths(thisMonth, -11))
  const [to, setTo] = useState(addMonths(thisMonth, 3))
  const [mode, setMode] = useState<'accrual' | 'cash'>('accrual')
  const [mixBy, setMixBy] = useState<'nights' | 'revenue'>('nights')
  const [mixTable, setMixTable] = useState(false)
  const dark = useDark()

  const q = useQuery({
    queryKey: ['reports', from, to],
    queryFn: async () => {
      const lo = `${from}-01`
      const hi = `${addMonths(to, 1)}-01`
      const [accrual, cash, mix, stats] = await Promise.all([
        supabase.from('monthly_pnl_accrual').select('*').gte('month', lo).lt('month', hi).order('month'),
        supabase.from('monthly_pnl_cash').select('*').gte('month', lo).lt('month', hi).order('month'),
        supabase.from('report_channel_mix').select('*').gte('month', lo).lt('month', hi).order('month'),
        supabase.from('report_bookings_monthly').select('*').gte('month', lo).lt('month', hi).order('month'),
      ])
      return { accrual: unwrap(accrual), cash: unwrap(cash), mix: unwrap(mix), stats: unwrap(stats) }
    },
  })

  const months = useMemo(() => {
    const out: string[] = []
    for (let m = from; m <= to && out.length < 60; m = addMonths(m, 1)) out.push(m)
    return out
  }, [from, to])

  const mixData = useMemo(
    () =>
      months.map((m) => {
        const row: Record<string, string | number> = { month: monthLabel(m) }
        for (const c of CHANNEL_ORDER) {
          const r = q.data?.mix.find((x) => x.month?.slice(0, 7) === m && x.channel_code === c)
          row[c] = r ? (mixBy === 'nights' ? Number(r.nights) : Math.round(Number(r.net_pkr))) : 0
        }
        return row
      }),
    [months, q.data, mixBy],
  )
  const channelsPresent = CHANNEL_ORDER.filter((c) => mixData.some((r) => Number(r[c]) > 0))
  const channelName = (c: string) => q.data?.mix.find((x) => x.channel_code === c)?.channel_name ?? c

  const adrData = months.map((m) => {
    const r = q.data?.accrual.find((x) => x.month?.slice(0, 7) === m)
    const nights = Number(r?.nights ?? 0)
    return { month: monthLabel(m), adr: nights ? Math.round(Number(r?.stay_revenue_pkr) / nights) : null, est: !!r?.has_estimates }
  })

  const pnlRows =
    mode === 'accrual'
      ? (q.data?.accrual ?? []).map((r) => [r.month!.slice(0, 7), Number(r.nights), Number(r.earned_revenue_pkr), Number(r.booked_revenue_pkr), Number(r.other_revenue_pkr), Number(r.operating_expenses_pkr), Number(r.net_profit_pkr)])
      : (q.data?.cash ?? []).map((r) => [r.month!.slice(0, 7), Number(r.realized_revenue_pkr), Number(r.paid_operating_pkr), Number(r.net_profit_pkr)])
  const pnlHead = mode === 'accrual' ? ['Month', 'Nights', 'Earned', 'On the books', 'Other revenue', 'Operating costs', 'Net'] : ['Month', 'Realized revenue', 'Paid operating costs', 'Net']
  const totals = pnlHead.map((_, i) => (i === 0 ? 'Total' : pnlRows.reduce((a, r) => a + Number(r[i] ?? 0), 0)))

  const pdf = useMutation({
    mutationFn: async () => {
      const { data } = await supabase.auth.getSession()
      const res = await fetch(`/api/pnl-pdf?mode=${mode}&from=${from}&to=${to}`, { headers: { authorization: `Bearer ${data.session?.access_token ?? ''}` } })
      if (!res.ok) throw new Error(res.status === 404 ? 'PDFs are made on the deployed site (Netlify), not in local dev.' : `PDF failed (${res.status})`)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(await res.blob())
      a.download = `DHA Retreat P&L ${mode} ${from} to ${to}.pdf`
      a.click()
      URL.revokeObjectURL(a.href)
    },
  })

  const tick = { fill: 'var(--muted-foreground)', fontSize: 11 }
  const tooltipStyle = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--foreground)', fontSize: 12 }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports" />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">From</span>
          <input type="month" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-11 rounded-md border bg-card px-3" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">To</span>
          <input type="month" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="h-11 rounded-md border bg-card px-3" />
        </label>
      </div>
      <ErrorNote error={q.error ?? pdf.error} />
      {q.isPending ? (
        <Loading />
      ) : (
        <>
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>Profit and loss</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Segmented value={mode} onChange={setMode} options={[['accrual', 'Accrual'], ['cash', 'Cash']]} />
                <Button variant="outline" size="sm" onClick={() => downloadCsv(`P&L ${mode} ${from} to ${to}`, [pnlHead, ...pnlRows, totals])}>
                  <Sheet aria-hidden /> CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => pdf.mutate()} disabled={pdf.isPending}>
                  <FileDown aria-hidden /> {pdf.isPending ? 'PDF…' : 'PDF'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-muted-foreground">
                {mode === 'accrual'
                  ? 'Accrual: stay revenue by the night it falls on, other revenue on its date, costs by the month incurred. Earned = completed stays; On the books = nights of stays not yet completed. Net includes both.'
                  : 'Cash: money that reached the project account and costs actually paid, by date.'}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      {pnlHead.map((h, i) => (
                        <th key={h} className={cn('py-1 font-normal', i > 0 && 'text-right')}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[...pnlRows, totals].map((r, j) => (
                      <tr key={j} className={j === pnlRows.length ? 'font-semibold' : ''}>
                        {r.map((v, i) => (
                          <td key={i} className={cn('py-1.5', i > 0 && 'text-right')}>
                            {i === 0 ? (typeof v === 'string' && v !== 'Total' ? monthLabel(v) : v) : mode === 'accrual' && i === 1 ? v : <Money amount={Number(v)} currency="PKR" />}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>Channel mix</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Segmented value={mixBy} onChange={setMixBy} options={[['nights', 'Nights'], ['revenue', 'Revenue']]} />
                <Button variant="ghost" size="sm" onClick={() => setMixTable((t) => !t)}>
                  {mixTable ? 'Chart' : 'Table'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="mb-2 flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Legend">
                {channelsPresent.map((c) => (
                  <li key={c} className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm" style={{ background: CHANNEL_COLORS[c]![dark ? 'dark' : 'light'] }} aria-hidden />
                    {channelName(c)}
                  </li>
                ))}
              </ul>
              {mixTable ? (
                <SimpleTable
                  head={['Month', ...channelsPresent.map(channelName)]}
                  rows={mixData.map((r) => [String(r.month), ...channelsPresent.map((c) => (mixBy === 'nights' ? String(r[c]) : formatMoney(Number(r[c]), 'PKR')))])}
                />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={mixData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="month" tick={tick} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
                      <YAxis tick={tick} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => (mixBy === 'nights' ? String(v) : pkrShort(Number(v)))} />
                      <Tooltip
                        cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
                        contentStyle={tooltipStyle}
                        formatter={(v: number, name: string) => [mixBy === 'nights' ? `${v} nights` : formatMoney(v, 'PKR'), channelName(name)]}
                      />
                      {channelsPresent.map((c, i) => (
                        <Bar
                          key={c}
                          dataKey={c}
                          stackId="mix"
                          fill={CHANNEL_COLORS[c]![dark ? 'dark' : 'light']}
                          stroke="var(--card)"
                          strokeWidth={2}
                          radius={i === channelsPresent.length - 1 ? [4, 4, 0, 0] : 0}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {mixBy === 'revenue' && <p className="mt-2 text-xs text-muted-foreground">Net revenue in PKR; USD stays at the payout rate, or the default rate (est.) until forwarded.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Average nightly rate (PKR)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={adrData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="month" tick={tick} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
                    <YAxis tick={tick} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => pkrShort(Number(v))} />
                    <Tooltip
                      cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
                      contentStyle={tooltipStyle}
                      formatter={(v: number, _n, p) => [`${formatMoney(v, 'PKR')}${(p.payload as { est: boolean }).est ? ' est.' : ''}`, 'Per night']}
                    />
                    <Line type="monotone" dataKey="adr" stroke={LINE[dark ? 'dark' : 'light']} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Net stay revenue ÷ occupied nights, by the month the nights fall in.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Bookings by check-in month</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadCsv(`Booking stats ${from} to ${to}`, [
                    ['Month', 'Bookings', 'Cancelled', 'Cancellation %', 'Avg length of stay (nights)', 'Avg lead time (days)', 'Lead-time sample'],
                    ...(q.data?.stats ?? []).map((r) => [r.month!.slice(0, 7), r.bookings, r.cancelled, r.bookings ? Math.round((Number(r.cancelled) / Number(r.bookings)) * 100) : null, r.avg_los, r.avg_lead_days, r.lead_sample]),
                  ])
                }
              >
                <Sheet aria-hidden /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              <SimpleTable
                head={['Month', 'Bookings', 'Cancelled', 'Avg stay', 'Lead time']}
                rows={(q.data?.stats ?? []).map((r) => [
                  monthLabel(r.month!.slice(0, 7)),
                  String(r.bookings),
                  `${r.cancelled}${r.bookings ? ` (${Math.round((Number(r.cancelled) / Number(r.bookings)) * 100)}%)` : ''}`,
                  r.avg_los ? `${r.avg_los} nights` : '-',
                  r.avg_lead_days != null ? `${r.avg_lead_days} days (${r.lead_sample})` : '-',
                ])}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Lead time counts only bookings with a known booking date (entered in the app); imported and calendar-synced bookings have none.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div role="radiogroup" className="flex rounded-lg bg-muted p-1">
      {options.map(([v, l]) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn('h-8 rounded-md px-3 text-sm', value === v ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground')}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

function SimpleTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cn('py-1 font-normal', i > 0 && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, j) => (
            <tr key={j}>
              {r.map((v, i) => (
                <td key={i} className={cn('py-1.5', i > 0 && 'text-right')}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

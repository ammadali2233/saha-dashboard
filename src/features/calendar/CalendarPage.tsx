import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin, { type DateClickArg } from '@fullcalendar/interaction'
import type { DateSelectArg, EventClickArg, EventInput } from '@fullcalendar/core'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { unwrap, useChannels } from '@/lib/queries'
import { ErrorNote, Money, PageHeader, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Select, Textarea } from '@/components/ui/form-controls'
import { Input } from '@/components/ui/input'
import { addDays, rangesOverlap } from '@/domain/booking'
import { formatDate, type Currency } from '@/domain/format'
import { cn } from '@/lib/utils'
import './calendar.css'

const ACTIVE = ['tentative', 'confirmed', 'in_house', 'completed']
const LAYERS = [
  ['bookings', 'Bookings'],
  ['cancelled', 'Cancelled'],
  ['blocks', 'Blocks & holds'],
  ['markers', 'Payouts & bills'],
] as const
type Layer = (typeof LAYERS)[number][0]

function useCalendarData() {
  return useQuery({
    queryKey: ['calendar'],
    queryFn: async () => {
      const [bookings, blocks, conflicts, payouts, bills] = await Promise.all([
        supabase
          .from('booking_financials')
          .select('booking_id, guest_name, ref, channel_id, channel_name, channel_color, check_in, check_out, nights, status, booking_type, needs_details, net, currency, net_pkr, pkr_is_estimate, guest_phone'),
        supabase.from('calendar_blocks').select('id, start_date, end_date, reason, source, notes, channel_id').is('deleted_at', null),
        supabase.from('calendar_conflicts').select('*'),
        supabase
          .from('payments')
          .select('id, booking_id, kind, due_date, amount_due, currency, status')
          .is('deleted_at', null)
          .in('kind', ['airbnb_payout', 'booking_com_payout'])
          .not('status', 'in', '(received,waived)'),
        supabase.from('expenses').select('id, expense_date, item, category, amount').is('deleted_at', null).eq('status', 'due'),
      ])
      return {
        bookings: unwrap(bookings),
        blocks: unwrap(blocks),
        conflicts: unwrap(conflicts),
        payouts: unwrap(payouts),
        bills: unwrap(bills),
      }
    },
  })
}

type Data = NonNullable<ReturnType<typeof useCalendarData>['data']>
type BookingRow = Data['bookings'][number]
type BlockRow = Data['blocks'][number]

export function CalendarPage() {
  const [params] = useSearchParams()
  const q = useCalendarData()
  const channels = useChannels()
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ bookings: true, cancelled: false, blocks: true, markers: true })
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(new Set())
  const [openBooking, setOpenBooking] = useState<BookingRow | null>(null)
  const [openBlock, setOpenBlock] = useState<BlockRow | null>(null)
  const [range, setRange] = useState<{ start: string; end: string } | null>(null)

  const events = useMemo<EventInput[]>(() => {
    const d = q.data
    if (!d) return []
    const out: EventInput[] = []
    const conflictIds = new Set(d.conflicts.flatMap((c) => [c.a_id, c.b_id]))
    const visible = (b: BookingRow) => !hiddenChannels.has(b.channel_id!)

    if (layers.bookings || layers.cancelled) {
      for (const b of d.bookings) {
        const active = ACTIVE.includes(b.status!)
        if (!visible(b) || (active ? !layers.bookings : !layers.cancelled)) continue
        out.push({
          id: `b:${b.booking_id}`,
          start: b.check_in!,
          end: b.check_out!,
          allDay: true,
          title: `${b.guest_name ?? b.ref ?? 'Details needed'} · ${b.nights}n`,
          backgroundColor: b.channel_color ?? undefined,
          borderColor: conflictIds.has(b.booking_id) ? 'var(--destructive)' : (b.channel_color ?? undefined),
          classNames: cn(!active && 'fc-cancelled', conflictIds.has(b.booking_id) && 'fc-conflict', b.needs_details && 'fc-stub').split(' ').filter(Boolean),
          extendedProps: { kind: 'booking', row: b },
        })
      }
    }
    if (layers.blocks) {
      for (const k of d.blocks) {
        out.push({
          id: `k:${k.id}`,
          start: k.start_date,
          end: k.end_date,
          allDay: true,
          title: k.reason === 'owner_use' ? 'Owner use' : k.reason === 'maintenance' ? 'Maintenance' : 'Channel hold',
          classNames: ['fc-hatched', conflictIds.has(k.id) ? 'fc-conflict' : ''].filter(Boolean),
          extendedProps: { kind: 'block', row: k },
        })
      }
    }
    // conflicts: red background over the overlapping nights
    for (const c of d.conflicts) {
      out.push({ start: c.start_date!, end: c.end_date!, allDay: true, display: 'background', classNames: ['fc-conflict-bg'] })
    }
    if (layers.bookings) {
      // back-to-back turnovers: someone checks out the day someone checks in
      const active = d.bookings.filter((b) => ACTIVE.includes(b.status!))
      const ins = new Set(active.map((b) => b.check_in))
      for (const day of new Set(active.map((b) => b.check_out).filter((x) => ins.has(x)))) {
        out.push({ start: day!, allDay: true, title: '⇄ Turnover', classNames: ['fc-marker', 'fc-marker-turnover'], extendedProps: { kind: 'marker' } })
      }
    }
    if (layers.markers) {
      for (const p of d.payouts) {
        if (!p.due_date) continue
        const b = d.bookings.find((x) => x.booking_id === p.booking_id)
        if (!b || !ACTIVE.includes(b.status!)) continue
        out.push({
          start: p.due_date,
          allDay: true,
          title: `$ payout ${b.guest_name ?? b.ref ?? ''}`,
          classNames: ['fc-marker'],
          extendedProps: { kind: 'marker', link: `/bookings/${p.booking_id}` },
        })
      }
      for (const e of d.bills) {
        out.push({
          start: e.expense_date,
          allDay: true,
          title: `${e.category} due`,
          classNames: ['fc-marker', 'fc-marker-bill'],
          extendedProps: { kind: 'marker', link: `/money/expenses/${e.id}` },
        })
      }
    }
    return out
  }, [q.data, layers, hiddenChannels])

  const navigate = useNavigate()
  function onEventClick(arg: EventClickArg) {
    const p = arg.event.extendedProps as { kind: string; row?: unknown; link?: string }
    if (p.kind === 'booking') setOpenBooking(p.row as BookingRow)
    else if (p.kind === 'block') setOpenBlock(p.row as BlockRow)
    else if (p.link) navigate(p.link)
  }
  function onSelect(arg: DateSelectArg) {
    setRange({ start: arg.startStr.slice(0, 10), end: arg.endStr.slice(0, 10) })
  }
  function onDateClick(arg: DateClickArg) {
    setRange({ start: arg.dateStr.slice(0, 10), end: addDays(arg.dateStr.slice(0, 10), 1) })
  }

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Calendar" />
      <ErrorNote error={q.error} />

      <div className="flex flex-wrap gap-2" aria-label="Layers">
        {LAYERS.map(([k, label]) => (
          <Chip key={k} on={layers[k]} onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}>
            {label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Channels">
        {channels.data?.map((c) => (
          <Chip
            key={c.id}
            on={!hiddenChannels.has(c.id)}
            onClick={() =>
              setHiddenChannels((s) => {
                const n = new Set(s)
                if (n.has(c.id)) n.delete(c.id)
                else n.add(c.id)
                return n
              })
            }
          >
            <span className="size-2.5 rounded-full" style={{ background: c.color }} aria-hidden /> {c.name}
          </Chip>
        ))}
      </div>

      <div className="rounded-lg border bg-card p-2 sm:p-3">
        <FullCalendar
          plugins={[dayGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          initialDate={params.get('date') ?? undefined}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,dayGridWeek,listMonth' }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', list: 'List' }}
          firstDay={1}
          height="auto"
          events={events}
          eventClick={onEventClick}
          selectable
          selectLongPressDelay={300}
          select={onSelect}
          dateClick={onDateClick}
          dayMaxEvents={4}
          eventDisplay="block"
          displayEventTime={false}
          timeZone="UTC"
          noEventsText="Nothing in this period"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Tap a date or drag across dates to add a booking or block. Airbnb and Booking.com refresh imported calendars on their own
        schedule, so confirm availability on the platform before accepting a direct booking for near dates.
      </p>

      <BookingDrawer row={openBooking} onClose={() => setOpenBooking(null)} />
      <BlockDialog row={openBlock} onClose={() => setOpenBlock(null)} />
      <QuickAdd range={range} onClose={() => setRange(null)} data={q.data} />
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm',
        on ? 'border-primary bg-accent' : 'text-muted-foreground line-through decoration-1',
      )}
    >
      {children}
    </button>
  )
}

function BookingDrawer({ row, onClose }: { row: BookingRow | null; onClose: () => void }) {
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      {row && (
        <DialogContent title={row.guest_name ?? 'Guest details needed'} description={`${row.channel_name}${row.ref ? ` · ${row.ref}` : ''}`}>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={row.status!} />
              {row.booking_type !== 'standard' && <span className="text-muted-foreground">{row.booking_type?.replace('_', ' / ')}</span>}
            </div>
            <p>
              {formatDate(row.check_in!)} to {formatDate(row.check_out!)} · {row.nights} night{row.nights === 1 ? '' : 's'}
            </p>
            {row.guest_phone && (
              <a href={`tel:${row.guest_phone}`} className="text-primary underline">
                {row.guest_phone}
              </a>
            )}
            <p>
              Net <Money amount={row.net} currency={row.currency as Currency} />
              {row.currency === 'USD' && (
                <>
                  {' '}
                  · <Money amount={row.net_pkr} currency="PKR" estimate={!!row.pkr_is_estimate} />
                </>
              )}
            </p>
            <Button asChild size="lg">
              <Link to={row.needs_details ? `/bookings/${row.booking_id}/edit` : `/bookings/${row.booking_id}`}>
                {row.needs_details ? 'Complete details' : 'Open booking'}
              </Link>
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}

function BlockDialog({ row, onClose }: { row: BlockRow | null; onClose: () => void }) {
  const qc = useQueryClient()
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await supabase.from('calendar_blocks').update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id').single()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] })
      toast.success('Block removed')
      onClose()
    },
  })
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      {row && (
        <DialogContent
          title={row.reason === 'owner_use' ? 'Owner use' : row.reason === 'maintenance' ? 'Maintenance' : 'Channel hold'}
          description={`${formatDate(row.start_date)} to ${formatDate(row.end_date)}`}
        >
          <div className="flex flex-col gap-3 text-sm">
            {row.reason === 'channel_hold' && (
              <p className="text-muted-foreground">
                Blocked on a channel calendar (from the iCal feed). Holds never count as occupancy and never block a booking.
              </p>
            )}
            {row.notes && <p className="whitespace-pre-wrap">{row.notes}</p>}
            <ErrorNote error={remove.error} />
            {row.source !== 'ical' && (
              <Button variant="outline" onClick={() => remove.mutate(row.id)} disabled={remove.isPending}>
                Remove block
              </Button>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}

function QuickAdd({ range, onClose, data }: { range: { start: string; end: string } | null; onClose: () => void; data: Data | undefined }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [mode, setMode] = useState<'choose' | 'block'>('choose')
  const [reason, setReason] = useState<'owner_use' | 'maintenance'>('owner_use')
  const [notes, setNotes] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  const s = start || range?.start || ''
  const e = end || range?.end || ''
  const clashes = useMemo(() => {
    if (!data || !s || !e || e <= s) return []
    return [
      ...data.bookings
        .filter((b) => ACTIVE.includes(b.status!) && rangesOverlap(s, e, b.check_in!, b.check_out!))
        .map((b) => `${b.guest_name ?? b.ref ?? 'Booking'} (${formatDate(b.check_in!)} to ${formatDate(b.check_out!)})`),
      ...data.blocks
        .filter((k) => k.reason !== 'channel_hold' && rangesOverlap(s, e, k.start_date, k.end_date))
        .map((k) => `${k.reason === 'owner_use' ? 'Owner use' : 'Maintenance'} (${formatDate(k.start_date)} to ${formatDate(k.end_date)})`),
    ]
  }, [data, s, e])
  const holds = data?.blocks.filter((k) => k.reason === 'channel_hold' && s && e && rangesOverlap(s, e, k.start_date, k.end_date)) ?? []

  const saveBlock = useMutation({
    mutationFn: async () =>
      unwrap(
        await supabase
          .from('calendar_blocks')
          .insert({ start_date: s, end_date: e, reason, notes: notes || null, source: 'manual' })
          .select('id')
          .single(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] })
      toast.success('Dates blocked')
      close()
    },
  })

  function close() {
    setMode('choose')
    setNotes('')
    setStart('')
    setEnd('')
    saveBlock.reset()
    onClose()
  }

  return (
    <Dialog open={!!range} onOpenChange={(o) => !o && close()}>
      {range && (
        <DialogContent title="Add to calendar" description={`Nights ${formatDate(s)} to ${formatDate(e)} (check-out day)`}>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="From" htmlFor="qa_start">
                <Input id="qa_start" type="date" value={s} onChange={(ev) => setStart(ev.target.value)} />
              </Field>
              <Field label="To (check-out)" htmlFor="qa_end">
                <Input id="qa_end" type="date" value={e} onChange={(ev) => setEnd(ev.target.value)} />
              </Field>
            </div>
            {clashes.length > 0 ? (
              <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                Not available: {clashes.join(', ')}.
              </p>
            ) : (
              e > s && <p className="text-sm text-emerald-700 dark:text-emerald-300">Available.</p>
            )}
            {holds.length > 0 && clashes.length === 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-300">A channel hold covers some of these dates: check the platform first.</p>
            )}

            {mode === 'choose' ? (
              <div className="grid gap-2">
                <Button size="lg" disabled={clashes.length > 0 || !(e > s)} onClick={() => navigate(`/bookings/new?check_in=${s}&check_out=${e}`)}>
                  New booking
                </Button>
                <Button size="lg" variant="outline" disabled={clashes.length > 0 || !(e > s)} onClick={() => setMode('block')}>
                  Block dates (owner use / maintenance)
                </Button>
              </div>
            ) : (
              <div className="grid gap-3">
                <Field label="Reason" htmlFor="qa_reason">
                  <Select id="qa_reason" value={reason} onChange={(ev) => setReason(ev.target.value as typeof reason)}>
                    <option value="owner_use">Owner use</option>
                    <option value="maintenance">Maintenance</option>
                  </Select>
                </Field>
                <Field label="Notes" htmlFor="qa_notes">
                  <Textarea id="qa_notes" value={notes} onChange={(ev) => setNotes(ev.target.value)} />
                </Field>
                <ErrorNote error={saveBlock.error} />
                <Button size="lg" onClick={() => saveBlock.mutate()} disabled={saveBlock.isPending || clashes.length > 0}>
                  {saveBlock.isPending ? 'Saving…' : 'Block these dates'}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}

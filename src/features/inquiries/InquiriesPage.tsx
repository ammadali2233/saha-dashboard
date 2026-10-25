import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, FileText, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { INQUIRY_STATUSES, useInquiries, useInvalidateSales, useQuotes, useSaveInquiry, type Inquiry } from './api'
import { useConflicts } from '@/features/bookings/api'
import { useChannels, useGuests } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { EmptyState, ErrorNote, Loading, PageHeader, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Select, Textarea } from '@/components/ui/form-controls'
import { Input } from '@/components/ui/input'
import { addDays, nightsBetween } from '@/domain/booking'
import { formatDate, pkToday } from '@/domain/format'
import { cn } from '@/lib/utils'

const OPEN = ['new', 'quoted', 'awaiting_advance']

export function InquiriesPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'quotes' ? 'quotes' : 'pipeline'
  const openId = params.get('open')
  const inquiries = useInquiries()
  const quotes = useQuotes()
  const [editing, setEditing] = useState<Inquiry | 'new' | null>(params.get('new') ? 'new' : null) // from quick-add
  const today = pkToday()
  const fromLink = openId ? inquiries.data?.find((i) => i.id === openId) : undefined
  const current = editing ?? fromLink ?? null

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Inquiries"
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> Inquiry
          </Button>
        }
      />
      <div role="tablist" className="flex w-fit rounded-lg bg-muted p-1">
        {(['pipeline', 'quotes'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setParams(t === 'quotes' ? { tab: t } : {}, { replace: true })}
            className={cn(
              'h-9 rounded-md px-4 text-sm capitalize',
              tab === t ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <ErrorNote error={inquiries.error ?? quotes.error} />

      {tab === 'pipeline' ? (
        inquiries.isPending ? (
          <Loading />
        ) : (
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-6 lg:px-0">
            {INQUIRY_STATUSES.map(([status, label]) => {
              const col = (inquiries.data ?? []).filter(
                (i) => i.status === status && (OPEN.includes(status) || i.updated_at.slice(0, 10) >= addDays(today, -30)),
              )
              return (
                <section key={status} className="w-64 shrink-0 snap-start rounded-lg bg-muted p-2 lg:w-auto">
                  <h2 className="mb-2 px-1 text-sm font-medium">
                    {label} <span className="text-muted-foreground">({col.length})</span>
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {col.map((i) => {
                      const quote = quotes.data?.find((q) => q.id === i.quote_id)
                      const due = i.follow_up_date && i.follow_up_date <= today && OPEN.includes(i.status)
                      return (
                        <li key={i.id}>
                          <button
                            className="w-full rounded-md border bg-card p-2 text-left text-sm"
                            onClick={() => setEditing(i)}
                          >
                            <span className="block font-medium">{i.guests?.name ?? 'Unknown guest'}</span>
                            {i.check_in && i.check_out && (
                              <span className="block text-xs text-muted-foreground">
                                {formatDate(i.check_in).replace(/ \d{4}$/, '')} to{' '}
                                {formatDate(i.check_out).replace(/ \d{4}$/, '')} · {nightsBetween(i.check_in, i.check_out)}n
                                {i.guest_count ? ` · ${i.guest_count} guests` : ''}
                              </span>
                            )}
                            <span className="mt-1 flex flex-wrap gap-1">
                              {quote && <Badge variant="outline">{quote.number}</Badge>}
                              {i.follow_up_date && OPEN.includes(i.status) && (
                                <Badge variant={due ? 'warning' : 'default'}>
                                  follow up {formatDate(i.follow_up_date).replace(/ \d{4}$/, '')}
                                </Badge>
                              )}
                              {i.lost_reason && <Badge variant="outline">{i.lost_reason}</Badge>}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>
        )
      ) : quotes.data?.length ? (
        <ul className="divide-y rounded-lg border bg-card text-sm">
          {quotes.data.map((q) => (
            <li key={q.id}>
              <Link to={`/quotes/${q.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-muted/50">
                <span>
                  <span className="font-medium">{q.number}</span> · {q.prepared_for}
                  <span className="block text-xs text-muted-foreground">
                    {formatDate(q.check_in)} to {formatDate(q.check_out)}
                  </span>
                </span>
                <StatusBadge status={q.status === 'sent' && q.valid_until && q.valid_until < today ? 'expired' : q.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No quotes yet">Create one from an inquiry.</EmptyState>
      )}

      <InquiryDialog
        inquiry={current}
        onClose={() => {
          setEditing(null)
          if (openId) setParams({}, { replace: true })
        }}
      />
    </div>
  )
}

function InquiryDialog({ inquiry, onClose }: { inquiry: Inquiry | 'new' | null; onClose: () => void }) {
  const navigate = useNavigate()
  const guests = useGuests()
  const channels = useChannels()
  const save = useSaveInquiry()
  const invalidate = useInvalidateSales()
  const i = inquiry === 'new' ? null : inquiry
  const key = inquiry === 'new' ? 'new' : (inquiry?.id ?? '')
  const [loaded, setLoaded] = useState('')
  const [f, setF] = useState<Record<string, string>>({})
  if (inquiry && loaded !== key) {
    setLoaded(key)
    setF({
      guest_id: i?.guest_id ?? '',
      guest_name: '',
      guest_phone: '',
      source: 'WhatsApp',
      channel_id: i?.channel_id ?? channels.data?.find((c) => c.code === 'direct')?.id ?? '',
      check_in: i?.check_in ?? '',
      check_out: i?.check_out ?? '',
      guest_count: i?.guest_count ? String(i.guest_count) : '',
      scope: i?.scope ?? 'full_house',
      status: i?.status ?? 'new',
      follow_up_date: i?.follow_up_date ?? addDays(pkToday(), 1),
      lost_reason: i?.lost_reason ?? '',
      notes: i?.notes ?? '',
    })
  }
  if (!inquiry && loaded) setLoaded('')
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const conflicts = useConflicts(f.check_in ?? '', f.check_out ?? '')
  const hard = conflicts.data?.filter((c) => c.is_hard) ?? []

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('inquiries').update({ deleted_at: new Date().toISOString() }).eq('id', i!.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      invalidate()
      onClose()
    },
  })

  async function submit(thenQuote: boolean) {
    try {
      const id = await save.mutateAsync({
        id: i?.id,
        guest: { id: f.guest_id || undefined, name: f.guest_name ?? '', phone: f.guest_phone ?? '', source: f.source ?? '' },
        values: {
          channel_id: f.channel_id || null,
          check_in: f.check_in || null,
          check_out: f.check_out || null,
          guest_count: f.guest_count ? Number(f.guest_count) : null,
          scope: f.scope as Inquiry['scope'],
          status: f.status as Inquiry['status'],
          follow_up_date: f.follow_up_date || null,
          lost_reason: f.status === 'lost' ? f.lost_reason || null : null,
          notes: f.notes || null,
        },
      })
      toast.success('Inquiry saved')
      onClose()
      if (thenQuote) navigate(`/quotes/new?inquiry=${id}`)
    } catch {
      // shown via save.error
    }
  }

  return (
    <Dialog open={!!inquiry} onOpenChange={(o) => !o && onClose()}>
      {inquiry && (
        <DialogContent title={i ? (i.guests?.name ?? 'Inquiry') : 'New inquiry'}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Guest" htmlFor="i_guest" className="col-span-2">
              <Select id="i_guest" value={f.guest_id ?? ''} onChange={set('guest_id')}>
                <option value="">New guest…</option>
                {guests.data?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                    {g.phone ? ` · ${g.phone}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            {!f.guest_id && (
              <>
                <Field label="Name" htmlFor="i_name">
                  <Input id="i_name" value={f.guest_name ?? ''} onChange={set('guest_name')} />
                </Field>
                <Field label="Phone" htmlFor="i_phone">
                  <Input id="i_phone" type="tel" inputMode="tel" value={f.guest_phone ?? ''} onChange={set('guest_phone')} />
                </Field>
                <Field label="Came via" htmlFor="i_source" className="col-span-2">
                  <Select id="i_source" value={f.source ?? ''} onChange={set('source')}>
                    {['WhatsApp', 'Instagram', 'Website', 'Referral', 'Airbnb', 'Booking.com', 'Other'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
            <Field label="Check-in" htmlFor="i_in">
              <Input id="i_in" type="date" value={f.check_in ?? ''} onChange={set('check_in')} />
            </Field>
            <Field label="Check-out" htmlFor="i_out">
              <Input id="i_out" type="date" value={f.check_out ?? ''} onChange={set('check_out')} />
            </Field>
            {hard.length > 0 && (
              <p role="alert" className="col-span-2 flex gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                Not available: overlaps {hard.map((c) => c.label).join(', ')}.
              </p>
            )}
            <Field label="Guests" htmlFor="i_guests">
              <Input id="i_guests" type="number" inputMode="numeric" value={f.guest_count ?? ''} onChange={set('guest_count')} />
            </Field>
            <Field label="Scope" htmlFor="i_scope">
              <Select id="i_scope" value={f.scope ?? 'full_house'} onChange={set('scope')}>
                <option value="full_house">Full house</option>
                <option value="single_room">Single room</option>
              </Select>
            </Field>
            <Field label="Status" htmlFor="i_status">
              <Select id="i_status" value={f.status ?? 'new'} onChange={set('status')}>
                {INQUIRY_STATUSES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Follow up on" htmlFor="i_follow">
              <Input id="i_follow" type="date" value={f.follow_up_date ?? ''} onChange={set('follow_up_date')} />
            </Field>
            {f.status === 'lost' && (
              <Field label="Why lost" htmlFor="i_lost" className="col-span-2">
                <Select id="i_lost" value={f.lost_reason ?? ''} onChange={set('lost_reason')}>
                  <option value="">Choose…</option>
                  {['Price', 'Dates not available', 'Booked elsewhere', 'No reply', 'Changed plans', 'Other'].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Notes" htmlFor="i_notes" className="col-span-2">
              <Textarea id="i_notes" value={f.notes ?? ''} onChange={set('notes')} />
            </Field>
            <div className="col-span-2">
              <ErrorNote error={save.error ?? remove.error} />
            </div>
            {i?.quote_id ? (
              <Button asChild size="lg" variant="secondary" className="col-span-2">
                <Link to={`/quotes/${i.quote_id}`}>
                  <FileText aria-hidden /> Open quote
                </Link>
              </Button>
            ) : (
              <Button
                size="lg"
                className="col-span-2"
                disabled={save.isPending || !f.check_in || !f.check_out}
                onClick={() => submit(true)}
              >
                <FileText aria-hidden /> Save and create quote
              </Button>
            )}
            <Button size="lg" variant="outline" className="col-span-2" disabled={save.isPending} onClick={() => submit(false)}>
              Save inquiry
            </Button>
            {i?.booking_id && (
              <Button asChild variant="ghost" className="col-span-2">
                <Link to={`/bookings/${i.booking_id}`}>Open booking</Link>
              </Button>
            )}
            {i && (
              <Button variant="ghost" className="col-span-2 text-destructive" onClick={() => remove.mutate()}>
                Delete inquiry
              </Button>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}

import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { AlertCircle, CalendarPlus, Paperclip, Pencil, Plus, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useBooking, useSavePayment, useUpdateBooking, type PaymentRow } from './api'
import { PaymentDialog } from './PaymentDialog'
import { unwrap, useAudit, usePartners, useSettings } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { useQuery } from '@tanstack/react-query'
import { ErrorNote, Loading, Money, PageHeader, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Select, Textarea } from '@/components/ui/form-controls'
import { Input } from '@/components/ui/input'
import { LINE_KIND_LABELS } from '@/domain/booking'
import { depositState, directSchedule, isHeldByPartner, PAYMENT_KIND_LABELS, type Payment } from '@/domain/payments'
import { formatDate, formatTimestamp, pkToday, type Currency } from '@/domain/format'

export function BookingDetailPage() {
  const { id } = useParams()
  const q = useBooking(id)
  const settings = useSettings()
  const partners = usePartners()
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [editing, setEditing] = useState<PaymentRow | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const savePayment = useSavePayment(id ?? '')

  const auditIds = q.data ? [q.data.booking.id, ...q.data.lines.map((l) => l.id), ...q.data.payments.map((p) => p.id)] : []
  const audit = useAudit('bookings', auditIds)

  if (q.isPending) return <Loading />
  if (q.error || !q.data) return <ErrorNote error={q.error ?? 'Booking not found'} />
  const { fin, booking, lines, payments } = q.data
  const currency = (fin.currency ?? 'PKR') as Currency
  const deposit = depositState(payments as Payment[])
  const partnerName = (pid: string | null) => partners.data?.find((p) => p.id === pid)?.name ?? 'a partner'
  const isDirect = fin.channel_code === 'direct'

  async function createSchedule() {
    if (!settings.data || fin.net == null) return
    const s = directSchedule(
      Number(fin.net),
      Number(settings.data.advance_pct),
      Number(settings.data.deposit_pct),
      booking.booked_at ?? pkToday(),
      booking.check_in,
    )
    try {
      for (const [kind, part] of [
        ['advance', s.advance],
        ['balance', s.balance],
        ['deposit_in', s.deposit],
      ] as const) {
        await savePayment.mutateAsync({ kind, currency: 'PKR', amount_due: part.amount, due_date: part.due, status: 'scheduled' })
      }
      toast.success('Payment schedule created')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the schedule')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={fin.guest_name ?? 'Guest details needed'}
        back="/bookings"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: fin.channel_color ?? undefined }} aria-hidden />
            {fin.channel_name}
            {fin.ref && <span>· {fin.ref}</span>}
            <StatusBadge status={fin.status!} />
            {fin.booking_type !== 'standard' && <Badge variant="outline">{fin.booking_type?.replace('_', ' / ')}</Badge>}
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={`/bookings/${booking.id}/edit`}>
                <Pencil aria-hidden /> Edit
              </Link>
            </Button>
            {!['cancelled', 'no_show', 'fraud'].includes(booking.status) && (
              <Button variant="outline" onClick={() => setCancelOpen(true)}>
                <XCircle aria-hidden /> Cancel
              </Button>
            )}
          </>
        }
      />

      {booking.needs_details && (
        <Link
          to={`/bookings/${booking.id}/edit`}
          className="flex items-center gap-2 rounded-md bg-amber-500/15 p-3 text-sm text-amber-800 dark:text-amber-200"
        >
          <AlertCircle className="size-4" aria-hidden /> This booking came from the calendar feed. Add the guest and charges.
        </Link>
      )}

      <Card>
        <CardContent className="grid grid-cols-2 gap-3 pt-4 text-sm sm:grid-cols-4">
          <Info label="Check-in" value={formatDate(booking.check_in)} />
          <Info label="Check-out" value={formatDate(booking.check_out)} />
          <Info label="Nights" value={String(booking.nights)} />
          <Info label="Guests" value={booking.guest_count ? String(booking.guest_count) : '-'} />
          {fin.guest_phone && <Info label="Phone" value={fin.guest_phone} />}
          {booking.cancelled_on && <Info label="Cancelled on" value={formatDate(booking.cancelled_on)} />}
          {booking.cancellation_reason && <Info label="Reason" value={booking.cancellation_reason} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Charges</CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No charges yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-3 py-2">
                  <span>
                    {l.label}
                    <span className="block text-xs text-muted-foreground">
                      {LINE_KIND_LABELS[l.kind]}
                      {Number(l.qty) !== 1 && ` · ${Number(l.qty)} × ${Math.abs(Number(l.unit_amount)).toLocaleString('en-US')}`}
                    </span>
                  </span>
                  <Money amount={l.amount} currency={l.currency} />
                </li>
              ))}
            </ul>
          )}
          <dl className="mt-2 grid grid-cols-2 gap-y-1 border-t pt-3 text-sm">
            <dt>Gross</dt>
            <dd className="text-right">
              <Money amount={fin.gross} currency={currency} />
            </dd>
            <dt>Discounts</dt>
            <dd className="text-right">
              <Money amount={fin.discounts} currency={currency} />
            </dd>
            <dt>Platform fee {fin.platform_fee_is_actual ? '(actual)' : '(computed)'}</dt>
            <dd className="text-right">
              <Money amount={fin.platform_fee} currency={currency} />
            </dd>
            <dt className="font-semibold">Net payout</dt>
            <dd className="text-right font-semibold">
              <Money amount={fin.net} currency={currency} />
            </dd>
            {currency === 'USD' && (
              <>
                <dt className="text-muted-foreground">In PKR</dt>
                <dd className="text-right">
                  <Money amount={fin.net_pkr} currency="PKR" estimate={!!fin.pkr_is_estimate} />
                  <span className="block text-xs text-muted-foreground">
                    at {Number(fin.pkr_rate).toFixed(2)} {fin.pkr_is_estimate ? '(default rate)' : '(actual payout rate)'}
                  </span>
                </dd>
              </>
            )}
            {Number(fin.tax) > 0 && (
              <>
                <dt className="text-muted-foreground">Tax (pass-through)</dt>
                <dd className="text-right">
                  <Money amount={fin.tax} currency={currency} />
                </dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Payments</CardTitle>
          <div className="flex gap-2">
            {isDirect && payments.length === 0 && Number(fin.net) > 0 && (
              <Button size="sm" variant="outline" onClick={createSchedule} disabled={savePayment.isPending}>
                <CalendarPlus aria-hidden /> Schedule
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                setEditing(null)
                setPaymentOpen(true)
              }}
            >
              <Plus aria-hidden /> Record
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded.</p>
          ) : (
            <ul className="divide-y text-sm">
              {payments.map((p) => (
                <li key={p.id}>
                  <button
                    className="flex w-full items-start justify-between gap-3 py-2 text-left hover:bg-muted/50"
                    onClick={() => {
                      setEditing(p)
                      setPaymentOpen(true)
                    }}
                  >
                    <span>
                      <span className="flex flex-wrap items-center gap-2">
                        {PAYMENT_KIND_LABELS[p.kind]} <StatusBadge status={p.status} />
                        {p.proof_path && <Paperclip className="size-3.5 text-muted-foreground" aria-label="Proof attached" />}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {p.status === 'received' && p.received_date
                          ? `Received ${formatDate(p.received_date)}`
                          : p.due_date
                            ? `Due ${formatDate(p.due_date)}`
                            : 'No date'}
                        {isHeldByPartner(p as Payment) && ` · held by ${partnerName(p.received_by_partner_id)}, not yet forwarded`}
                        {p.forwarded_date && ` · forwarded ${formatDate(p.forwarded_date)}`}
                      </span>
                    </span>
                    <span className="text-right">
                      <Money amount={p.status === 'received' ? p.amount_received : p.amount_due} currency={p.currency} />
                      {p.currency === 'USD' && p.pkr_received != null && (
                        <span className="block text-xs text-muted-foreground">
                          <Money amount={p.pkr_received} currency="PKR" /> @ {Number(p.fx_rate).toFixed(2)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {(deposit.collected > 0 || deposit.overReleased) && (
            <p className={`mt-3 rounded-md p-3 text-sm ${deposit.overReleased ? 'bg-destructive/10 text-destructive' : 'bg-muted'}`}>
              Security deposit: <Money amount={deposit.held} currency="PKR" /> held (collected{' '}
              <Money amount={deposit.collected} currency="PKR" />, refunded <Money amount={deposit.refunded} currency="PKR" />,
              withheld <Money amount={deposit.withheld} currency="PKR" />)
              {deposit.overReleased && '. More was released than collected: check the entries.'}
            </p>
          )}
        </CardContent>
      </Card>

      <BookingTasks bookingId={booking.id} />

      {(booking.checkin_notes || booking.notes) && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {booking.checkin_notes && (
              <div>
                <p className="text-xs text-muted-foreground">Check-in</p>
                <p className="whitespace-pre-wrap">{booking.checkin_notes}</p>
              </div>
            )}
            {booking.notes && (
              <div>
                <p className="text-xs text-muted-foreground">Internal</p>
                <p className="whitespace-pre-wrap">{booking.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {audit.data?.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {audit.data.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-x-3 text-muted-foreground">
                  <span>
                    <span className="text-foreground">{a.user_email ?? 'system'}</span> {AUDIT_VERB[a.action] ?? a.action}{' '}
                    {AUDIT_NOUN[a.table_name] ?? a.table_name}
                  </span>
                  <span>{formatTimestamp(a.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No changes recorded.</p>
          )}
        </CardContent>
      </Card>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        bookingId={booking.id}
        bookingCurrency={currency}
        payment={editing}
      />
      <CancelDialog open={cancelOpen} onOpenChange={setCancelOpen} bookingId={booking.id} />
    </div>
  )
}

function BookingTasks({ bookingId }: { bookingId: string }) {
  const q = useQuery({
    queryKey: ['tasks', 'booking', bookingId],
    queryFn: async () =>
      unwrap(await supabase.from('tasks').select('id, title, due_date, status').eq('booking_id', bookingId).is('deleted_at', null).order('due_date')),
  })
  if (!q.data?.length) return null
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Tasks</CardTitle>
        <Button asChild variant="outline" size="sm">
          <Link to="/tasks">All tasks</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {q.data.map((t) => (
            <li key={t.id} className="flex justify-between gap-3 py-2">
              <span className={t.status === 'done' ? 'text-muted-foreground line-through' : ''}>{t.title}</span>
              <span className="shrink-0 text-muted-foreground">{t.due_date ? formatDate(t.due_date) : ''}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

const AUDIT_VERB: Record<string, string> = { INSERT: 'added', UPDATE: 'changed', DELETE: 'removed' }
const AUDIT_NOUN: Record<string, string> = { bookings: 'the booking', booking_lines: 'a charge', payments: 'a payment' }

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  )
}

function CancelDialog({ open, onOpenChange, bookingId }: { open: boolean; onOpenChange: (o: boolean) => void; bookingId: string }) {
  const update = useUpdateBooking(bookingId)
  const [status, setStatus] = useState<'cancelled' | 'no_show' | 'fraud'>('cancelled')
  const [date, setDate] = useState(pkToday())
  const [reason, setReason] = useState('')

  async function confirm() {
    try {
      await update.mutateAsync({ status, cancelled_on: date, cancellation_reason: reason || null })
      toast.success('Booking marked ' + status.replace('_', ' '))
      onOpenChange(false)
    } catch {
      // shown via update.error
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Cancel booking"
        description="The dates free up and the stay leaves nights and revenue. Record any cancellation payout as a payment afterwards."
      >
        <div className="grid gap-4">
          <Field label="Outcome" htmlFor="cstatus">
            <Select id="cstatus" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="cancelled">Cancelled</option>
              <option value="no_show">No-show</option>
              <option value="fraud">Fraud</option>
            </Select>
          </Field>
          <Field label="Date" htmlFor="cdate">
            <Input id="cdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Reason" htmlFor="creason">
            <Textarea id="creason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={update.error} />
          <Button variant="destructive" size="lg" onClick={confirm} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Confirm'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

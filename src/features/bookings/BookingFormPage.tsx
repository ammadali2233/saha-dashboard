import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useBooking, useConflicts, useSaveBooking } from './api'
import { useChannels, useGuests, useSettings } from '@/lib/queries'
import { ErrorNote, Loading, Money, PageHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, Select, Textarea } from '@/components/ui/form-controls'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { bookingTotals, LINE_KIND_LABELS, nightsBetween, type LineKind } from '@/domain/booking'
import { formatDate, formatMoney, type Currency } from '@/domain/format'
import { toCents } from '@/domain/money'

const LINE_KINDS = Object.keys(LINE_KIND_LABELS) as LineKind[]
const NEGATIVE_KINDS: LineKind[] = ['discount', 'platform_fee']
const DISCOUNT_SUBTYPES = [
  ['friends_family', 'Friends and family'],
  ['length_of_stay', 'Length of stay'],
  ['new_listing_promo', 'New listing promo'],
  ['early_bird', 'Early bird'],
  ['special_deal', 'Special deal'],
  ['custom', 'Custom'],
] as const

const lineSchema = z
  .object({
    id: z.string().optional(),
    kind: z.enum(LINE_KINDS as [LineKind, ...LineKind[]]),
    discount_subtype: z.string().optional(),
    label: z.string().trim().min(1, 'Add a label'),
    qty: z.coerce.number().positive('Must be more than 0'),
    unit_amount: z.coerce.number().min(0, 'Enter the amount without a minus sign'),
  })
  .refine((l) => l.kind !== 'discount' || !!l.discount_subtype, {
    message: 'Pick a discount type',
    path: ['discount_subtype'],
  })

const schema = z
  .object({
    channel_id: z.string().min(1, 'Pick a channel'),
    currency: z.enum(['PKR', 'USD']),
    guest_id: z.string(),
    guest_name: z.string().trim(),
    guest_phone: z.string().trim(),
    guest_email: z.string().trim().email('Not a valid email').or(z.literal('')),
    ref: z.string().trim(),
    check_in: z.string().min(1, 'Pick a check-in date'),
    check_out: z.string().min(1, 'Pick a check-out date'),
    guest_count: z.coerce.number().int().min(1).max(20).or(z.literal('')),
    booking_type: z.enum(['standard', 'partner_friends', 'promotional']),
    status: z.enum(['tentative', 'confirmed', 'in_house', 'completed', 'cancelled', 'no_show', 'fraud']),
    checkin_notes: z.string(),
    notes: z.string(),
    lines: z.array(lineSchema),
  })
  .refine((v) => !v.check_in || !v.check_out || v.check_out > v.check_in, {
    message: 'Check-out must be after check-in',
    path: ['check_out'],
  })

type FormValues = z.input<typeof schema>
type Parsed = z.output<typeof schema>

const signed = (kind: LineKind, n: number) => (NEGATIVE_KINDS.includes(kind) ? -Math.abs(n) : Math.abs(n))
const lineAmount = (qty: number, unit: number) => (toCents(qty) * toCents(unit)) / 10_000

export function BookingFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const existing = useBooking(id)
  const channels = useChannels()
  const guests = useGuests()
  const settings = useSettings()
  const save = useSaveBooking()

  const form = useForm<FormValues, unknown, Parsed>({
    resolver: zodResolver(schema),
    defaultValues: {
      channel_id: '',
      currency: 'PKR',
      guest_id: '',
      guest_name: '',
      guest_phone: '',
      guest_email: '',
      ref: '',
      check_in: '',
      check_out: '',
      guest_count: '',
      booking_type: 'standard',
      status: 'confirmed',
      checkin_notes: '',
      notes: '',
      lines: [{ kind: 'accommodation', label: 'Accommodation', qty: 1, unit_amount: 0 }],
    },
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' })

  // load an existing booking into the form
  useEffect(() => {
    const d = existing.data
    if (!d) return
    form.reset({
      channel_id: d.booking.channel_id,
      currency: (d.fin.currency ?? 'PKR') as Currency,
      guest_id: d.booking.guest_id ?? '',
      guest_name: '',
      guest_phone: '',
      guest_email: '',
      ref: d.booking.ref ?? '',
      check_in: d.booking.check_in,
      check_out: d.booking.check_out,
      guest_count: d.booking.guest_count ?? '',
      booking_type: d.booking.booking_type,
      status: d.booking.status,
      checkin_notes: d.booking.checkin_notes ?? '',
      notes: d.booking.notes ?? '',
      lines: d.lines.map((l) => ({
        id: l.id,
        kind: l.kind,
        discount_subtype: l.discount_subtype ?? '',
        label: l.label,
        qty: Number(l.qty),
        unit_amount: Math.abs(Number(l.unit_amount)),
      })),
    })
  }, [existing.data, form])

  const values = useWatch({ control: form.control })
  const channel = channels.data?.find((c) => c.id === values.channel_id)
  const currency = (values.currency ?? 'PKR') as Currency
  const nights = values.check_in && values.check_out && values.check_out > values.check_in ? nightsBetween(values.check_in, values.check_out) : 0

  // a new booking takes the channel's native currency
  useEffect(() => {
    if (!id && channel) form.setValue('currency', channel.native_currency)
  }, [channel, id, form])

  const totals = useMemo(() => {
    const lines = (values.lines ?? []).map((l) => ({
      kind: (l?.kind ?? 'accommodation') as LineKind,
      amount: signed((l?.kind ?? 'accommodation') as LineKind, lineAmount(Number(l?.qty) || 0, Number(l?.unit_amount) || 0)),
    }))
    return bookingTotals(lines, Number(channel?.platform_fee_pct ?? 0))
  }, [values.lines, channel])

  const conflicts = useConflicts(values.check_in ?? '', values.check_out ?? '', id)
  const hardConflicts = conflicts.data?.filter((c) => c.is_hard) ?? []
  const holds = conflicts.data?.filter((c) => !c.is_hard) ?? []

  async function onSubmit(v: Parsed) {
    const lines = v.lines.map((l, i) => {
      const amount = signed(l.kind, lineAmount(l.qty, l.unit_amount))
      return {
        id: l.id,
        kind: l.kind,
        discount_subtype: l.kind === 'discount' ? l.discount_subtype : null,
        label: l.label,
        qty: l.qty,
        unit_amount: signed(l.kind, l.unit_amount),
        amount,
        currency: v.currency,
        sort_order: i,
      }
    })
    const newGuest = !v.guest_id && v.guest_name ? { name: v.guest_name, phone: v.guest_phone, email: v.guest_email } : null
    try {
      const savedId = await save.mutateAsync({
        booking: {
          id,
          channel_id: v.channel_id,
          guest_id: v.guest_id || null,
          ref: v.ref,
          check_in: v.check_in,
          check_out: v.check_out,
          guest_count: v.guest_count === '' ? null : v.guest_count,
          booking_type: v.booking_type,
          status: v.status,
          checkin_notes: v.checkin_notes,
          notes: v.notes,
        },
        lines,
        guest: newGuest,
      })
      toast.success(id ? 'Booking updated' : 'Booking added')
      navigate(`/bookings/${savedId}`, { replace: true })
    } catch {
      // shown below the form via save.error
    }
  }

  if (id && existing.isPending) return <Loading />
  const err = form.formState.errors
  const rate = Number(settings.data?.default_usd_pkr ?? 0)

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4 pb-24">
      <PageHeader title={id ? 'Edit booking' : 'New booking'} back={id ? `/bookings/${id}` : '/bookings'} />

      <Card>
        <CardHeader>
          <CardTitle>Stay</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Channel" htmlFor="channel_id" error={err.channel_id?.message}>
            <Select id="channel_id" {...form.register('channel_id')} aria-invalid={!!err.channel_id}>
              <option value="">Choose…</option>
              {channels.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Booking ref"
            htmlFor="ref"
            hint={channel?.code === 'direct' ? 'Leave empty to get D-YYYY-NNN' : 'Channel confirmation code, e.g. HM…'}
          >
            <Input id="ref" autoCapitalize="characters" {...form.register('ref')} />
          </Field>
          <Field label="Check-in" htmlFor="check_in" error={err.check_in?.message}>
            <Input id="check_in" type="date" {...form.register('check_in')} aria-invalid={!!err.check_in} />
          </Field>
          <Field label="Check-out" htmlFor="check_out" error={err.check_out?.message}>
            <Input id="check_out" type="date" {...form.register('check_out')} aria-invalid={!!err.check_out} />
          </Field>
          <div className="sm:col-span-2">
            {nights > 0 && (
              <p className="text-sm text-muted-foreground">
                {nights} night{nights === 1 ? '' : 's'}: {formatDate(values.check_in!)} to {formatDate(values.check_out!)}
              </p>
            )}
            {hardConflicts.length > 0 && (
              <p role="alert" className="mt-2 flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Not available: overlaps{' '}
                  {hardConflicts.map((c) => `${c.label} (${formatDate(c.start_date)} to ${formatDate(c.end_date)})`).join(', ')}.
                </span>
              </p>
            )}
            {holds.length > 0 && hardConflicts.length === 0 && (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                A channel hold covers some of these dates. Check the platform before confirming.
              </p>
            )}
          </div>
          <Field label="Status" htmlFor="status">
            <Select id="status" {...form.register('status')}>
              {['tentative', 'confirmed', 'in_house', 'completed', 'cancelled', 'no_show', 'fraud'].map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Booking type" htmlFor="booking_type" hint="Partner / friends and promotional stays can be filtered out of ADR and occupancy">
            <Select id="booking_type" {...form.register('booking_type')}>
              <option value="standard">Standard</option>
              <option value="partner_friends">Partner / friends</option>
              <option value="promotional">Promotional</option>
            </Select>
          </Field>
          <Field label="Guests" htmlFor="guest_count" error={err.guest_count?.message}>
            <Input id="guest_count" type="number" inputMode="numeric" min={1} max={20} {...form.register('guest_count')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Guest</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Existing guest" htmlFor="guest_id" className="sm:col-span-2">
            <Select id="guest_id" {...form.register('guest_id')}>
              <option value="">New guest…</option>
              {guests.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.phone ? ` · ${g.phone}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          {!values.guest_id && (
            <>
              <Field label="Name" htmlFor="guest_name">
                <Input id="guest_name" autoComplete="off" {...form.register('guest_name')} />
              </Field>
              <Field label="Phone" htmlFor="guest_phone">
                <Input id="guest_phone" type="tel" inputMode="tel" {...form.register('guest_phone')} />
              </Field>
              <Field label="Email" htmlFor="guest_email" error={err.guest_email?.message}>
                <Input id="guest_email" type="email" inputMode="email" {...form.register('guest_email')} />
              </Field>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Charges</CardTitle>
          <div className="flex items-center gap-2">
            <label htmlFor="currency" className="text-sm text-muted-foreground">
              Currency
            </label>
            <Select id="currency" className="h-9 w-24" {...form.register('currency')}>
              <option value="PKR">PKR</option>
              <option value="USD">USD</option>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {fields.map((f, i) => {
            const line = values.lines?.[i]
            const kind = (line?.kind ?? 'accommodation') as LineKind
            const lineErr = err.lines?.[i]
            const amount = signed(kind, lineAmount(Number(line?.qty) || 0, Number(line?.unit_amount) || 0))
            return (
              <div key={f.id} className="grid grid-cols-6 gap-2 rounded-md border p-3">
                <Select aria-label="Type" className="col-span-3" {...form.register(`lines.${i}.kind`)}>
                  {LINE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {LINE_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
                {kind === 'discount' ? (
                  <Select
                    aria-label="Discount type"
                    className="col-span-3"
                    aria-invalid={!!lineErr?.discount_subtype}
                    {...form.register(`lines.${i}.discount_subtype`)}
                  >
                    <option value="">Discount type…</option>
                    {DISCOUNT_SUBTYPES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="col-span-3" />
                )}
                <Input aria-label="Label" placeholder="Label" className="col-span-6" {...form.register(`lines.${i}.label`)} />
                <Input
                  aria-label="Quantity"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  className="col-span-2"
                  {...form.register(`lines.${i}.qty`)}
                />
                <Input
                  aria-label={`Unit amount in ${currency}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  placeholder={currency}
                  className="col-span-3"
                  {...form.register(`lines.${i}.unit_amount`)}
                />
                <Button type="button" variant="ghost" size="icon" aria-label="Remove line" onClick={() => remove(i)}>
                  <Trash2 aria-hidden />
                </Button>
                <p className="col-span-6 text-right text-sm">
                  <Money amount={amount} currency={currency} />
                </p>
                {(lineErr?.label || lineErr?.qty || lineErr?.unit_amount || lineErr?.discount_subtype) && (
                  <p className="col-span-6 text-sm text-destructive">
                    {lineErr.label?.message ?? lineErr.qty?.message ?? lineErr.unit_amount?.message ?? lineErr.discount_subtype?.message}
                  </p>
                )}
              </div>
            )
          })}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ kind: 'accommodation', label: 'Accommodation', qty: nights || 1, unit_amount: 0 })}
            >
              <Plus aria-hidden /> Nightly rate
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => append({ kind: 'cleaning_fee', label: 'Cleaning', qty: 1, unit_amount: 0 })}>
              <Plus aria-hidden /> Fee
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ kind: 'discount', discount_subtype: '', label: 'Discount', qty: 1, unit_amount: 0 })}
            >
              <Plus aria-hidden /> Discount
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Enter discounts and platform fees as positive numbers; they are subtracted. Leave out the platform fee to use the
            channel's {Number(channel?.platform_fee_pct ?? 0)}%.
          </p>

          <dl className="mt-2 grid grid-cols-2 gap-y-1 border-t pt-3 text-sm">
            <dt>Gross</dt>
            <dd className="text-right">
              <Money amount={totals.gross} currency={currency} />
            </dd>
            <dt>Discounts</dt>
            <dd className="text-right">
              <Money amount={totals.discounts} currency={currency} />
            </dd>
            <dt>Platform fee {totals.platformFeeIsActual ? '(actual)' : `(${Number(channel?.platform_fee_pct ?? 0)}%)`}</dt>
            <dd className="text-right">
              <Money amount={totals.platformFee} currency={currency} />
            </dd>
            <dt className="font-semibold">Net payout</dt>
            <dd className="text-right font-semibold">
              <Money amount={totals.net} currency={currency} />
            </dd>
            {currency === 'USD' && rate > 0 && (
              <>
                <dt className="text-muted-foreground">In PKR</dt>
                <dd className="text-right text-muted-foreground">
                  {formatMoney(Math.round(totals.net * rate), 'PKR')} est. at {rate}
                </dd>
              </>
            )}
            {nights > 0 && totals.accommodation > 0 && (
              <>
                <dt className="text-muted-foreground">Per night (accommodation)</dt>
                <dd className="text-right text-muted-foreground">
                  <Money amount={totals.accommodation / nights} currency={currency} />
                </dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Check-in notes" htmlFor="checkin_notes" hint="Visible to the caretaker">
            <Textarea id="checkin_notes" {...form.register('checkin_notes')} />
          </Field>
          <Field label="Internal notes" htmlFor="notes">
            <Textarea id="notes" {...form.register('notes')} />
          </Field>
        </CardContent>
      </Card>

      <ErrorNote error={save.error} />

      <div className="fixed inset-x-0 bottom-16 z-10 border-t bg-background/95 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
        <Button type="submit" size="lg" className="w-full md:w-auto" disabled={save.isPending || hardConflicts.length > 0}>
          {save.isPending ? 'Saving…' : id ? 'Save changes' : 'Add booking'}
        </Button>
      </div>
    </form>
  )
}

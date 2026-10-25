import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { openFile, uploadFile, useDeletePayment, useSavePayment, type PaymentRow } from './api'
import { usePartners } from '@/lib/queries'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, Select, Textarea } from '@/components/ui/form-controls'
import { ErrorNote } from '@/components/common'
import { PAYMENT_KIND_LABELS, PAYOUT_KINDS, type PaymentKind } from '@/domain/payments'
import { formatMoney, pkToday, type Currency } from '@/domain/format'
import { fromCents, roundCents, toCents } from '@/domain/money'

const KINDS = Object.keys(PAYMENT_KIND_LABELS) as PaymentKind[]
const optionalNumber = z.union([z.literal(''), z.coerce.number().nonnegative()])

const schema = z
  .object({
    kind: z.enum(KINDS as [PaymentKind, ...PaymentKind[]]),
    currency: z.enum(['PKR', 'USD']),
    amount_due: optionalNumber,
    due_date: z.string(),
    status: z.enum(['scheduled', 'due', 'received', 'overdue', 'waived']),
    amount_received: optionalNumber,
    received_date: z.string(),
    method: z.string(),
    received_by_partner_id: z.string(),
    fx_rate: optionalNumber,
    pkr_received: optionalNumber,
    forwarded_date: z.string(),
    notes: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'received') {
      if (v.amount_received === '') ctx.addIssue({ code: 'custom', path: ['amount_received'], message: 'Enter the amount received' })
      if (!v.received_date) ctx.addIssue({ code: 'custom', path: ['received_date'], message: 'Enter the date received' })
    }
    if (v.amount_due === '' && v.status !== 'received')
      ctx.addIssue({ code: 'custom', path: ['amount_due'], message: 'Enter the amount due' })
    // USD becomes PKR either when a partner forwards it, or on receipt into the project account
    const converted = v.currency === 'USD' && v.status === 'received' && (!v.received_by_partner_id || !!v.forwarded_date)
    if (converted && (v.fx_rate === '' || v.fx_rate <= 0))
      ctx.addIssue({ code: 'custom', path: ['fx_rate'], message: 'Enter the conversion rate for this payout' })
    if (converted && v.pkr_received === '')
      ctx.addIssue({ code: 'custom', path: ['pkr_received'], message: 'Enter the PKR that reached the project account' })
  })

type FormValues = z.input<typeof schema>
type Parsed = z.output<typeof schema>

export function PaymentDialog({
  open,
  onOpenChange,
  bookingId,
  bookingCurrency,
  payment,
  defaults,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookingId: string
  bookingCurrency: Currency
  payment?: PaymentRow | null
  defaults?: Partial<FormValues>
}) {
  const partners = usePartners()
  const save = useSavePayment(bookingId)
  const remove = useDeletePayment(bookingId)
  const [file, setFile] = useState<File | null>(null)

  const form = useForm<FormValues, unknown, Parsed>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (!open) return
    setFile(null)
    const p = payment
    form.reset({
      kind: p?.kind ?? 'full',
      currency: p?.currency ?? bookingCurrency,
      amount_due: p?.amount_due ?? '',
      due_date: p?.due_date ?? '',
      status: p?.status ?? 'received',
      amount_received: p?.amount_received ?? '',
      received_date: p?.received_date ?? pkToday(),
      method: p?.method ?? '',
      received_by_partner_id: p?.received_by_partner_id ?? '',
      fx_rate: p?.fx_rate ?? '',
      pkr_received: p?.pkr_received ?? '',
      forwarded_date: p?.forwarded_date ?? '',
      notes: p?.notes ?? '',
      ...defaults,
    })
  }, [open, payment, bookingCurrency, defaults, form])

  const v = useWatch({ control: form.control })
  const isPayout = PAYOUT_KINDS.includes(v.kind as PaymentKind)
  const usd = v.currency === 'USD'
  const received = v.status === 'received'

  // PKR = USD x rate, filled in as the rate is typed (still editable)
  useEffect(() => {
    if (!usd || v.fx_rate === '' || v.amount_received === '' || v.fx_rate == null || v.amount_received == null) return
    const pkr = fromCents(roundCents(toCents(Number(v.amount_received)) * Number(v.fx_rate)))
    form.setValue('pkr_received', pkr)
  }, [usd, v.fx_rate, v.amount_received, form])

  async function onSubmit(x: Parsed) {
    const num = (n: number | '') => (n === '' ? null : n)
    try {
      const proof_path = file ? await uploadFile('proofs', file, bookingId) : payment?.proof_path ?? null
      await save.mutateAsync({
        id: payment?.id,
        kind: x.kind,
        currency: x.currency,
        amount_due: num(x.amount_due),
        due_date: x.due_date || null,
        status: x.status,
        amount_received: x.status === 'received' ? num(x.amount_received) : null,
        received_date: x.status === 'received' ? x.received_date || null : null,
        method: (x.method || null) as PaymentRow['method'],
        // direct money paid to a partner counts as received into the project account
        received_by_partner_id: isPayout ? x.received_by_partner_id || null : null,
        fx_rate: x.currency === 'USD' ? num(x.fx_rate) : null,
        pkr_received: x.currency === 'USD' ? num(x.pkr_received) : null,
        forwarded_date: isPayout && x.received_by_partner_id ? x.forwarded_date || null : null,
        notes: x.notes || null,
        proof_path,
      })
      toast.success('Payment saved')
      onOpenChange(false)
    } catch {
      // shown via save.error
    }
  }

  const err = form.formState.errors
  const effectiveRate =
    usd && v.pkr_received && v.amount_received ? Number(v.pkr_received) / Number(v.amount_received) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={payment ? 'Edit payment' : 'Record payment'}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid grid-cols-2 gap-4">
          <Field label="Type" htmlFor="kind" className="col-span-2">
            <Select id="kind" {...form.register('kind')}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {PAYMENT_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Currency" htmlFor="currency">
            <Select id="currency" {...form.register('currency')}>
              <option value="PKR">PKR</option>
              <option value="USD">USD</option>
            </Select>
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" {...form.register('status')}>
              {['scheduled', 'due', 'received', 'overdue', 'waived'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount due" htmlFor="amount_due" error={err.amount_due?.message}>
            <Input id="amount_due" type="number" inputMode="decimal" step="any" {...form.register('amount_due')} />
          </Field>
          <Field label="Due date" htmlFor="due_date">
            <Input id="due_date" type="date" {...form.register('due_date')} />
          </Field>

          {received && (
            <>
              <Field label={`Amount received (${v.currency})`} htmlFor="amount_received" error={err.amount_received?.message}>
                <Input id="amount_received" type="number" inputMode="decimal" step="any" {...form.register('amount_received')} />
              </Field>
              <Field label="Date received" htmlFor="received_date" error={err.received_date?.message}>
                <Input id="received_date" type="date" {...form.register('received_date')} />
              </Field>
              <Field label="Method" htmlFor="method">
                <Select id="method" {...form.register('method')}>
                  <option value="">-</option>
                  <option value="airbnb_payout">Airbnb payout</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                  <option value="jazzcash">JazzCash</option>
                  <option value="easypaisa">Easypaisa</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              {isPayout && (
                <Field label="Received by" htmlFor="received_by_partner_id" hint="The partner whose account the payout reached">
                  <Select id="received_by_partner_id" {...form.register('received_by_partner_id')}>
                    <option value="">Project account</option>
                    {partners.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {isPayout && v.received_by_partner_id && (
                <Field
                  label="Forwarded to project account on"
                  htmlFor="forwarded_date"
                  hint="Leave empty while the partner still holds it"
                  className="col-span-2"
                >
                  <Input id="forwarded_date" type="date" {...form.register('forwarded_date')} />
                </Field>
              )}
              {usd && (
                <>
                  <Field label="Rate (PKR per $)" htmlFor="fx_rate" error={err.fx_rate?.message}>
                    <Input id="fx_rate" type="number" inputMode="decimal" step="any" {...form.register('fx_rate')} />
                  </Field>
                  <Field label="PKR received" htmlFor="pkr_received" error={err.pkr_received?.message}>
                    <Input id="pkr_received" type="number" inputMode="decimal" step="any" {...form.register('pkr_received')} />
                  </Field>
                  {effectiveRate && (
                    <p className="col-span-2 -mt-2 text-xs text-muted-foreground">
                      Effective rate {effectiveRate.toFixed(2)} · {formatMoney(Number(v.pkr_received), 'PKR')}
                    </p>
                  )}
                </>
              )}
            </>
          )}

          <Field label="Proof (photo or PDF)" htmlFor="proof" className="col-span-2" hint={payment?.proof_path ? 'A proof is attached; choose a file to replace it' : undefined}>
            <Input
              id="proof"
              type="file"
              accept="image/*,application/pdf"
              className="py-2"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Field label="Notes" htmlFor="pnotes" className="col-span-2">
            <Textarea id="pnotes" {...form.register('notes')} />
          </Field>
          <div className="col-span-2">
            <ErrorNote error={save.error} />
          </div>
          <Button type="submit" size="lg" className="col-span-2" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save payment'}
          </Button>
          {payment && (
            <div className="col-span-2 flex justify-between gap-2">
              {payment.proof_path ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => openFile('proofs', payment.proof_path!).catch((e: Error) => toast.error(e.message))}
                >
                  View proof
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={async () => {
                  if (!window.confirm('Delete this payment? The owner can restore it from the audit log.')) return
                  await remove.mutateAsync(payment.id)
                  toast.success('Payment deleted')
                  onOpenChange(false)
                }}
              >
                Delete payment
              </Button>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}

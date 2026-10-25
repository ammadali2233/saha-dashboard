import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useInvalidateSales, useQuote } from './api'
import { useConflicts } from '@/features/bookings/api'
import { supabase } from '@/lib/supabase'
import { unwrap, useSettings } from '@/lib/queries'
import { ErrorNote, Loading, Money, PageHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Select, Textarea } from '@/components/ui/form-controls'
import { Input } from '@/components/ui/input'
import { addDays, nightsBetween, type LineKind } from '@/domain/booking'
import { pkToday } from '@/domain/format'
import { fromCents, toCents } from '@/domain/money'
import { DEFAULT_QUOTE_NOTES, defaultDeposit, quoteTotals } from '@/domain/quote'

type Line = { kind: LineKind; discount_subtype: string; label: string; qty: string; unit: string }
const NEG: LineKind[] = ['discount']
const lineAmount = (l: Line) => {
  const raw = fromCents(Math.round((toCents(Number(l.qty) || 0) * toCents(Number(l.unit) || 0)) / 100))
  return NEG.includes(l.kind) ? -Math.abs(raw) : Math.abs(raw)
}
const PRESETS: { label: string; line: (nights: number) => Line }[] = [
  {
    label: 'Nightly rate',
    line: (n) => ({
      kind: 'accommodation',
      discount_subtype: '',
      label: 'Nightly rate, full house',
      qty: String(n || 1),
      unit: '',
    }),
  },
  {
    label: 'Friends & family',
    line: (n) => ({
      kind: 'discount',
      discount_subtype: 'friends_family',
      label: 'Friends and family discount',
      qty: String(n || 1),
      unit: '',
    }),
  },
  {
    label: 'Special deal',
    line: () => ({
      kind: 'accommodation',
      discount_subtype: '',
      label: 'Special deal (half rent, single room)',
      qty: '1',
      unit: '',
    }),
  },
  {
    label: 'Extra mattress',
    line: () => ({ kind: 'extra_mattress', discount_subtype: '', label: 'Extra mattresses', qty: '1', unit: '' }),
  },
  {
    label: 'Cleaning',
    line: () => ({ kind: 'cleaning_fee', discount_subtype: '', label: 'Cleaning charges', qty: '1', unit: '1000' }),
  },
]

export function QuoteFormPage() {
  const { id } = useParams()
  const [search] = useSearchParams()
  const inquiryId = search.get('inquiry')
  const navigate = useNavigate()
  const settings = useSettings()
  const existing = useQuote(id)
  const invalidate = useInvalidateSales()
  const inquiry = useQuery({
    queryKey: ['inquiry', inquiryId],
    enabled: !!inquiryId && !id,
    queryFn: async () => unwrap(await supabase.from('inquiries').select('*, guests(name)').eq('id', inquiryId!).single()),
  })

  const [f, setF] = useState<Record<string, string>>({
    prepared_for: '',
    guest_id: '',
    issue_date: pkToday(),
    check_in: '',
    check_out: '',
    scope: 'full_house',
    guest_count: '',
    advance_pct: '',
    deposit_amount: '',
    valid_until: addDays(pkToday(), 7),
    notes: DEFAULT_QUOTE_NOTES,
  })
  const [lines, setLines] = useState<Line[]>([])
  const [depositTouched, setDepositTouched] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (loaded) return
    if (id && existing.data) {
      const q = existing.data.quote
      setF({
        prepared_for: q.prepared_for,
        guest_id: q.guest_id ?? '',
        issue_date: q.issue_date,
        check_in: q.check_in,
        check_out: q.check_out,
        scope: q.scope,
        guest_count: q.guest_count ? String(q.guest_count) : '',
        advance_pct: String(Number(q.advance_pct)),
        deposit_amount: String(Number(q.deposit_amount)),
        valid_until: q.valid_until ?? '',
        notes: q.notes ?? '',
      })
      setLines(
        existing.data.lines.map((l) => ({
          kind: l.kind,
          discount_subtype: l.discount_subtype ?? '',
          label: l.label,
          qty: String(Number(l.qty)),
          unit: String(Math.abs(Number(l.unit_amount))),
        })),
      )
      setDepositTouched(true)
      setLoaded(true)
    } else if (!id && settings.data && (!inquiryId || inquiry.data)) {
      const i = inquiry.data
      const n = i?.check_in && i?.check_out ? nightsBetween(i.check_in, i.check_out) : 0
      setF((x) => ({
        ...x,
        prepared_for: (i?.guests as { name: string } | null)?.name ?? '',
        guest_id: i?.guest_id ?? '',
        check_in: i?.check_in ?? '',
        check_out: i?.check_out ?? '',
        scope: i?.scope ?? 'full_house',
        guest_count: i?.guest_count ? String(i.guest_count) : '',
        advance_pct: String(Number(settings.data!.advance_pct)),
      }))
      setLines([PRESETS[0]!.line(n)])
      setLoaded(true)
    }
  }, [id, existing.data, settings.data, inquiry.data, inquiryId, loaded])

  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const nights = f.check_in && f.check_out && f.check_out > f.check_in ? nightsBetween(f.check_in, f.check_out) : 0
  const totals = useMemo(
    () =>
      quoteTotals({
        check_in: f.check_in || pkToday(),
        check_out: f.check_out || pkToday(),
        advance_pct: Number(f.advance_pct) || 0,
        deposit_amount: Number(f.deposit_amount) || 0,
        lines: lines.map((l) => ({ kind: l.kind, label: l.label, qty: Number(l.qty), unit_amount: 0, amount: lineAmount(l) })),
      }),
    [f, lines],
  )
  // deposit follows the total until someone types their own figure
  useEffect(() => {
    if (!depositTouched && settings.data) {
      setF((x) => ({ ...x, deposit_amount: String(defaultDeposit(totals.total, Number(settings.data!.deposit_pct))) }))
    }
  }, [totals.total, depositTouched, settings.data])

  const conflicts = useConflicts(f.check_in ?? '', f.check_out ?? '')
  const hard = conflicts.data?.filter((c) => c.is_hard) ?? []

  const save = useMutation({
    mutationFn: async () => {
      if (!f.prepared_for?.trim()) throw new Error('Who is this quote for?')
      if (!nights) throw new Error('Pick check-in and check-out dates')
      if (!lines.length || lines.some((l) => !l.label.trim() || !(Number(l.unit) >= 0) || l.unit === ''))
        throw new Error('Every charge needs a label and an amount')
      return unwrap(
        await supabase.rpc('save_quote', {
          p_quote: { ...f, id: id ?? '', inquiry_id: inquiryId ?? '' } as never,
          p_lines: lines.map((l) => ({
            kind: l.kind,
            discount_subtype: l.kind === 'discount' ? l.discount_subtype || 'custom' : '',
            label: l.label.trim(),
            qty: Number(l.qty),
            unit_amount: NEG.includes(l.kind) ? -Math.abs(Number(l.unit)) : Math.abs(Number(l.unit)),
            amount: lineAmount(l),
          })) as never,
        }),
      ) as string
    },
    onSuccess: (quoteId) => {
      invalidate()
      toast.success('Quote saved')
      navigate(`/quotes/${quoteId}`, { replace: true })
    },
  })

  if ((id && existing.isPending) || !loaded) return <Loading />
  return (
    <div className="flex flex-col gap-4 pb-24">
      <PageHeader title={id ? `Edit ${existing.data?.quote.number}` : 'New quote'} back={id ? `/quotes/${id}` : '/inquiries'} />
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2">
          <Field label="Prepared for" htmlFor="q_for">
            <Input id="q_for" value={f.prepared_for} onChange={set('prepared_for')} />
          </Field>
          <Field label="Quote date" htmlFor="q_date">
            <Input id="q_date" type="date" value={f.issue_date} onChange={set('issue_date')} />
          </Field>
          <Field label="Check-in" htmlFor="q_in">
            <Input id="q_in" type="date" value={f.check_in} onChange={set('check_in')} />
          </Field>
          <Field label="Check-out" htmlFor="q_out">
            <Input id="q_out" type="date" value={f.check_out} onChange={set('check_out')} />
          </Field>
          {hard.length > 0 && (
            <p role="alert" className="flex gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive sm:col-span-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> Not available: overlaps{' '}
              {hard.map((c) => c.label).join(', ')}.
            </p>
          )}
          <Field label="Scope" htmlFor="q_scope">
            <Select id="q_scope" value={f.scope} onChange={set('scope')}>
              <option value="full_house">Full house</option>
              <option value="single_room">Single room</option>
            </Select>
          </Field>
          <Field label="Guests" htmlFor="q_guests">
            <Input id="q_guests" type="number" inputMode="numeric" value={f.guest_count} onChange={set('guest_count')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Charges (PKR)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-6 gap-2 rounded-md border p-3">
              <Input
                aria-label="Label"
                className="col-span-6"
                value={l.label}
                onChange={(e) => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              <Input
                aria-label="Quantity"
                type="number"
                inputMode="decimal"
                className="col-span-2"
                value={l.qty}
                onChange={(e) => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
              />
              <Input
                aria-label={l.kind === 'discount' ? 'Discount per unit (PKR)' : 'Rate (PKR)'}
                placeholder={l.kind === 'discount' ? 'Discount' : 'Rate'}
                type="number"
                inputMode="decimal"
                className="col-span-3"
                value={l.unit}
                onChange={(e) => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove"
                onClick={() => setLines((xs) => xs.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden />
              </Button>
              <p className="col-span-6 text-right text-sm">
                <Money amount={lineAmount(l)} currency="PKR" />
              </p>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button key={p.label} variant="outline" size="sm" onClick={() => setLines((xs) => [...xs, p.line(nights)])}>
                <Plus aria-hidden /> {p.label}
              </Button>
            ))}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-y-1 border-t pt-3 text-sm">
            <dt>Subtotal</dt>
            <dd className="text-right">
              <Money amount={totals.subtotal} currency="PKR" />
            </dd>
            <dt>Discounts</dt>
            <dd className="text-right">
              <Money amount={totals.discounts} currency="PKR" />
            </dd>
            <dt className="font-semibold">Total payable</dt>
            <dd className="text-right font-semibold">
              <Money amount={totals.total} currency="PKR" />
            </dd>
            <dt className="text-muted-foreground">Advance / at check-in</dt>
            <dd className="text-right text-muted-foreground">
              <Money amount={totals.advance} currency="PKR" /> / <Money amount={totals.balance} currency="PKR" />
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-3">
          <Field label="Advance %" htmlFor="q_adv">
            <Input id="q_adv" type="number" inputMode="decimal" value={f.advance_pct} onChange={set('advance_pct')} />
          </Field>
          <Field label="Security deposit (PKR)" htmlFor="q_dep" hint="Not part of the total">
            <Input
              id="q_dep"
              type="number"
              inputMode="decimal"
              value={f.deposit_amount}
              onChange={(e) => {
                setDepositTouched(true)
                set('deposit_amount')(e)
              }}
            />
          </Field>
          <Field label="Valid until" htmlFor="q_valid">
            <Input id="q_valid" type="date" value={f.valid_until} onChange={set('valid_until')} />
          </Field>
          <Field label="Notes (one per line)" htmlFor="q_notes" className="sm:col-span-3">
            <Textarea id="q_notes" rows={3} value={f.notes} onChange={set('notes')} />
          </Field>
        </CardContent>
      </Card>

      <ErrorNote error={save.error} />
      <div className="fixed inset-x-0 bottom-16 z-10 border-t bg-background/95 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
        <Button size="lg" className="w-full md:w-auto" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save quote'}
        </Button>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { unwrap, usePartners } from '@/lib/queries'
import { ErrorNote, Money } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Select } from '@/components/ui/form-controls'
import { Input } from '@/components/ui/input'
import { formatDate, pkToday } from '@/domain/format'
import type { Currency } from '@/domain/format'

export interface PendingPayout {
  id: string
  guest: string
  amountDue: number
  currency: Currency
  dueDate: string | null
}

/**
 * Payouts that landed in a partner's account (e.g. Payoneer), early or on time. Once marked they are
 * "held by <partner>" and can be forwarded to the project account.
 */
export function MarkReceivedDialog({
  open,
  onOpenChange,
  pending,
  defaultPartnerId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  pending: PendingPayout[]
  defaultPartnerId: string | null
}) {
  const qc = useQueryClient()
  const partners = usePartners()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [partner, setPartner] = useState('')
  const [date, setDate] = useState(pkToday())
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    // nothing ticked: you pick exactly the ones that arrived
    setWasOpen(true)
    setSelected(new Set())
    setAmounts(Object.fromEntries(pending.map((p) => [p.id, String(p.amountDue)])))
    setPartner(defaultPartnerId ?? '')
    setDate(pkToday())
  }
  if (!open && wasOpen) setWasOpen(false)

  const chosen = pending.filter((p) => selected.has(p.id))
  const usd = chosen.filter((p) => p.currency === 'USD').reduce((a, p) => a + Math.round(Number(amounts[p.id] || 0) * 100), 0) / 100

  const save = useMutation({
    mutationFn: async () => {
      if (!chosen.length) throw new Error('Tick the payouts that arrived')
      if (!partner) throw new Error('Choose whose account it arrived in')
      return unwrap(
        await supabase.rpc('mark_payouts_received', {
          p_items: chosen.map((p) => ({ id: p.id, amount: Number(amounts[p.id]) })) as never,
          p_partner: partner,
          p_date: date,
        }),
      )
    },
    onSuccess: (n) => {
      for (const k of ['incoming', 'bookings', 'booking', 'overview_kpis', 'alerts', 'calendar']) qc.invalidateQueries({ queryKey: [k] })
      toast.success(`${n} payout${n === 1 ? '' : 's'} marked received. Forward them once the PKR reaches the project account.`)
      onOpenChange(false)
    },
  })

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Mark received in Payoneer"
        description="Tick the payouts that arrived, even if they came early. They then wait as 'held' until you forward them to the project account."
      >
        <div className="flex flex-col gap-4">
          <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm">
            {pending.map((p) => {
              const on = selected.has(p.id)
              return (
                <li key={p.id} className="flex min-h-11 items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={on}
                    onChange={() => toggle(p.id)}
                    aria-label={`${p.guest} arrived`}
                  />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggle(p.id)}>
                    <span className="block truncate">{p.guest}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.dueDate ? `expected ${formatDate(p.dueDate)}` : 'no expected date'}
                      {p.dueDate && p.dueDate > pkToday() && on ? ' · early' : ''}
                    </span>
                  </button>
                  {on ? (
                    <Input
                      aria-label={`Amount that arrived for ${p.guest} (${p.currency})`}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      className="h-9 w-28 text-right"
                      value={amounts[p.id] ?? ''}
                      onChange={(e) => setAmounts((a) => ({ ...a, [p.id]: e.target.value }))}
                    />
                  ) : (
                    <Money amount={p.amountDue} currency={p.currency} />
                  )}
                </li>
              )
            })}
          </ul>
          {chosen.length > 0 && (
            <p className="text-sm">
              {chosen.length} selected · <Money amount={usd} currency="USD" />. Adjust an amount if Airbnb paid a different figure.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Arrived in" htmlFor="mr_partner">
              <Select id="mr_partner" value={partner} onChange={(e) => setPartner(e.target.value)}>
                <option value="">Choose…</option>
                {partners.data?.map((pa) => (
                  <option key={pa.id} value={pa.id}>
                    {pa.name}'s account
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Arrived on" htmlFor="mr_date">
              <Input id="mr_date" type="date" value={date} max={pkToday()} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <ErrorNote error={save.error} />
          <Button size="lg" onClick={() => save.mutate()} disabled={save.isPending || !chosen.length}>
            {save.isPending ? 'Saving…' : `Mark ${chosen.length || ''} received`.replace('  ', ' ')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { unwrap } from '@/lib/queries'
import { ErrorNote, Money } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field } from '@/components/ui/form-controls'
import { Input } from '@/components/ui/input'
import { distributeForward, expectedPkr } from '@/domain/forward'
import { formatDate, pkToday } from '@/domain/format'

export interface HeldRow {
  id: string
  usd: number
  receivedDate: string
  guest: string
  partner: string
}

/**
 * One Payoneer withdrawal -> several held Airbnb payouts. Enter the rate and the PKR that actually
 * arrived; the PKR is split across the selected payouts in proportion to their USD.
 */
export function ForwardPayoutsDialog({ open, onOpenChange, held }: { open: boolean; onOpenChange: (o: boolean) => void; held: HeldRow[] }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rate, setRate] = useState('')
  const [total, setTotal] = useState('')
  const [totalTouched, setTotalTouched] = useState(false)
  const [date, setDate] = useState(pkToday())
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    // every time it opens: all held payouts ticked, fresh figures
    setWasOpen(true)
    setSelected(new Set(held.map((h) => h.id)))
    setRate('')
    setTotal('')
    setTotalTouched(false)
    setDate(pkToday())
  }
  if (!open && wasOpen) setWasOpen(false)

  const chosen = held.filter((h) => selected.has(h.id))
  const usd = chosen.reduce((a, h) => a + Math.round(h.usd * 100), 0) / 100
  const rateNum = Number(rate)
  const expected = rateNum > 0 ? expectedPkr(chosen, rateNum) : 0
  const totalNum = totalTouched ? Number(total) : expected
  const shares = useMemo(() => (totalNum > 0 && chosen.length ? distributeForward(chosen, totalNum) : []), [chosen, totalNum])
  const gap = totalTouched && rateNum > 0 ? Math.round((totalNum - expected) * 100) / 100 : 0
  const earliest = chosen.reduce((m, h) => (h.receivedDate > m ? h.receivedDate : m), '')

  const save = useMutation({
    mutationFn: async () => {
      if (!chosen.length) throw new Error('Select at least one payout')
      if (!(rateNum > 0)) throw new Error('Enter the rate you received')
      if (!(totalNum > 0)) throw new Error('Enter the total PKR that reached the project account')
      if (date < earliest) throw new Error(`The date can't be before a payout was received (${formatDate(earliest)})`)
      return unwrap(
        await supabase.rpc('forward_payouts', {
          p_items: shares.map((s) => ({ id: s.id, pkr: s.pkr })) as never,
          p_rate: rateNum,
          p_total: totalNum,
          p_date: date,
        }),
      )
    },
    onSuccess: (n) => {
      for (const k of ['incoming', 'bookings', 'booking', 'ledger', 'partner_capital', 'overview_kpis', 'alerts']) qc.invalidateQueries({ queryKey: [k] })
      toast.success(`${n} payout${n === 1 ? '' : 's'} forwarded to the project account`)
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
        title="Forward to project account"
        description="One withdrawal covering several payouts: enter the rate and the PKR that arrived, and it is split across them by their USD."
      >
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">
                {chosen.length} of {held.length} payouts · <Money amount={usd} currency="USD" />
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(chosen.length === held.length ? new Set() : new Set(held.map((h) => h.id)))}
              >
                {chosen.length === held.length ? 'Select none' : 'Select all'}
              </Button>
            </div>
            <ul className="max-h-64 divide-y overflow-y-auto rounded-md border text-sm">
              {held.map((h) => {
                const share = shares.find((s) => s.id === h.id)
                return (
                  <li key={h.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2">
                      <input type="checkbox" className="size-5" checked={selected.has(h.id)} onChange={() => toggle(h.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{h.guest}</span>
                        <span className="block text-xs text-muted-foreground">
                          held by {h.partner} since {formatDate(h.receivedDate)}
                        </span>
                      </span>
                      <span className="text-right">
                        <Money amount={h.usd} currency="USD" />
                        {share && (
                          <span className="block text-xs text-muted-foreground">
                            → <Money amount={share.pkr} currency="PKR" />
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Rate received (PKR per $)" htmlFor="fw_rate">
              <Input id="fw_rate" type="number" inputMode="decimal" step="any" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
            <Field label="Total PKR received" htmlFor="fw_total" hint={totalTouched ? undefined : 'Filled from the rate; change it to the bank amount'}>
              <Input
                id="fw_total"
                type="number"
                inputMode="decimal"
                step="any"
                value={totalTouched ? total : expected ? String(expected) : ''}
                onChange={(e) => {
                  setTotalTouched(true)
                  setTotal(e.target.value)
                }}
              />
            </Field>
            <Field label="Reached the project account on" htmlFor="fw_date" className="col-span-2">
              <Input id="fw_date" type="date" value={date} max={pkToday()} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          {totalNum > 0 && chosen.length > 0 && (
            <p className="rounded-md bg-muted p-3 text-sm">
              <Money amount={usd} currency="USD" /> → <strong><Money amount={totalNum} currency="PKR" /></strong> (effective{' '}
              {(totalNum / usd).toFixed(2)} per $).
              {gap !== 0 && (
                <>
                  {' '}
                  That is <Money amount={gap} currency="PKR" /> against {rateNum} × USD: fees or rounding. The actual PKR is what counts.
                </>
              )}
            </p>
          )}

          <ErrorNote error={save.error} />
          <Button size="lg" onClick={() => save.mutate()} disabled={save.isPending || !chosen.length}>
            {save.isPending ? 'Saving…' : `Forward ${chosen.length} payout${chosen.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

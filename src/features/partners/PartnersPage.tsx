import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { unwrap, usePartners } from '@/lib/queries'
import { useAuth } from '@/app/auth'
import { EmptyState, ErrorNote, Loading, Money, PageHeader, Stat } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Select, Textarea } from '@/components/ui/form-controls'
import { Input } from '@/components/ui/input'
import { formatDate, pkToday } from '@/domain/format'

const pct = (x: number | null | undefined, digits = 1) => (x == null ? '-' : `${(Number(x) * 100).toFixed(digits)}%`)

const TYPE_LABEL = { contribution: 'Contribution', distribution: 'Distribution', capital_return: 'Capital return' } as const

export function PartnersPage() {
  const { member } = useAuth()
  const isOwner = member?.role === 'owner'
  const [open, setOpen] = useState(false)

  const capital = useQuery({
    queryKey: ['partner_capital'],
    queryFn: async () => unwrap(await supabase.from('partner_capital').select('*').order('sort_order')),
  })
  const movements = useQuery({
    queryKey: ['capital_movements'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('capital_movements')
          .select('id, movement_date, type, amount, mode, notes, partners(name)')
          .is('deleted_at', null)
          .order('movement_date', { ascending: false }),
      ),
  })

  if (capital.isPending) return <Loading />
  const rows = capital.data ?? []
  const profit = Number(rows[0]?.realized_net_profit ?? 0)
  const invested = rows.reduce((a, r) => a + Number(r.total_invested), 0)
  const distributed = rows.reduce((a, r) => a + Number(r.distributions), 0)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Partners"
        actions={
          isOwner && (
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden /> Capital movement
            </Button>
          )
        }
      />
      <ErrorNote error={capital.error} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Total invested">
          <Money amount={invested} currency="PKR" />
        </Stat>
        <Stat label="Realized net profit to date" hint="Cash received - paid operating costs">
          <Money amount={profit} currency="PKR" />
        </Stat>
        <Stat label="Distributed">
          <Money amount={distributed} currency="PKR" />
        </Stat>
        {/* (distributions + undistributed) / invested = realized profit / invested */}
        <Stat label="Capital recovered">{invested > 0 ? pct(profit / invested) : '-'}</Stat>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <Card key={r.partner_id}>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between">
                {r.name}
                <span className="text-sm font-normal text-muted-foreground">{Number(r.agreed_share_pct)}% share</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Cash contributed</dt>
                <dd className="text-right">
                  <Money amount={r.cash_contributed} currency="PKR" />
                </dd>
                <dt className="text-muted-foreground">Setup paid personally</dt>
                <dd className="text-right">
                  <Money amount={r.setup_paid_personally} currency="PKR" />
                </dd>
                {Number(r.capital_returned) > 0 && (
                  <>
                    <dt className="text-muted-foreground">Capital returned</dt>
                    <dd className="text-right">
                      <Money amount={-Number(r.capital_returned)} currency="PKR" />
                    </dd>
                  </>
                )}
                <dt className="font-medium">Total invested</dt>
                <dd className="text-right font-medium">
                  <Money amount={r.total_invested} currency="PKR" />
                </dd>
                <dt className="text-muted-foreground">Share of capital</dt>
                <dd className="text-right">{pct(r.capital_pct)}</dd>
                {Number(r.shortfall_to_equal) > 0 && (
                  <>
                    <dt className="text-amber-700 dark:text-amber-300">To match equal share</dt>
                    <dd className="text-right text-amber-700 dark:text-amber-300">
                      <Money amount={r.shortfall_to_equal} currency="PKR" />
                    </dd>
                  </>
                )}
                <dt className="mt-2 border-t pt-2 text-muted-foreground">Profit share</dt>
                <dd className="mt-2 border-t pt-2 text-right">
                  <Money amount={r.profit_share} currency="PKR" />
                </dd>
                <dt className="text-muted-foreground">Distributions</dt>
                <dd className="text-right">
                  <Money amount={r.distributions} currency="PKR" />
                </dd>
                <dt className="font-medium">Undistributed</dt>
                <dd className="text-right font-medium">
                  <Money amount={r.undistributed} currency="PKR" />
                </dd>
                {Number(r.reimbursements_owed) > 0 && (
                  <>
                    <dt className="text-muted-foreground">Owed for expenses</dt>
                    <dd className="text-right">
                      <Money amount={r.reimbursements_owed} currency="PKR" />
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">Capital recovered</dt>
                <dd className="text-right">{pct(r.capital_recovered_pct)}</dd>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Capital movements</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorNote error={movements.error} />
          {movements.data?.length ? (
            <ul className="divide-y text-sm">
              {movements.data.map((m) => (
                <li key={m.id} className="flex justify-between gap-3 py-2">
                  <span>
                    {m.partners?.name} · {TYPE_LABEL[m.type]}
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(m.movement_date)}
                      {m.mode ? ` · ${m.mode}` : ''}
                      {m.notes ? ` · ${m.notes}` : ''}
                    </span>
                  </span>
                  <Money amount={m.type === 'contribution' ? m.amount : -Number(m.amount)} currency="PKR" />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No capital movements yet">Contributions arrive with the sheet import.</EmptyState>
          )}
        </CardContent>
      </Card>

      {isOwner && <MovementDialog open={open} onOpenChange={setOpen} />}
    </div>
  )
}

function MovementDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const partners = usePartners()
  const qc = useQueryClient()
  const [values, setValues] = useState({
    partner_id: '',
    type: 'distribution' as keyof typeof TYPE_LABEL,
    amount: '',
    movement_date: pkToday(),
    mode: '',
    notes: '',
  })
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }))

  const save = useMutation({
    mutationFn: async () => {
      if (!values.partner_id) throw new Error('Pick a partner')
      const amount = Number(values.amount)
      if (!(amount > 0)) throw new Error('Enter an amount above 0')
      return unwrap(
        await supabase
          .from('capital_movements')
          .insert({
            partner_id: values.partner_id,
            type: values.type,
            amount,
            movement_date: values.movement_date,
            mode: values.mode || null,
            notes: values.notes || null,
          })
          .select('id')
          .single(),
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner_capital'] })
      qc.invalidateQueries({ queryKey: ['capital_movements'] })
      qc.invalidateQueries({ queryKey: ['ledger'] })
      toast.success('Recorded')
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Capital movement" description="Distributions reduce undistributed profit and the project account, never ownership.">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Partner" htmlFor="m_partner" className="col-span-2">
            <Select id="m_partner" value={values.partner_id} onChange={set('partner_id')}>
              <option value="">Choose…</option>
              {partners.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type" htmlFor="m_type">
            <Select id="m_type" value={values.type} onChange={set('type')}>
              {Object.entries(TYPE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (PKR)" htmlFor="m_amount">
            <Input id="m_amount" type="number" inputMode="decimal" value={values.amount} onChange={set('amount')} />
          </Field>
          <Field label="Date" htmlFor="m_date">
            <Input id="m_date" type="date" value={values.movement_date} onChange={set('movement_date')} />
          </Field>
          <Field label="Mode" htmlFor="m_mode">
            <Input id="m_mode" placeholder="Bank transfer, cash…" value={values.mode} onChange={set('mode')} />
          </Field>
          <Field label="Notes" htmlFor="m_notes" className="col-span-2">
            <Textarea id="m_notes" value={values.notes} onChange={set('notes')} />
          </Field>
          <div className="col-span-2">
            <ErrorNote error={save.error} />
          </div>
          <Button size="lg" className="col-span-2" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Record'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Paperclip, Plus } from 'lucide-react'
import { useExpenses, useLedger, useVendorBalances } from './api'
import { usePartners } from '@/lib/queries'
import { EmptyState, ErrorNote, Loading, Money, PageHeader, Stat, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate, pkToday } from '@/domain/format'
import { cn } from '@/lib/utils'

const TABS = [
  ['operating', 'Operating'],
  ['setup', 'Setup costs'],
  ['account', 'Project account'],
] as const
type Tab = (typeof TABS)[number][0]

export function MoneyPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'operating'

  return (
    <div>
      <PageHeader
        title="Money"
        actions={
          <Button asChild>
            <Link to={`/money/expenses/new?kind=${tab === 'setup' ? 'setup' : 'operating'}`}>
              <Plus aria-hidden /> Expense
            </Link>
          </Button>
        }
      />
      <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setParams({ tab: key }, { replace: true })}
            className={cn(
              'h-10 flex-1 whitespace-nowrap rounded-md px-3 text-sm',
              tab === key ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'operating' && <OperatingTab />}
      {tab === 'setup' && <SetupTab />}
      {tab === 'account' && <AccountTab />}
    </div>
  )
}

function usePartnerName() {
  const partners = usePartners()
  return (id: string | null) => (id ? (partners.data?.find((p) => p.id === id)?.name ?? 'Partner') : 'Project account')
}

function OperatingTab() {
  const [params, setParams] = useSearchParams()
  const month = params.get('month') ?? pkToday().slice(0, 7)
  const q = useExpenses('operating')
  const partnerName = usePartnerName()

  const rows = useMemo(() => (q.data ?? []).filter((e) => e.expense_date.startsWith(month)), [q.data, month])
  const byCategory = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of rows) m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])
  const owed = (q.data ?? []).filter((e) => e.paid_by_partner_id && e.reimbursable && !e.reimbursed_date && e.status === 'paid')

  if (q.isPending) return <Loading />
  return (
    <div className="flex flex-col gap-4">
      <ErrorNote error={q.error} />
      <div className="flex items-center gap-3">
        <label htmlFor="month" className="text-sm text-muted-foreground">
          Month
        </label>
        <input
          id="month"
          type="month"
          value={month}
          onChange={(e) => setParams({ tab: 'operating', month: e.target.value }, { replace: true })}
          className="h-11 rounded-md border bg-card px-3"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Total this month">
          <Money amount={rows.reduce((a, e) => a + Number(e.amount), 0)} currency="PKR" />
        </Stat>
        <Stat label="Still due">
          <Money amount={rows.filter((e) => e.status === 'due').reduce((a, e) => a + Number(e.amount), 0)} currency="PKR" />
        </Stat>
        <Stat label="Owed back to partners" hint="Paid personally, not yet reimbursed">
          <Money amount={owed.reduce((a, e) => a + Number(e.amount), 0)} currency="PKR" />
        </Stat>
      </div>

      {byCategory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>By category</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {byCategory.map(([cat, amt]) => (
                <li key={cat} className="flex justify-between py-1.5">
                  <span>{cat}</span>
                  <Money amount={amt} currency="PKR" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No operating expenses this month">Rent and bills appear here once added.</EmptyState>
      ) : (
        <ExpenseList rows={rows} partnerName={partnerName} />
      )}

      {owed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Reimbursements owed</CardTitle>
          </CardHeader>
          <CardContent>
            <ExpenseList rows={owed} partnerName={partnerName} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SetupTab() {
  const q = useExpenses('setup')
  const vendors = useVendorBalances()
  const partnerName = usePartnerName()

  const byCategory = useMemo(() => {
    const m = new Map<string, { budget: number; actual: number }>()
    for (const e of q.data ?? []) {
      const cur = m.get(e.category) ?? { budget: 0, actual: 0 }
      cur.budget += Number(e.budget_amount ?? 0)
      cur.actual += Number(e.amount)
      m.set(e.category, cur)
    }
    return [...m.entries()]
  }, [q.data])
  const total = byCategory.reduce((a, [, v]) => ({ budget: a.budget + v.budget, actual: a.actual + v.actual }), { budget: 0, actual: 0 })

  if (q.isPending) return <Loading />
  return (
    <div className="flex flex-col gap-4">
      <ErrorNote error={q.error} />
      <p className="text-sm text-muted-foreground">Setup costs are capital: they stay out of the P&amp;L. Paid personally by a partner, they count as that partner's investment.</p>
      <Card>
        <CardHeader>
          <CardTitle>Budget vs actual</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">Category</th>
                <th className="py-1 text-right font-normal">Budget</th>
                <th className="py-1 text-right font-normal">Actual</th>
                <th className="py-1 text-right font-normal">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...byCategory, ['Total', total] as const].map(([cat, v]) => (
                <tr key={cat} className={cat === 'Total' ? 'font-semibold' : ''}>
                  <td className="py-1.5">{cat}</td>
                  <td className="py-1.5 text-right">
                    <Money amount={v.budget} currency="PKR" />
                  </td>
                  <td className="py-1.5 text-right">
                    <Money amount={v.actual} currency="PKR" />
                  </td>
                  <td className="py-1.5 text-right">
                    <Money amount={v.budget - v.actual} currency="PKR" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {(vendors.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Vendor balances</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {vendors.data?.map((v) => (
                <li key={v.vendor_quote_id} className="flex justify-between gap-3 py-2">
                  <span>
                    {v.vendor}
                    <span className="block text-xs text-muted-foreground">
                      Quoted <Money amount={v.quoted_amount} currency="PKR" />, paid <Money amount={v.paid} currency="PKR" />
                    </span>
                  </span>
                  <span className="text-right">
                    <Money amount={v.remaining} currency="PKR" />
                    {Number(v.remaining) < 0 && <Badge variant="warning" className="ml-2">overpaid: review</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {q.data?.length ? (
        <ExpenseList rows={q.data} partnerName={partnerName} />
      ) : (
        <EmptyState title="No setup costs yet">They arrive with the sheet import.</EmptyState>
      )}
    </div>
  )
}

function AccountTab() {
  const q = useLedger()
  if (q.isPending) return <Loading />
  const balance = q.data?.[0]?.balance ?? 0
  const KIND_LABEL: Record<string, string> = {
    contribution: 'Contribution',
    distribution: 'Distribution',
    capital_return: 'Capital return',
    revenue: 'Revenue',
    guest_refund: 'Guest refund',
    deposit_in: 'Deposit in',
    deposit_refund: 'Deposit refund',
    expense: 'Expense',
    reimbursement: 'Reimbursement',
  }
  return (
    <div className="flex flex-col gap-4">
      <ErrorNote error={q.error} />
      <Stat label="Project account balance" hint="Contributions + money received - expenses - reimbursements - distributions">
        <Money amount={balance} currency="PKR" />
      </Stat>
      {q.data?.length ? (
        <ul className="divide-y rounded-lg border bg-card text-sm">
          {q.data.map((e) => (
            <li key={`${e.source_table}-${e.source_id}-${e.kind}`} className="flex justify-between gap-3 p-3">
              <span className="min-w-0">
                <span className="font-medium">{KIND_LABEL[e.kind!] ?? e.kind}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {formatDate(e.entry_date!)} · {e.description}
                </span>
              </span>
              <span className="text-right">
                <Money amount={e.amount} currency="PKR" />
                <span className="block text-xs text-muted-foreground">
                  <Money amount={e.balance} currency="PKR" />
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No entries yet" />
      )}
    </div>
  )
}

type ExpenseRow = NonNullable<ReturnType<typeof useExpenses>['data']>[number]

function ExpenseList({ rows, partnerName }: { rows: ExpenseRow[]; partnerName: (id: string | null) => string }) {
  return (
    <ul className="divide-y rounded-lg border bg-card text-sm">
      {rows.map((e) => (
        <li key={e.id}>
          <Link to={`/money/expenses/${e.id}`} className="flex justify-between gap-3 p-3 hover:bg-muted/50">
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {e.item}
                {e.status === 'due' && <StatusBadge status="due" />}
                {e.receipt_path && <Paperclip className="size-3.5 text-muted-foreground" aria-label="Receipt attached" />}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {formatDate(e.expense_date)} · {e.category} · {partnerName(e.paid_by_partner_id)}
                {e.vendor ? ` · ${e.vendor}` : ''}
              </span>
            </span>
            <Money amount={e.amount} currency={e.currency} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

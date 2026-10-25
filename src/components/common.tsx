import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronLeft } from 'lucide-react'
import { formatMoney, type Currency } from '@/domain/format'
import { cn } from '@/lib/utils'
import { Badge } from './ui/badge'

export function PageHeader({
  title,
  back,
  actions,
  subtitle,
}: {
  title: string
  back?: string
  actions?: ReactNode
  subtitle?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-1">
        {back && (
          <Link to={back} aria-label="Back" className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted">
            <ChevronLeft className="size-5" aria-hidden />
          </Link>
        )}
        <div className="min-w-0 pt-1.5">
          <h1 className="truncate text-2xl font-semibold leading-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

/** Amount in its own currency; `estimate` adds the "est." label required for USD at the default rate. */
export function Money({
  amount,
  currency,
  estimate,
  className,
}: {
  amount: number | string | null | undefined
  currency: Currency
  estimate?: boolean
  className?: string
}) {
  if (amount == null || amount === '') return <span className={cn('text-muted-foreground', className)}>-</span>
  const n = Number(amount)
  return (
    <span className={cn('tabular-nums', n < 0 && 'text-destructive', className)}>
      {formatMoney(n, currency)}
      {estimate && <span className="ml-1 text-xs font-normal text-muted-foreground">est.</span>}
    </span>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-muted-foreground">{children}</div>}
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)
  return (
    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      {message}
    </p>
  )
}

export function Loading() {
  return <p className="py-8 text-center text-muted-foreground">Loading…</p>
}

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline'> = {
  tentative: 'outline',
  confirmed: 'info',
  in_house: 'success',
  completed: 'default',
  cancelled: 'danger',
  no_show: 'danger',
  fraud: 'danger',
  scheduled: 'outline',
  due: 'warning',
  overdue: 'danger',
  received: 'success',
  waived: 'default',
  paid: 'success',
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'default'}>{status.replace('_', ' ')}</Badge>
}

export function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{children}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

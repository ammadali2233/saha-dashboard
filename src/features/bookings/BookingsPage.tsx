import { Link, useSearchParams } from 'react-router'
import { AlertCircle, Plus } from 'lucide-react'
import { useBookings } from './api'
import { useChannels } from '@/lib/queries'
import { EmptyState, ErrorNote, Loading, Money, PageHeader, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/form-controls'
import { Badge } from '@/components/ui/badge'
import { formatDate, type Currency } from '@/domain/format'

const STATUSES = ['tentative', 'confirmed', 'in_house', 'completed', 'cancelled', 'no_show', 'fraud']
const TYPES = [
  ['standard', 'Standard'],
  ['partner_friends', 'Partner / friends'],
  ['promotional', 'Promotional'],
]

export function BookingsPage() {
  const [params, setParams] = useSearchParams()
  const filters = {
    status: params.get('status') ?? undefined,
    channelId: params.get('channel') ?? undefined,
    type: params.get('type') ?? undefined,
    month: params.get('month') ?? undefined,
  }
  const bookings = useBookings(filters)
  const channels = useChannels()

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <div>
      <PageHeader
        title="Bookings"
        actions={
          <Button asChild>
            <Link to="/bookings/new">
              <Plus aria-hidden /> New booking
            </Link>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select aria-label="Status" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </Select>
        <Select aria-label="Channel" value={filters.channelId ?? ''} onChange={(e) => setFilter('channel', e.target.value)}>
          <option value="">All channels</option>
          {channels.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Type" value={filters.type ?? ''} onChange={(e) => setFilter('type', e.target.value)}>
          <option value="">All types</option>
          {TYPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <input
          type="month"
          aria-label="Month"
          value={filters.month ?? ''}
          onChange={(e) => setFilter('month', e.target.value)}
          className="h-11 rounded-md border bg-card px-3 text-base"
        />
      </div>

      <ErrorNote error={bookings.error} />
      {bookings.isPending ? (
        <Loading />
      ) : bookings.data?.length === 0 ? (
        <EmptyState title="No bookings match">Change the filters, or add a booking.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {bookings.data?.map((b) => (
            <li key={b.booking_id}>
              <Link
                to={`/bookings/${b.booking_id}`}
                className="flex items-start gap-3 rounded-lg border bg-card p-3 hover:bg-muted/50"
              >
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: b.channel_color ?? undefined }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={b.status === 'cancelled' ? 'font-medium line-through opacity-60' : 'font-medium'}>
                      {b.guest_name ?? 'Guest details needed'}
                    </span>
                    <StatusBadge status={b.status!} />
                    {b.needs_details && (
                      <Badge variant="warning">
                        <AlertCircle className="size-3" aria-hidden /> needs details
                      </Badge>
                    )}
                    {b.booking_type !== 'standard' && <Badge variant="outline">{b.booking_type?.replace('_', ' / ')}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(b.check_in!)} to {formatDate(b.check_out!)} · {b.nights} night{b.nights === 1 ? '' : 's'} ·{' '}
                    {b.channel_name}
                    {b.ref ? ` · ${b.ref}` : ''}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <Money amount={b.net} currency={b.currency as Currency} className="font-medium" />
                  {b.currency === 'USD' && (
                    <div className="text-xs text-muted-foreground">
                      <Money amount={b.net_pkr} currency="PKR" estimate={!!b.pkr_is_estimate} />
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

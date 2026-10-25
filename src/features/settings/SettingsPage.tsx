import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate, formatMoney } from '@/domain/format'

export function SettingsPage() {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('*').single()
      if (error) throw error
      return data
    },
  })
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const { data, error } = await supabase.from('channels').select('*').is('deleted_at', null).order('name')
      if (error) throw error
      return data
    },
  })
  const partners = useQuery({
    queryKey: ['partners'],
    queryFn: async () => {
      const { data, error } = await supabase.from('partners').select('*').is('deleted_at', null).order('sort_order')
      if (error) throw error
      return data
    },
  })

  const s = settings.data
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {settings.error && <p className="text-destructive">Could not load settings: {settings.error.message}</p>}
      {s && (
        <Card>
          <CardHeader>
            <CardTitle>{s.property_name}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {s.brand} · {s.address}
            </p>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
              <Item label="Monthly rent" value={`${formatMoney(Number(s.monthly_rent), 'PKR')}, due on day ${s.rent_due_day}`} />
              <Item label="Lease start" value={formatDate(s.lease_start)} />
              <Item label="Live since" value={formatDate(s.go_live_date)} />
              <Item label="Default USD rate" value={`PKR ${Number(s.default_usd_pkr)} per $ (estimates only)`} />
              <Item label="Payment terms" value={`${s.advance_pct}% advance, ${s.balance_pct}% at check-in`} />
              <Item label="Security deposit" value={`${s.deposit_pct}%, refundable`} />
              <Item label="Check-in / check-out" value={`${s.check_in_time.slice(0, 5)} / ${s.check_out_time.slice(0, 5)}`} />
              <Item
                label="Airbnb payout"
                value={`Expected ${s.airbnb_payout_lag_days} day after check-in, overdue after ${s.overdue_threshold_days} days`}
              />
            </dl>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {channels.data?.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="size-3 rounded-full" style={{ background: c.color }} aria-hidden />
                <span className="flex-1 font-medium">{c.name}</span>
                <span className="text-muted-foreground">
                  {Number(c.platform_fee_pct)}% fee · {c.native_currency}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Partners</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {partners.data?.map((p) => (
              <li key={p.id} className="flex justify-between py-2 text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground">{Number(p.agreed_share_pct)}% agreed share</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

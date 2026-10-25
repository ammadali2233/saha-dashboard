import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { unwrap, useChannels, usePartners, useSettings } from '@/lib/queries'
import { useAuth } from '@/app/auth'
import { ErrorNote, Money } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Select } from '@/components/ui/form-controls'
import { Input } from '@/components/ui/input'
import { formatDate, formatTimestamp } from '@/domain/format'
import { IcalSettings } from './IcalSettings'

// ---------------------------------------------------------------- a small generic edit dialog
type FieldDef = {
  key: string
  label: string
  type?: 'text' | 'number' | 'date' | 'month' | 'time' | 'color' | 'email' | 'select' | 'checkbox'
  options?: [string, string][]
  hint?: string
}

function EditDialog({
  title,
  open,
  onClose,
  fields,
  initial,
  onSave,
}: {
  title: string
  open: boolean
  onClose: () => void
  fields: FieldDef[]
  initial: Record<string, unknown>
  onSave: (values: Record<string, string | boolean>) => Promise<unknown>
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [loaded, setLoaded] = useState(false)
  if (open && !loaded) {
    setLoaded(true)
    setValues(
      Object.fromEntries(
        fields.map((f) => {
          const v = initial[f.key]
          if (f.type === 'checkbox') return [f.key, !!v]
          if (f.type === 'month' && typeof v === 'string') return [f.key, v.slice(0, 7)]
          if (f.type === 'time' && typeof v === 'string') return [f.key, v.slice(0, 5)]
          return [f.key, v == null ? '' : String(v)]
        }),
      ),
    )
  }
  if (!open && loaded) setLoaded(false)
  const save = useMutation({ mutationFn: () => onSave(values), onSuccess: () => onClose() })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title}>
        <div className="grid grid-cols-2 gap-4">
          {fields.map((f) =>
            f.type === 'checkbox' ? (
              <label key={f.key} className="col-span-2 flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={!!values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.checked }))}
                />
                {f.label}
              </label>
            ) : (
              <Field key={f.key} label={f.label} htmlFor={`f_${f.key}`} hint={f.hint}>
                {f.type === 'select' ? (
                  <Select
                    id={`f_${f.key}`}
                    value={String(values[f.key] ?? '')}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  >
                    {f.options?.map(([val, label]) => (
                      <option key={val} value={val}>
                        {label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={`f_${f.key}`}
                    type={f.type ?? 'text'}
                    inputMode={f.type === 'number' ? 'decimal' : undefined}
                    step={f.type === 'number' ? 'any' : undefined}
                    value={String(values[f.key] ?? '')}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                )}
              </Field>
            ),
          )}
          <div className="col-span-2">
            <ErrorNote error={save.error} />
          </div>
          <Button size="lg" className="col-span-2" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const num = (v: unknown) => (v === '' || v == null ? null : Number(v))
const monthStart = (v: unknown) => (v ? `${String(v).slice(0, 7)}-01` : null)

// ---------------------------------------------------------------- page
export function SettingsPage() {
  const { member } = useAuth()
  const owner = member?.role === 'owner'
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-semibold">Settings</h1>
        {!owner && <p className="text-sm text-muted-foreground">Only the owner can change settings.</p>}
      </div>
      <PropertyCard owner={owner} />
      <RecurringCard owner={owner} />
      <ChannelsCard owner={owner} />
      <IcalSettings owner={owner} />
      <AutomationCard owner={owner} />
      <PeopleCard owner={owner} />
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Audit log</CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link to="/settings/audit">Open</Link>
          </Button>
        </CardHeader>
      </Card>
    </div>
  )
}

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <CardHeader className="flex-row items-center justify-between">
      <CardTitle>{title}</CardTitle>
      {action}
    </CardHeader>
  )
}

function PropertyCard({ owner }: { owner: boolean }) {
  const settings = useSettings()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const s = settings.data
  if (!s) return <ErrorNote error={settings.error} />
  return (
    <Card>
      <SectionHeader
        title={s.property_name}
        action={
          owner && (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              <Pencil aria-hidden /> Edit
            </Button>
          )
        }
      />
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          {s.brand} · {s.address}
        </p>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
          <Item
            label="Monthly rent"
            value={
              <>
                <Money amount={s.monthly_rent} currency="PKR" />, due on day {s.rent_due_day}
              </>
            }
          />
          <Item label="Lease start / live since" value={`${formatDate(s.lease_start)} / ${formatDate(s.go_live_date)}`} />
          <Item label="Default USD rate (estimates)" value={`PKR ${Number(s.default_usd_pkr)} per $`} />
          <Item
            label="Direct terms"
            value={`${s.advance_pct}% advance, ${s.balance_pct}% at check-in, ${s.deposit_pct}% deposit`}
          />
          <Item label="Check-in / check-out" value={`${s.check_in_time.slice(0, 5)} / ${s.check_out_time.slice(0, 5)}`} />
          <Item
            label="Airbnb payout"
            value={`Expected ${s.airbnb_payout_lag_days} day after check-in, overdue after ${s.overdue_threshold_days} days`}
          />
        </dl>
      </CardContent>
      <EditDialog
        title="Property and terms"
        open={open}
        onClose={() => setOpen(false)}
        initial={s}
        fields={[
          { key: 'property_name', label: 'Property name' },
          { key: 'brand', label: 'Brand' },
          { key: 'address', label: 'Address' },
          {
            key: 'default_usd_pkr',
            label: 'Default USD rate',
            type: 'number',
            hint: 'Only for estimates; payouts use their own rate',
          },
          { key: 'advance_pct', label: 'Advance %', type: 'number' },
          { key: 'deposit_pct', label: 'Security deposit %', type: 'number' },
          { key: 'check_in_time', label: 'Check-in time', type: 'time' },
          { key: 'check_out_time', label: 'Check-out time', type: 'time' },
          { key: 'airbnb_payout_lag_days', label: 'Payout lag (days)', type: 'number' },
          { key: 'overdue_threshold_days', label: 'Overdue after (days)', type: 'number' },
        ]}
        onSave={async (v) => {
          const advance = Number(v.advance_pct)
          unwrap(
            await supabase
              .from('settings')
              .update({
                property_name: String(v.property_name),
                brand: String(v.brand),
                address: String(v.address),
                default_usd_pkr: Number(v.default_usd_pkr),
                advance_pct: advance,
                balance_pct: 100 - advance,
                deposit_pct: Number(v.deposit_pct),
                check_in_time: String(v.check_in_time),
                check_out_time: String(v.check_out_time),
                airbnb_payout_lag_days: Number(v.airbnb_payout_lag_days),
                overdue_threshold_days: Number(v.overdue_threshold_days),
              })
              .eq('id', s.id)
              .select('id')
              .single(),
          )
          qc.invalidateQueries({ queryKey: ['settings'] })
          toast.success('Settings saved')
        }}
      />
    </Card>
  )
}

function RecurringCard({ owner }: { owner: boolean }) {
  const qc = useQueryClient()
  const partners = usePartners()
  const q = useQuery({
    queryKey: ['recurring_expenses'],
    queryFn: async () => unwrap(await supabase.from('recurring_expenses').select('*').is('deleted_at', null).order('category')),
  })
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  return (
    <Card>
      <SectionHeader title="Recurring bills" />
      <CardContent>
        <p className="mb-2 text-sm text-muted-foreground">
          The daily job creates each month's bill as "due" a week ahead. A template with no amount generates nothing.
        </p>
        <ErrorNote error={q.error} />
        <ul className="divide-y text-sm">
          {q.data?.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className="font-medium">{t.item}</span>
                <span className="block text-xs text-muted-foreground">
                  {t.category} · day {t.day_of_month}
                  {t.start_month ? ` · from ${formatDate(t.start_month).slice(2)}` : ''}
                  {!t.active && ' · paused'}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {t.amount ? <Money amount={t.amount} currency={t.currency} /> : <Badge variant="warning">no amount</Badge>}
                {owner && (
                  <Button variant="ghost" size="icon" aria-label={`Edit ${t.item}`} onClick={() => setEditing(t)}>
                    <Pencil aria-hidden />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
      <EditDialog
        title={String(editing?.item ?? 'Recurring bill')}
        open={!!editing}
        onClose={() => setEditing(null)}
        initial={editing ?? {}}
        fields={[
          { key: 'item', label: 'Name' },
          { key: 'amount', label: 'Amount (PKR)', type: 'number', hint: 'Leave empty to pause generation' },
          { key: 'day_of_month', label: 'Due day (1-28)', type: 'number' },
          { key: 'start_month', label: 'First month', type: 'month' },
          { key: 'end_month', label: 'Last month (optional)', type: 'month' },
          {
            key: 'default_paid_by_partner_id',
            label: 'Usually paid by',
            type: 'select',
            options: [['', 'Project account'], ...(partners.data ?? []).map((p) => [p.id, p.name] as [string, string])],
          },
          { key: 'active', label: 'Active', type: 'checkbox' },
        ]}
        onSave={async (v) => {
          unwrap(
            await supabase
              .from('recurring_expenses')
              .update({
                item: String(v.item),
                amount: num(v.amount),
                day_of_month: Number(v.day_of_month) || 1,
                start_month: monthStart(v.start_month),
                end_month: monthStart(v.end_month),
                default_paid_by_partner_id: (v.default_paid_by_partner_id as string) || null,
                active: !!v.active,
              })
              .eq('id', String(editing!.id))
              .select('id')
              .single(),
          )
          qc.invalidateQueries({ queryKey: ['recurring_expenses'] })
          toast.success('Saved. The next daily run creates any due bills.')
        }}
      />
    </Card>
  )
}

function ChannelsCard({ owner }: { owner: boolean }) {
  const channels = useChannels()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  return (
    <Card>
      <SectionHeader title="Channels" />
      <CardContent>
        <ul className="divide-y">
          {channels.data?.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="size-3 rounded-full" style={{ background: c.color }} aria-hidden />
              <span className="flex-1 font-medium">{c.name}</span>
              <span className="text-muted-foreground">
                {Number(c.platform_fee_pct)}% fee · {c.native_currency}
              </span>
              {owner && (
                <Button variant="ghost" size="icon" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                  <Pencil aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
      <EditDialog
        title={String(editing?.name ?? 'Channel')}
        open={!!editing}
        onClose={() => setEditing(null)}
        initial={editing ?? {}}
        fields={[
          {
            key: 'platform_fee_pct',
            label: 'Platform fee %',
            type: 'number',
            hint: 'Applies to new totals; actual fee lines override it',
          },
          {
            key: 'native_currency',
            label: 'Currency',
            type: 'select',
            options: [
              ['PKR', 'PKR'],
              ['USD', 'USD'],
            ],
          },
          { key: 'color', label: 'Calendar colour', type: 'color' },
        ]}
        onSave={async (v) => {
          unwrap(
            await supabase
              .from('channels')
              .update({
                platform_fee_pct: Number(v.platform_fee_pct),
                native_currency: v.native_currency as 'PKR' | 'USD',
                color: String(v.color),
              })
              .eq('id', String(editing!.id))
              .select('id')
              .single(),
          )
          qc.invalidateQueries({ queryKey: ['channels'] })
          toast.success('Channel saved')
        }}
      />
    </Card>
  )
}

function AutomationCard({ owner }: { owner: boolean }) {
  const qc = useQueryClient()
  const runs = useQuery({
    queryKey: ['sync_runs'],
    queryFn: async () => unwrap(await supabase.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(10)),
  })
  const run = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('roll_forward')),
    onSuccess: (counts) => {
      qc.invalidateQueries()
      toast.success(
        `Daily jobs ran: ${Object.entries(counts as Record<string, number>)
          .map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`)
          .join(', ')}`,
      )
    },
  })
  return (
    <Card>
      <SectionHeader
        title="Automation"
        action={
          owner && (
            <Button variant="outline" size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? 'Running…' : 'Run daily jobs now'}
            </Button>
          )
        }
      />
      <CardContent>
        <p className="mb-2 text-sm text-muted-foreground">
          Every night after 00:05 Karachi time: check-ins and check-outs roll forward, payments become due or overdue, booking
          tasks are created and recurring bills are generated. Calendar sync runs hourly.
        </p>
        <ErrorNote error={run.error ?? runs.error} />
        <ul className="divide-y text-sm">
          {runs.data?.map((r) => (
            <li key={r.id} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span>
                {r.job_name.replace(/_/g, ' ')}{' '}
                <Badge variant={r.result === 'ok' ? 'success' : r.result === 'error' ? 'danger' : 'outline'}>{r.result}</Badge>
              </span>
              <span className="text-muted-foreground">{formatTimestamp(r.started_at)}</span>
              {r.error && <span className="w-full text-xs text-destructive">{r.error}</span>}
            </li>
          ))}
          {runs.data?.length === 0 && <li className="py-2 text-muted-foreground">No runs yet.</li>}
        </ul>
      </CardContent>
    </Card>
  )
}

function PeopleCard({ owner }: { owner: boolean }) {
  const qc = useQueryClient()
  const users = useQuery({
    queryKey: ['app_users_all'],
    queryFn: async () =>
      unwrap(await supabase.from('app_users').select('*').is('deleted_at', null).order('role').order('display_name')),
  })
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const ROLES: [string, string][] = [
    ['partner', 'Partner'],
    ['staff', 'Staff (caretaker): calendar and tasks only'],
    ['owner', 'Owner'],
  ]
  return (
    <Card>
      <SectionHeader
        title="People and access"
        action={
          owner && (
            <Button variant="outline" size="sm" onClick={() => setEditing({ role: 'staff', active: true })}>
              <Plus aria-hidden /> Add
            </Button>
          )
        }
      />
      <CardContent>
        <p className="mb-2 text-sm text-muted-foreground">Only these emails can sign in. Deactivate someone to remove access.</p>
        <ul className="divide-y text-sm">
          {users.data?.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="font-medium">{u.display_name}</span>
                <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge variant={u.active ? 'default' : 'outline'}>{u.active ? u.role : 'inactive'}</Badge>
                {owner && (
                  <Button variant="ghost" size="icon" aria-label={`Edit ${u.display_name}`} onClick={() => setEditing(u)}>
                    <Pencil aria-hidden />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
      <EditDialog
        title={editing?.id ? String(editing.display_name) : 'Add a person'}
        open={!!editing}
        onClose={() => setEditing(null)}
        initial={editing ?? {}}
        fields={[
          { key: 'display_name', label: 'Name' },
          { key: 'email', label: 'Email (their Google account)', type: 'email' },
          { key: 'role', label: 'Role', type: 'select', options: ROLES },
          { key: 'active', label: 'Can sign in', type: 'checkbox' },
        ]}
        onSave={async (v) => {
          const values = {
            display_name: String(v.display_name).trim(),
            email: String(v.email).trim().toLowerCase(),
            role: v.role as 'owner' | 'partner' | 'staff',
            active: !!v.active,
          }
          if (!values.display_name || !values.email.includes('@')) throw new Error('Name and a valid email are required')
          if (editing?.id)
            unwrap(await supabase.from('app_users').update(values).eq('id', String(editing.id)).select('id').single())
          else unwrap(await supabase.from('app_users').insert(values).select('id').single())
          qc.invalidateQueries({ queryKey: ['app_users_all'] })
          qc.invalidateQueries({ queryKey: ['app_users'] })
          toast.success(
            editing?.id ? 'Saved' : 'Added. If they use Google sign-in, also add them as a test user in Google Cloud.',
          )
        }}
      />
    </Card>
  )
}

function Item({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

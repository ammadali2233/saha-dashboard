import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Link2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { unwrap, useChannels } from '@/lib/queries'
import { ErrorNote } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Select } from '@/components/ui/form-controls'
import { Input } from '@/components/ui/input'
import { formatTimestamp } from '@/domain/format'

/** 32 random bytes as URL-safe text; only its SHA-256 is stored. */
async function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return { token, hash }
}

export function IcalSettings({ owner }: { owner: boolean }) {
  return (
    <>
      <ImportCard owner={owner} />
      <ExportCard owner={owner} />
    </>
  )
}

function ImportCard({ owner }: { owner: boolean }) {
  const qc = useQueryClient()
  const channels = useChannels()
  const runs = useQuery({
    queryKey: ['sync_runs', 'ical'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('sync_runs')
          .select('*')
          .like('job_name', 'ical_%')
          .order('started_at', { ascending: false })
          .limit(20),
      ),
  })
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [url, setUrl] = useState('')

  const saveUrl = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('set_channel_ical_url', { p_channel: editing!.id, p_url: url.trim() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Calendar link saved. It syncs within the hour, or use Sync now.')
      setEditing(null)
      setUrl('')
    },
  })
  const syncNow = useMutation({
    mutationFn: async () => {
      const { data } = await supabase.auth.getSession()
      const res = await fetch('/api/ical-sync', {
        method: 'POST',
        headers: { authorization: `Bearer ${data.session?.access_token ?? ''}` },
      })
      if (!res.ok)
        throw new Error(
          res.status === 404 ? 'Sync runs on the deployed site (Netlify), not in local dev.' : `Sync failed (${res.status})`,
        )
      return res.json() as Promise<Record<string, Record<string, number | string>>>
    },
    onSuccess: (r) => {
      qc.invalidateQueries()
      const parts = Object.entries(r).map(([ch, c]) =>
        c.error ? `${ch}: ${c.error}` : `${ch}: ${c.created} new, ${c.updated} changed, ${c.holds_added} holds`,
      )
      toast.success(parts.length ? parts.join(' · ') : 'No calendar links set yet')
    },
  })

  const sync = channels.data?.filter((c) => c.code === 'airbnb' || c.code === 'booking_com') ?? []
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Calendar sync (import)</CardTitle>
        <Button variant="outline" size="sm" onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
          <RefreshCw className={syncNow.isPending ? 'animate-spin' : ''} aria-hidden /> Sync now
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Hourly. New Airbnb reservations arrive as bookings that need the guest and charges; Booking.com sends blocked dates only
          (shown as holds). A reservation that disappears is flagged "possibly cancelled", never cancelled automatically.
        </p>
        <ErrorNote error={syncNow.error ?? saveUrl.error} />
        <ul className="divide-y text-sm">
          {sync.map((c) => {
            const last = runs.data?.find((r) => r.job_name === `ical_${c.code}`)
            const counts = (last?.counts ?? {}) as Record<string, number>
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{c.name}</span>{' '}
                  {c.ical_configured ? (
                    <Badge variant="success">link set</Badge>
                  ) : (
                    <Badge variant="outline">no link (or set in Netlify)</Badge>
                  )}
                  {last && (
                    <span className="block text-xs text-muted-foreground">
                      Last sync {formatTimestamp(last.started_at)}:{' '}
                      {last.result === 'error' ? (
                        <span className="text-destructive">{last.error}</span>
                      ) : (
                        `${counts.events ?? 0} events, ${counts.created ?? 0} new, ${counts.updated ?? 0} changed, ${counts.possibly_cancelled ?? 0} possibly cancelled`
                      )}
                    </span>
                  )}
                </span>
                {owner && (
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ id: c.id, name: c.name })}>
                    <Link2 aria-hidden /> {c.ical_configured ? 'Replace link' : 'Set link'}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent
            title={`${editing.name} calendar link`}
            description="Paste the iCal export link from the platform. It is stored for the sync only and cannot be read back."
          >
            <div className="grid gap-4">
              <Field label="iCal link (https://…)" htmlFor="ical_url" hint="Leave empty and save to remove the link">
                <Input id="ical_url" type="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} />
              </Field>
              <ErrorNote error={saveUrl.error} />
              <Button size="lg" onClick={() => saveUrl.mutate()} disabled={saveUrl.isPending}>
                {saveUrl.isPending ? 'Saving…' : 'Save link'}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  )
}

function ExportCard({ owner }: { owner: boolean }) {
  const qc = useQueryClient()
  const tokens = useQuery({
    queryKey: ['feed_tokens'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('feed_tokens')
          .select('id, kind, label, created_at, revoked_at')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
      ),
  })
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'direct' | 'all'>('direct')
  const [label, setLabel] = useState('')
  const [created, setCreated] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: async () => {
      const { token, hash } = await newToken()
      unwrap(
        await supabase
          .from('feed_tokens')
          .insert({ kind, label: label.trim() || (kind === 'direct' ? 'Platforms' : 'Partner calendar'), token_hash: hash })
          .select('id')
          .single(),
      )
      return `${window.location.origin}/ical/${token}/${kind}.ics`
    },
    onSuccess: (link) => {
      qc.invalidateQueries({ queryKey: ['feed_tokens'] })
      setCreated(link)
    },
  })
  const revoke = useMutation({
    mutationFn: async (id: string) =>
      unwrap(
        await supabase.from('feed_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', id).select('id').single(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed_tokens'] })
      toast.success('Link revoked: it stops working immediately')
    },
  })

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Calendar feeds (export)</CardTitle>
        {owner && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCreated(null)
              setOpen(true)
            }}
          >
            New link
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          <strong>Direct feed</strong>: paste into Airbnb's and Booking.com's "import calendar" so direct bookings and owner
          blocks close those dates there. The platforms refresh imported calendars on their own schedule (often every few hours),
          so check the platform before accepting a direct booking for near dates. <strong>All bookings</strong>: subscribe in
          Google or Apple Calendar.
        </p>
        <ErrorNote error={tokens.error ?? revoke.error} />
        <ul className="divide-y">
          {tokens.data?.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{t.label}</span>{' '}
                <Badge variant="outline">{t.kind === 'direct' ? 'direct.ics' : 'all.ics'}</Badge>{' '}
                {t.revoked_at && <Badge variant="danger">revoked</Badge>}
                <span className="block text-xs text-muted-foreground">Created {formatTimestamp(t.created_at)}</span>
              </span>
              {owner && !t.revoked_at && (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => revoke.mutate(t.id)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
          {tokens.data?.length === 0 && <li className="py-2 text-muted-foreground">No feed links yet.</li>}
        </ul>
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="New calendar feed link"
          description="The link is shown once. Anyone with it can read the feed until you revoke it."
        >
          {created ? (
            <div className="grid gap-3">
              <Input readOnly value={created} onFocus={(e) => e.target.select()} aria-label="Feed link" />
              <Button
                size="lg"
                onClick={() =>
                  navigator.clipboard.writeText(created).then(
                    () => toast.success('Copied'),
                    () => toast.error('Copy failed: select and copy the link'),
                  )
                }
              >
                <Copy aria-hidden /> Copy link
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              <Field label="Feed" htmlFor="feed_kind">
                <Select id="feed_kind" value={kind} onChange={(e) => setKind(e.target.value as 'direct' | 'all')}>
                  <option value="direct">Direct bookings and blocks (for Airbnb / Booking.com)</option>
                  <option value="all">All bookings with guest names (for partners)</option>
                </Select>
              </Field>
              <Field label="Label" htmlFor="feed_label" hint="e.g. Airbnb import, Ammad's phone">
                <Input id="feed_label" value={label} onChange={(e) => setLabel(e.target.value)} />
              </Field>
              <ErrorNote error={create.error} />
              <Button size="lg" onClick={() => create.mutate()} disabled={create.isPending}>
                Create link
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// Token-protected calendar feeds.
//   /ical/<token>/direct.ics  direct bookings + owner/maintenance blocks, no guest names. Paste into
//                             Airbnb's and Booking.com's "import calendar" so direct stays block them.
//   /ical/<token>/all.ics     every booking with guest names, for partners' Google/Apple calendars.
// Tokens are random; only their SHA-256 is stored (feed_tokens), and the owner can revoke them.
import { createHash } from 'node:crypto'
import type { Config, Context } from '@netlify/functions'
import ical from 'ical-generator'
import { adminClient } from '../lib/supabase'

const ACTIVE = ['tentative', 'confirmed', 'in_house', 'completed'] as const

export default async (_req: Request, context: Context) => {
  const { token, feed } = context.params as { token?: string; feed?: string }
  const kind = feed === 'direct.ics' ? 'direct' : feed === 'all.ics' ? 'all' : null
  if (!token || !kind) return new Response('Not found', { status: 404 })

  const sb = adminClient()
  const hash = createHash('sha256').update(token).digest('hex')
  const { data: t } = await sb.from('feed_tokens').select('id').eq('token_hash', hash).eq('kind', kind).is('revoked_at', null).is('deleted_at', null).maybeSingle()
  if (!t) return new Response('Not found', { status: 404 })

  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  let bookingsQuery = sb
    .from('bookings')
    .select('id, ref, check_in, check_out, status, guest_count, channels!inner(code, name), guests(name)')
    .is('deleted_at', null)
    .in('status', ACTIVE)
    .gte('check_out', since)
  if (kind === 'direct') bookingsQuery = bookingsQuery.eq('channels.code', 'direct')
  const [bookings, blocks] = await Promise.all([
    bookingsQuery,
    sb.from('calendar_blocks').select('id, start_date, end_date, reason').is('deleted_at', null).neq('reason', 'channel_hold').gte('end_date', since),
  ])
  if (bookings.error || blocks.error) return new Response('Feed unavailable', { status: 500 })

  const cal = ical({ name: kind === 'direct' ? 'DHA Retreat (direct)' : 'DHA Retreat', prodId: { company: 'SAHA Residences', product: 'DHA Retreat Ops' }, ttl: 3600 })
  const day = (s: string) => new Date(`${s}T00:00:00Z`)

  for (const b of bookings.data ?? []) {
    const channel = b.channels as unknown as { code: string; name: string }
    const guest = (b.guests as unknown as { name: string } | null)?.name
    cal.createEvent({
      id: `booking-${b.id}@dha-retreat`,
      start: day(b.check_in),
      end: day(b.check_out),
      allDay: true,
      summary: kind === 'direct' ? 'Reserved' : `${guest ?? 'Guest'} (${channel.name})`,
      description: kind === 'direct' ? undefined : [b.ref, b.guest_count ? `${b.guest_count} guests` : null].filter(Boolean).join(' · ') || undefined,
    })
  }
  for (const k of blocks.data ?? []) {
    cal.createEvent({
      id: `block-${k.id}@dha-retreat`,
      start: day(k.start_date),
      end: day(k.end_date),
      allDay: true,
      summary: kind === 'direct' ? 'Not available' : k.reason === 'owner_use' ? 'Owner use' : 'Maintenance',
    })
  }

  return new Response(cal.toString(), {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300' },
  })
}

export const config: Config = { path: '/ical/:token/:feed' }

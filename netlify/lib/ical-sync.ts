// Runs the iCal import for every channel with a feed URL. Small, idempotent, logged in sync_runs.
import { adminClient } from './supabase'
import { dateChangeNote, parseFeed, planSync, type ChannelCode } from './ical'

const ENV_URL: Record<ChannelCode, string | undefined> = {
  airbnb: process.env.ICAL_AIRBNB_URL,
  booking_com: process.env.ICAL_BOOKING_COM_URL,
}

const pkToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export async function runIcalImport(trigger: 'schedule' | 'manual') {
  const sb = adminClient()
  const { data: channels, error } = await sb
    .from('channels')
    .select('id, code, channel_secrets(ical_url)')
    .in('code', ['airbnb', 'booking_com'])
    .is('deleted_at', null)
  if (error) throw new Error(error.message)

  const results: Record<string, unknown> = {}
  for (const ch of channels ?? []) {
    const code = ch.code as ChannelCode
    const secret = (ch.channel_secrets as unknown as { ical_url: string | null } | { ical_url: string | null }[] | null)
    const url = (Array.isArray(secret) ? secret[0]?.ical_url : secret?.ical_url) || ENV_URL[code]
    if (!url) continue
    results[code] = await syncChannel(sb, ch.id, code, url, trigger)
  }
  return results
}

async function syncChannel(sb: ReturnType<typeof adminClient>, channelId: string, code: ChannelCode, url: string, trigger: string) {
  const job = `ical_${code}`
  const { data: run } = await sb.from('sync_runs').insert({ job_name: job, counts: { trigger } }).select('id').single()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'DHA-Retreat-Ops/1.0' } })
    if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`)
    const events = parseFeed(await res.text(), code)
    const today = pkToday()

    const [bookings, holds, others, blocks] = await Promise.all([
      sb.from('bookings').select('id, ref, ical_uid, check_in, check_out, status, source, possibly_cancelled_at').eq('channel_id', channelId).is('deleted_at', null),
      sb.from('calendar_blocks').select('id, external_uid, start_date, end_date').eq('channel_id', channelId).eq('reason', 'channel_hold').is('deleted_at', null),
      sb.from('bookings').select('check_in, check_out').neq('channel_id', channelId).is('deleted_at', null).in('status', ['tentative', 'confirmed', 'in_house', 'completed']),
      sb.from('calendar_blocks').select('start_date, end_date').neq('reason', 'channel_hold').is('deleted_at', null),
    ])
    for (const r of [bookings, holds, others, blocks]) if (r.error) throw new Error(r.error.message)

    const plan = planSync({
      events,
      bookings: bookings.data!,
      holds: holds.data!,
      occupied: [
        ...others.data!.map((b) => ({ start: b.check_in, end: b.check_out })),
        ...blocks.data!.map((b) => ({ start: b.start_date, end: b.end_date })),
      ],
      today,
    })

    const fail = (e: { message: string } | null) => {
      if (e) throw new Error(e.message)
    }
    for (const ev of plan.create) {
      const { error } = await sb.from('bookings').insert({
        channel_id: channelId,
        ref: ev.code,
        ical_uid: ev.uid,
        ical_phone_last4: ev.phoneLast4,
        check_in: ev.start,
        check_out: ev.end,
        status: 'confirmed',
        source: 'ical',
        needs_details: true,
        notes: 'Created by the calendar sync: add the guest and charges.',
      })
      fail(error)
    }
    let datesChanged = 0
    for (const u of plan.update) {
      const before = bookings.data!.find((b) => b.id === u.id)!
      const note = dateChangeNote(before, u)
      if (note) datesChanged += 1
      const { error } = await sb
        .from('bookings')
        .update({
          check_in: u.check_in,
          check_out: u.check_out,
          ical_uid: u.ical_uid,
          ref: u.ref,
          ...(u.clearFlag ? { possibly_cancelled_at: null } : {}),
          // the sync never changes money: flag the booking so someone checks its charges
          ...(note ? { sync_changed_at: new Date().toISOString(), sync_change_note: note } : {}),
        })
        .eq('id', u.id)
      fail(error)
    }
    if (plan.flagMissing.length) {
      fail((await sb.from('bookings').update({ possibly_cancelled_at: new Date().toISOString() }).in('id', plan.flagMissing)).error)
    }
    if (plan.createHolds.length) {
      fail(
        (
          await sb.from('calendar_blocks').insert(
            plan.createHolds.map((h) => ({ start_date: h.start, end_date: h.end, reason: 'channel_hold' as const, source: 'ical' as const, channel_id: channelId, external_uid: h.uid, notes: h.summary })),
          )
        ).error,
      )
    }
    for (const h of plan.updateHolds) fail((await sb.from('calendar_blocks').update({ start_date: h.start, end_date: h.end }).eq('id', h.id)).error)
    if (plan.removeHolds.length) fail((await sb.from('calendar_blocks').update({ deleted_at: new Date().toISOString() }).in('id', plan.removeHolds)).error)

    const counts = {
      trigger,
      events: events.length,
      created: plan.create.length,
      updated: plan.update.length,
      dates_changed: datesChanged,
      possibly_cancelled: plan.flagMissing.length,
      holds_added: plan.createHolds.length,
      holds_updated: plan.updateHolds.length,
      holds_removed: plan.removeHolds.length,
      echoes_skipped: plan.echoes,
    }
    await sb.from('sync_runs').update({ result: 'ok', finished_at: new Date().toISOString(), counts }).eq('id', run!.id)
    return counts
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await sb.from('sync_runs').update({ result: 'error', finished_at: new Date().toISOString(), error: message }).eq('id', run!.id)
    return { error: message }
  }
}

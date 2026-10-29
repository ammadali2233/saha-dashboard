// Morning email for the owner and partners (08:00 Karachi): today's check-ins and check-outs, money
// due, alerts, and pending tasks. buildDigest is pure (unit-tested); gather/send talk to the outside.
import { formatDate, formatMoney, type Currency } from '../../src/domain/format'
import type { adminClient } from './supabase'

export interface DigestData {
  today: string
  appUrl: string
  checkIns: { guest: string; nights: number; channel: string }[]
  checkOuts: { guest: string; channel: string }[]
  moneyDue: { guest: string; label: string; amount: number; currency: Currency; due: string | null; overdue: boolean }[]
  alerts: { title: string; detail: string; severity: string }[]
  tasks: { title: string; due: string | null; guest: string | null; assignee: string | null; status: string }[]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const short = (d: string) => formatDate(d).replace(/ \d{4}$/, '')

export function taskBuckets(tasks: DigestData['tasks'], today: string) {
  const plus3 = new Date(Date.parse(today) + 3 * 86_400_000).toISOString().slice(0, 10)
  return {
    overdue: tasks.filter((t) => t.due && t.due < today),
    today: tasks.filter((t) => t.due === today),
    soon: tasks.filter((t) => t.due && t.due > today && t.due <= plus3),
  }
}

export function buildDigest(d: DigestData): { subject: string; html: string; text: string } {
  const tb = taskBuckets(d.tasks, d.today)
  const pendingTasks = tb.overdue.length + tb.today.length
  const subject = [
    `DHA Retreat · ${formatDate(d.today)}`,
    d.checkIns.length ? `${d.checkIns.length} check-in${d.checkIns.length > 1 ? 's' : ''}` : '',
    d.checkOuts.length ? `${d.checkOuts.length} check-out${d.checkOuts.length > 1 ? 's' : ''}` : '',
    pendingTasks ? `${pendingTasks} task${pendingTasks > 1 ? 's' : ''} due` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const money = (m: DigestData['moneyDue'][number]) => formatMoney(m.amount, m.currency)
  const taskLine = (t: DigestData['tasks'][number]) =>
    `${t.title}${t.guest ? ` (${t.guest})` : ''}${t.due ? `, ${t.due < d.today ? 'was due' : 'due'} ${short(t.due)}` : ''}${t.assignee ? `, ${t.assignee}` : ''}${t.status === 'blocked' ? ', blocked' : ''}`

  const sections: { title: string; lines: string[]; empty: string }[] = [
    { title: 'Check-ins today', lines: d.checkIns.map((c) => `${c.guest}, ${c.nights} night${c.nights === 1 ? '' : 's'} (${c.channel})`), empty: 'None' },
    { title: 'Check-outs today', lines: d.checkOuts.map((c) => `${c.guest} (${c.channel}): turnover clean`), empty: 'None' },
    {
      title: 'Tasks: overdue',
      lines: tb.overdue.map(taskLine),
      empty: 'Nothing overdue',
    },
    { title: 'Tasks: due today', lines: tb.today.map(taskLine), empty: 'Nothing due today' },
    { title: 'Tasks: next 3 days', lines: tb.soon.map(taskLine), empty: 'Nothing coming up' },
    {
      title: 'Money due',
      lines: d.moneyDue.map((m) => `${m.guest}: ${m.label} ${money(m)}${m.due ? `, ${m.overdue ? 'overdue since' : 'due'} ${short(m.due)}` : ''}`),
      empty: 'Nothing due',
    },
    { title: 'Alerts', lines: d.alerts.map((a) => `${a.title}: ${a.detail}`), empty: 'Nothing needs attention' },
  ]

  const text = [
    subject,
    '',
    ...sections.flatMap((s) => [s.title.toUpperCase(), ...(s.lines.length ? s.lines.map((l) => `- ${l}`) : [`- ${s.empty}`]), '']),
    `Open the dashboard: ${d.appUrl}`,
  ].join('\n')

  const html = `<!doctype html><html><body style="margin:0;background:#f4f2ec;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1d2a26">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:20px">
<tr><td>
<p style="margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6b66">SAHA Residences</p>
<h1 style="margin:4px 0 16px;font-size:20px;color:#1f3a34">DHA Retreat · ${esc(formatDate(d.today))}</h1>
${sections
  .map(
    (s) => `<h2 style="margin:16px 0 6px;font-size:14px;color:#1f3a34">${esc(s.title)}</h2>
${s.lines.length ? `<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.5">${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : `<p style="margin:0;font-size:14px;color:#5b6b66">${esc(s.empty)}</p>`}`,
  )
  .join('\n')}
<p style="margin:20px 0 0"><a href="${esc(d.appUrl)}" style="display:inline-block;background:#1f3a34;color:#f5ead2;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:14px">Open the dashboard</a></p>
</td></tr></table>
<p style="font-size:11px;color:#8a8f87;margin-top:12px">Sent every morning to the DHA Retreat partners.</p>
</td></tr></table></body></html>`

  return { subject, html, text }
}

// ---------------------------------------------------------------- gather and send
type Admin = ReturnType<typeof adminClient>

export async function gatherDigest(sb: Admin, today: string, appUrl: string): Promise<DigestData> {
  const plus3 = new Date(Date.parse(today) + 3 * 86_400_000).toISOString().slice(0, 10)
  const ok = <T>(r: { data: T | null; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message)
    return r.data as T
  }
  const [stays, payments, alerts, tasks, users] = await Promise.all([
    sb
      .from('booking_financials')
      .select('booking_id, guest_name, ref, channel_name, check_in, check_out, nights, status')
      .in('status', ['confirmed', 'in_house', 'completed'])
      .or(`check_in.eq.${today},check_out.eq.${today}`),
    sb
      .from('payment_facts')
      .select('kind, currency, amount_due, due_date, status, bookings(ref, status, guests(name))')
      .in('status', ['scheduled', 'due', 'overdue'])
      .in('kind', ['advance', 'balance', 'full', 'deposit_in'])
      .lte('due_date', today),
    sb.from('alerts').select('title, detail, severity, kind'),
    sb.from('tasks').select('title, due_date, status, booking_id, assignee_id').is('deleted_at', null).neq('status', 'done').lte('due_date', plus3).order('due_date'),
    sb.from('app_users').select('id, display_name'),
  ])
  const stayRows = ok(stays) ?? []
  const names = new Map((ok(users) ?? []).map((u) => [u.id, u.display_name]))
  const bookingIds = [...new Set((ok(tasks) ?? []).map((t) => t.booking_id).filter(Boolean))] as string[]
  const guests = bookingIds.length
    ? ok(await sb.from('booking_financials').select('booking_id, guest_name, ref').in('booking_id', bookingIds)) ?? []
    : []
  const guestOf = new Map(guests.map((g) => [g.booking_id, g.guest_name ?? g.ref]))
  const KIND: Record<string, string> = { advance: 'advance', balance: 'balance', full: 'payment', deposit_in: 'security deposit' }

  return {
    today,
    appUrl,
    checkIns: stayRows.filter((s) => s.check_in === today).map((s) => ({ guest: s.guest_name ?? s.ref ?? 'Guest', nights: s.nights ?? 0, channel: s.channel_name ?? '' })),
    checkOuts: stayRows.filter((s) => s.check_out === today).map((s) => ({ guest: s.guest_name ?? s.ref ?? 'Guest', channel: s.channel_name ?? '' })),
    moneyDue: (ok(payments) ?? [])
      .filter((p) => {
        const b = p.bookings as unknown as { status: string } | null
        return b && !['cancelled', 'no_show', 'fraud'].includes(b.status)
      })
      .map((p) => {
        const b = p.bookings as unknown as { ref: string | null; guests: { name: string } | null }
        return {
          guest: b.guests?.name ?? b.ref ?? 'Guest',
          label: KIND[p.kind!] ?? p.kind!,
          amount: Number(p.amount_due ?? 0),
          currency: p.currency as Currency,
          due: p.due_date,
          overdue: !!p.due_date && p.due_date < today,
        }
      }),
    // follow-ups and bills already appear in their own sections or are informational
    alerts: (ok(alerts) ?? []).filter((a) => a.kind !== 'balance_unpaid').map((a) => ({ title: a.title ?? '', detail: a.detail ?? '', severity: a.severity ?? 'info' })),
    tasks: (ok(tasks) ?? []).map((t) => ({
      title: t.title,
      due: t.due_date,
      guest: t.booking_id ? (guestOf.get(t.booking_id) ?? null) : null,
      assignee: t.assignee_id ? (names.get(t.assignee_id) ?? null) : null,
      status: t.status,
    })),
  }
}

export async function sendEmail(to: string, msg: { subject: string; html: string; text: string }) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.DIGEST_FROM
  if (!key || !from) throw new Error('RESEND_API_KEY and DIGEST_FROM are not set')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    // replies go to a real inbox (e.g. your Gmail) while the domain has no mailbox of its own
    body: JSON.stringify({ from, to: [to], subject: msg.subject, html: msg.html, text: msg.text, ...(process.env.DIGEST_REPLY_TO ? { reply_to: process.env.DIGEST_REPLY_TO } : {}) }),
  })
  if (!res.ok) throw new Error(`Email to ${to} failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
}

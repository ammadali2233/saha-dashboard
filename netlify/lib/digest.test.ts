import { describe, expect, it } from 'vitest'
import { buildDigest, taskBuckets, type DigestData } from './digest'

const data: DigestData = {
  today: '2026-11-07',
  appUrl: 'https://saha-dashboard.netlify.app',
  checkIns: [{ guest: 'Waseem', nights: 2, channel: 'Airbnb' }],
  checkOuts: [{ guest: 'Amin', channel: 'Airbnb' }],
  moneyDue: [{ guest: 'Wajeeh <Amir>', label: 'balance', amount: 73500, currency: 'PKR', due: '2026-11-05', overdue: true }],
  alerts: [{ title: 'Payout held by Ammad Ali', detail: 'Talha: 223.92 USD not yet forwarded', severity: 'warning' }],
  tasks: [
    { title: 'Buy throws', due: '2026-09-28', guest: null, assignee: 'Ammad Ali', status: 'blocked' },
    { title: 'Turnover clean after check-out', due: '2026-11-07', guest: 'Amin', assignee: null, status: 'todo' },
    { title: 'Confirm arrival time', due: '2026-11-08', guest: 'Asif', assignee: null, status: 'todo' },
    { title: 'Later task', due: '2026-11-20', guest: null, assignee: null, status: 'todo' },
  ],
}

describe('morning digest', () => {
  const d = buildDigest(data)

  it('subject sums up the day, counting overdue and today tasks', () => {
    expect(d.subject).toBe('DHA Retreat · 7 Nov 2026 · 1 check-in · 1 check-out · 2 tasks due')
  })

  it('lists pending tasks: overdue, today, next 3 days; later ones are left out', () => {
    expect(d.text).toContain('TASKS: OVERDUE\n- Buy throws, was due 28 Sep, Ammad Ali, blocked')
    expect(d.text).toContain('TASKS: DUE TODAY\n- Turnover clean after check-out (Amin), due 7 Nov')
    expect(d.text).toContain('TASKS: NEXT 3 DAYS\n- Confirm arrival time (Asif), due 8 Nov')
    expect(d.text).not.toContain('Later task')
    expect(taskBuckets(data.tasks, data.today).soon).toHaveLength(1)
  })

  it('shows check-ins, check-outs, money due and alerts', () => {
    expect(d.text).toContain('- Waseem, 2 nights (Airbnb)')
    expect(d.text).toContain('- Amin (Airbnb): turnover clean')
    expect(d.text).toContain('balance PKR 73,500, overdue since 5 Nov')
    expect(d.text).toContain('Payout held by Ammad Ali: Talha')
  })

  it('escapes names in the HTML version', () => {
    expect(d.html).toContain('Wajeeh &lt;Amir&gt;')
    expect(d.html).not.toContain('Wajeeh <Amir>')
  })

  it('says so when a section is empty', () => {
    const quiet = buildDigest({ ...data, checkIns: [], checkOuts: [], moneyDue: [], alerts: [], tasks: [] })
    expect(quiet.subject).toBe('DHA Retreat · 7 Nov 2026')
    expect(quiet.text).toContain('TASKS: DUE TODAY\n- Nothing due today')
  })
})

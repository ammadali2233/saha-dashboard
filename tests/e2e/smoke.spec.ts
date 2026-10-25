// Smoke: sign in with a magic link, add a booking, see it on the calendar.
// Runs against local Supabase; sign-in emails are read from the local Mailpit inbox.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const MAILPIT = 'http://127.0.0.1:55324'
const EMAIL = 'e2e-owner@test.local'

function sql(query: string) {
  const file = path.join(os.tmpdir(), `e2e-${process.pid}.sql`)
  fs.writeFileSync(file, query)
  execFileSync('npx', ['supabase', 'db', 'query', '--local', '-f', `"${file}"`], { shell: true, stdio: 'ignore' })
}

async function latestLink(email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`)).json()
    const id = list.messages?.[0]?.ID
    if (id) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()
      const link = (msg.Text as string).match(/https?:\/\/\S+verify\S+/)?.[0]
      if (link) return link
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`No sign-in email for ${email}`)
}

// a free range far in the future, different on every run
const day = 1 + (Date.now() % 25)
const checkIn = `2031-03-${String(day).padStart(2, '0')}`
const checkOut = `2031-03-${String(day + 2).padStart(2, '0')}`
const guest = `E2E Guest ${Date.now()}`

test.beforeAll(() => {
  sql(`insert into public.app_users (email, display_name, role) values ('${EMAIL}', 'E2E Owner', 'owner') on conflict do nothing;`)
  fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }).catch(() => {})
})

test.afterAll(() => {
  // auto-created tasks and payments reference the booking, so they go first
  sql(`do $$ begin
    delete from public.tasks where booking_id in (select b.id from public.bookings b join public.guests g on g.id = b.guest_id where g.name like 'E2E Guest %');
    delete from public.payments where booking_id in (select b.id from public.bookings b join public.guests g on g.id = b.guest_id where g.name like 'E2E Guest %');
    delete from public.bookings where guest_id in (select id from public.guests where name like 'E2E Guest %');
  end $$;`)
})

test('sign in, add a booking, see it on the calendar', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByText(`Check ${EMAIL}`)).toBeVisible()

  await page.goto(await latestLink(EMAIL))
  await expect(page.getByRole('heading', { name: /Salaam/ })).toBeVisible()

  await page.goto('/bookings/new')
  await page.getByLabel('Channel').selectOption({ label: 'Direct' })
  await page.getByLabel('Check-in', { exact: true }).fill(checkIn)
  await page.getByLabel('Check-out', { exact: true }).fill(checkOut)
  await page.getByLabel('Name').fill(guest)
  await page.getByLabel('Quantity').fill('2')
  await page.getByLabel('Unit amount in PKR').fill('15000')
  await expect(page.getByText('PKR 30,000').first()).toBeVisible()
  await page.getByRole('button', { name: 'Add booking' }).click()

  await expect(page.getByRole('heading', { name: guest })).toBeVisible()
  await expect(page.getByText(/D-2031-\d{3}/)).toBeVisible()

  await page.goto(`/calendar?date=${checkIn}`)
  await expect(page.getByText(`${guest} · 2n`).first()).toBeVisible()
})

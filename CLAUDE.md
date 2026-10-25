# DHA Retreat Ops Dashboard

Operations, bookings and partner accounts for **DHA Retreat** (DHA Phase 9, Lahore), managed under **SAHA Residences**. The old name "Bliss Haven" must not appear anywhere. 3 bedrooms (king, queen, two singles), sleeps 6, game room. Live since 5 Oct 2026. Owners: Ammad Ali (owner/admin of the app), Hamza Mahad Dar, Mohammed Azeem, Saad Raza.

## Stack
Vite + React 19 + TypeScript (strict) + Tailwind v4 + shadcn-style components (`src/components/ui`, hand-copied) · React Router v7 · TanStack Query · React Hook Form + Zod · date-fns / date-fns-tz · FullCalendar (MIT plugins only) · Recharts · Supabase (Postgres, Auth, RLS, Storage) · Netlify (SPA + Functions + Scheduled Functions) · node-ical / ical-generator · @react-pdf/renderer · Vitest · Playwright.

## Commands
```
npm run dev            # app on http://localhost:5173 (needs local Supabase)
npm run db:start       # local Supabase in Docker; ports 553xx (another project uses 543xx)
npm run db:reset       # re-apply all migrations + seed
npm run db:test        # pgTAP: RLS per role, integrity rules, view golden values
npm run db:types       # regenerate src/lib/database.types.ts after a migration
npm test               # Vitest: src/domain money/allocation/occupancy logic
npm run build          # tsc -b && vite build
npm run test:e2e       # Playwright smoke (needs db:start; reads sign-in mail from Mailpit on :55324)
npx tsx scripts/import-sheet/index.ts [--target linked] [--apply]   # sheet import, see README
npm run lint
```

## Layout
- `src/domain/` pure TS business rules (shared by UI previews and Netlify functions). Every rule has a Vitest test.
- `supabase/migrations/` the schema; SQL views are the reporting source of truth. Never edit an applied migration: add a new one.
- `supabase/tests/` pgTAP tests. `netlify/functions/` server jobs (service role key lives only here).
- `scripts/import-sheet/` one-off migration from the Google Sheet `.xlsx` export in `/import` (gitignored).

## Working rules
- Never commit secrets. `.env.example` holds names only. iCal URLs live in `channel_secrets` (no RLS policies, service role only) or env vars.
- Money logic is never guessed. If a rule is unclear or conflicts with the data, stop and ask Ammad.
- Every table: uuid `id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at`; call `public.track_table()` for row-meta + audit triggers. Business rows are soft-deleted; only the owner hard-deletes or restores.
- Amounts are `numeric(14,2)` with an explicit `currency` ('PKR' | 'USD'). Never store totals; derive them in views.
- New tables need RLS policies and a pgTAP policy test for owner, partner, staff and outsider.
- Staff never see financial data: enforced by RLS and the `staff_*` views, not just the UI.
- Small commits per feature. Each phase ends with tests green, a clean build, a Netlify deploy, and a manual-steps checklist for Ammad.

## Business rules
1. **Currency.** Every line and payment keeps its original currency. Reports are in PKR. A USD booking uses the actual `pkr_received` once its payout is logged; before that it uses `settings.default_usd_pkr` and the UI labels it "est.".
2. **Booking math.** Gross = accommodation + fees. Platform fee = channel % of gross unless an actual figure is entered (`is_actual_fee`). Net payout = gross + discounts (negative) + platform fee (negative). Direct bookings are PKR-native line items. Never store a booking total in a fee column.
3. **Three revenue states.** Booked: confirmed, stay not finished. Earned: stay completed (status `completed`). Realized: cash received, in PKR. Every "to date" KPI and every partner profit figure uses Earned or Realized, never Booked. Booked is shown separately as "On the books".
4. **Night allocation.** Each night belongs to the month it falls in. Accommodation revenue spreads evenly across nights (rounding remainder on the last night). Discounts and platform fees allocate pro-rata with the revenue they reduce. One-time fees land on the check-in date. 27 Dec to 10 Jan = 5 nights in December, 9 in January.
5. **Occupancy** = occupied nights / available nights in the period, counted as distinct dates, so it can never exceed 100%. Overlapping bookings or owner/maintenance blocks are a conflict: user saves are blocked with a clear message (DB trigger); iCal/import overlaps are recorded and shown red. Channel holds are soft: shown hatched, never occupancy, never blocking.
6. **Cancelled, no-show, fraud** are excluded from nights and revenue. A cancellation payout actually received (`payments.kind = cancellation_payout`) counts as revenue on its received date.
7. **Booking types.** `partner_friends` and `promotional` count in revenue and occupancy; a global filter excludes them from ADR and occupancy KPIs.
8. **Direct booking payments.** Advance % due on confirmation, balance due on check-in date. Security deposit is collected at check-in and is a liability, never revenue. A refund clears it. Any withheld portion becomes "Damage recovery" revenue on that date.
9. **Airbnb payouts.** Expected payout date = check-in + payout lag. Overdue when no payout is recorded after the overdue threshold. Payouts arrive in USD in a partner's account (`received_by_partner_id`); the partner forwards PKR to the project account. The rate is entered per transaction (no default). Revenue is realized on `forwarded_date` with the actual `pkr_received`. Received but not forwarded = "held by <partner>" alert. Partner keeps no fee.
10. **Expenses.** Setup costs are capital and stay out of the P&L. Operating expenses are P&L. Rent (PKR 150,000) accrues monthly on the 1st from a recurring template starting 1 Nov 2026 (the setup "Advance rent" covered 21 Sep to 31 Oct 2026). Utilities and staff salary templates exist with null amounts until Ammad fills them in.
11. **Who paid.** A setup cost paid personally by a partner counts as that partner's capital contribution. An operating expense paid personally by a partner is a reimbursable payable from the project account, not capital. Direct-guest money paid to a partner is treated as received into the project account.
12. **Ownership.** *(Changed from the brief by Ammad, 25 Oct 2026.)* Agreed share is fixed at 25% each (`partners.agreed_share_pct`) and drives profit share. Capital contributed % = partner total invested / all partners' total invested, where total invested = cash contributions + setup costs paid personally - capital returns. It is shown alongside, with each partner's shortfall to equal capital (Hamza is topping up). Computed live, with history.
13. **Profit share** = agreed share % × cumulative realized net profit (realized revenue - paid operating expenses). Distributions reduce the partner's undistributed balance and the project account, never ownership.
14. **Project account balance** = contributions + revenue received into the project account - expenses paid from it - reimbursements - distributions. Owner can enter the real bank balance on any date; show the difference.
15. **Capital recovered %** = (distributions + undistributed realized profit) / total invested. Payback projection from trailing 3-month realized profit.
16. **Display.** Dates `25 Oct 2026`; timezone Asia/Karachi everywhere (UTC+5, no DST; server runs UTC: use `pk_today()` in SQL and `pkToday()` in TS). Amounts `PKR 150,000` and `$40.00` (`src/domain/format.ts`).

## Interpretations (confirm or change with Ammad)
- Platform fee % applies to gross (accommodation + fees) before discounts, as rule 2 states.
- Tax lines are pass-through: shown, but not in gross, net or revenue.
- Occupancy: owner-use and maintenance nights are removed from available nights. With the rule 7 filter on, partner/promotional nights are removed from both occupied and available.
- Direct schedule: advance % and deposit % are of the booking's net total.
- Capital returns leave the project account like distributions. Deposits pass through the ledger (in at check-in, out on refund) so bank reconciliation matches; withheld deposits move no cash.
- Expenses in USD (rare) convert at `settings.default_usd_pkr`.
- Overview: occupancy, completed nights and ADR count nights from go-live (5 Oct 2026). "Operating costs this month" is by expense date (incurred), the cash P&L uses paid date.
- Performance budget: keep form/schema libraries, FullCalendar and date libraries out of the first load (lazy routes, `manualChunks`); the sign-in page must stay above 90 on Lighthouse mobile.

## Hard constraints
- No Airbnb API for individual hosts. Never scrape, log into, or automate airbnb.com. Automation = iCal feeds, Airbnb transaction CSV export, manual entry.
- Airbnb iCal: dates, "Reserved"/"Not available", reservation URL, guest phone last 4. No name, no price → new reservations arrive as `needs_details` stubs.
- Booking.com iCal: blocked dates only.
- Netlify scheduled functions: UTC cron, 30 s limit. Keep jobs small and idempotent, log to `sync_runs`. 00:05 Karachi = 19:05 UTC the previous day.

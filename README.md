# DHA Retreat Ops

One source of truth for DHA Retreat bookings, money and partner accounts (SAHA Residences). Mobile-first web app on Netlify + Supabase. Business rules and conventions: see [CLAUDE.md](CLAUDE.md).

## Local setup
Requirements: Node 22+, Docker Desktop running.

```bash
npm install
npm run db:start        # local Supabase on ports 553xx; prints URL and keys
cp .env.example .env    # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from db:start output
npm run dev
```

Sign-in emails locally land in Mailpit: http://127.0.0.1:55324. To let yourself in locally, add your email to the allowlist (next section) against the local DB (`postgresql://postgres:postgres@127.0.0.1:55322/postgres`).

Tests: `npm test` (domain logic and import), `npm run db:test` (RLS, views, overview), `npm run test:e2e` (Playwright smoke: sign in, add a booking, see it on the calendar), `npm run build`.

## How to add a partner (or caretaker)
Only emails on the allowlist can sign in. In the Supabase dashboard → SQL Editor:

```sql
insert into public.app_users (email, display_name, role)
values ('name@example.com', 'Full Name', 'partner');   -- role: owner | partner | staff

-- link a partner login to their capital record
update public.partners
set email = 'name@example.com',
    app_user_id = (select id from public.app_users where email = 'name@example.com')
where name = 'Full Name';
```
To remove access: `update public.app_users set active = false where email = '…';`

## Deployment
First-time account setup (Supabase, GitHub, Netlify, Google sign-in): [docs/SETUP.md](docs/SETUP.md).
- GitHub `main` → Netlify production; pull requests get deploy previews. Build settings are in `netlify.toml`.
- Netlify env vars: see `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` is for functions only, never `VITE_`-prefixed.
- Database changes: `npx supabase link --project-ref <ref>` once, then `npx supabase db push` to apply new migrations.
- Supabase Auth → URL Configuration: Site URL = the Netlify URL; add `https://<site>.netlify.app/**` and `https://deploy-preview-*--<site>.netlify.app/**` to redirect URLs.
- Supabase Auth → Hooks: enable "Before User Created" → Postgres function `public.hook_before_user_created`.

## Google Sheet import (one-off migration)
Put the sheet's `.xlsx` export in `/import` (gitignored, never committed). Decisions that involve guest data (direct-booking quote lines, advance dates, setup categories) live in `import/corrections.json`, also gitignored.

```bash
npx tsx scripts/import-sheet/index.ts                            # dry run against local Supabase
npx tsx scripts/import-sheet/index.ts --target linked            # dry run against the hosted project
npx tsx scripts/import-sheet/index.ts --target linked --apply    # import (refuses while anything is blocking)
```
Each run writes a reconciliation report and the SQL to `import/reports/`. Re-running is safe: rows are matched by `import_key` and updated in place, and rows removed from the sheet are soft-deleted. Edits made in the app to imported rows are overwritten by a re-run, so stop re-running once partners start editing.

## To be documented as features land
- Rotating iCal export tokens (Phase 2)
- Running the Airbnb CSV import (Phase 3)
- Restoring from a backup snapshot (Phase 3)

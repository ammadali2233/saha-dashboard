# First-time setup: Supabase, GitHub, Netlify, Google sign-in

Do these in order. Each step says what to send back to Claude. **Never paste keys or passwords into chat**: they go into Netlify's environment variables (and your local `.env`).

## 1. Supabase (database and sign-in)
1. Go to https://supabase.com and sign in with GitHub. Create an organization if asked (Free plan).
2. **New project**:
   - Name: `dha-retreat-ops`
   - Database password: click **Generate a password** and save it in your password manager. You need it once, in step 1.4.
   - Region: **Southeast Asia (Singapore)**, the closest to Lahore.
   - Click **Create new project** and wait about 2 minutes.
3. Find the **project ref**: it's the code in the browser address bar, `supabase.com/dashboard/project/<ref>`, and it also appears under Project Settings → General → Project ID. **Send this to Claude.**
4. Load the database schema. In the terminal in this folder, run each line:
   ```
   npx supabase login
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```
   `login` opens the browser to approve. `link` asks for the database password from step 1.2. `db push` creates all the tables, security rules and the partner allowlist. Answer `Y` when it lists the migrations.
5. **Turn on the allowlist hook.** This only works after step 1.4:
   - Open Authentication → **Hooks** → **Add hook** → **Before User Created**.
   - Hook type **Postgres**, schema `public`, function `hook_before_user_created`.
   - Click **Create hook**.
6. **Copy the keys you'll need for Netlify.** Keep this tab open:
   - Project Settings → **Data API**: copy the **Project URL** (`https://<ref>.supabase.co`).
   - Project Settings → **API Keys**: copy the **Publishable key** (`sb_publishable_…`) and the **Secret key** (`sb_secret_…`, click Reveal). The legacy `anon` and `service_role` keys also work.

## 2. GitHub (code)
1. Go to https://github.com/new.
2. Owner: your account. Repository name: `dha-retreat-ops`. Choose **Private**.
3. Leave README, .gitignore and license **unticked**, so the repo is empty.
4. Click **Create repository** and **send Claude the repo URL**, for example `https://github.com/<you>/dha-retreat-ops`.
5. Claude pushes the code. The first push opens a GitHub sign-in window from Git Credential Manager: approve it.

## 3. Netlify (hosting)
Do this after Claude confirms the push.
1. Go to https://app.netlify.com and sign up with GitHub.
2. **Add new project** → **Import an existing project** → **GitHub**.
3. Authorize Netlify. When GitHub asks which repositories, choose **Only select repositories** → `dha-retreat-ops`.
4. Pick the repo. The build settings are filled in automatically from `netlify.toml` (`npm run build`, publish `dist`), so don't change them.
5. Click **Add environment variables** on that same page and add:

   | Key | Value | Secret? |
   |---|---|---|
   | `VITE_SUPABASE_URL` | Project URL from 1.6 | no |
   | `VITE_SUPABASE_ANON_KEY` | Publishable key from 1.6 | no |
   | `SUPABASE_URL` | Project URL from 1.6 | no |
   | `SUPABASE_SERVICE_ROLE_KEY` | Secret key from 1.6 | **yes**: tick "Contains secret values" |

6. Click **Deploy**.
7. Rename the site: Project configuration → General → Project details → **Change project name** → `dha-retreat-ops` (or any free name). Your URL becomes `https://dha-retreat-ops.netlify.app`. **Send Claude the final URL.**

## 4. Supabase: tell it about the Netlify URL
Authentication → **URL Configuration**:
- Site URL: `https://dha-retreat-ops.netlify.app` (your URL from 3.7)
- Redirect URLs → **Add URL**, once for each of:
  - `https://dha-retreat-ops.netlify.app/**`
  - `https://deploy-preview-*--dha-retreat-ops.netlify.app/**`
  - `http://localhost:5173/**`

## 5. Google sign-in
This is the main sign-in for partners. Supabase's built-in email only delivers to members of your Supabase team, so email links will not reach the other partners until a custom email sender is set up.
1. Go to https://console.cloud.google.com, sign in as ammadali33@gmail.com, and click the project picker → **New project** → name `DHA Retreat Ops` → **Create**, then select it.
2. Menu → **Google Auth Platform** (APIs & Services → OAuth consent screen) → **Get started**:
   - App name `DHA Retreat Ops`, user support email: yours.
   - Audience: **External**.
   - Contact email: yours. Agree to the policy, then **Create**.
3. **Audience** → **Publish app** → Confirm. This only uses basic email and profile access, so Google doesn't need to review it. Without this step only listed test users can sign in.
4. **Clients** → **Create client**:
   - Application type **Web application**, name `Supabase`.
   - Authorized redirect URIs → **Add URI**: `https://<your-ref>.supabase.co/auth/v1/callback`
   - Click **Create**, then copy the **Client ID** and **Client secret**.
5. Back in Supabase: Authentication → **Sign In / Providers** → **Google** → enable it, paste the Client ID and Client secret → **Save**.
6. Test it: open your Netlify URL on your phone → **Continue with Google**. You should land on the Overview. Someone whose email isn't on the allowlist sees "not on the access list".

## Afterwards
- Add to home screen: in Chrome on Android, ⋮ → **Add to Home screen**. On iPhone Safari, Share → **Add to Home Screen**.
- Partner access is managed in the `app_users` table (see README, "How to add a partner").

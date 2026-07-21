# JJ Website

This project is now prepared for a lower-cost hosted setup:

- Cloudflare Pages serves the static website
- Cloudflare Pages Functions provide the `/api/*` sync endpoints
- Supabase stores shared cloud data

## Current pages

- `index.html`: multi-module home shell
- `finance.html`: integrated money and investment system
- `finance-system.js`: family ledger, accounts, goals, investment summaries, reports, and CSV workflows
- `finance-system.css`: styles isolated to the new money views
- `script.js`: finance board UI and sync client
- `fitness-sync.js`: fitness module sync bridge

## New Cloud sync files

- `functions/api/state.js`
- `functions/api/actions.js`
- `functions/api/modules/[moduleId].js`
- `functions/api/health.js`
- `functions/_shared/store.js`
- `functions/_shared/supabase.js`
- `_routes.json`
- `sync-auth.js`
- `supabase/schema.sql`

## Supabase setup

Create a Supabase project, then run:

- `supabase/schema.sql`

This creates:

- `public.app_documents`

The table stores:

- the finance board state
- each synced module state document

## Cloudflare Pages setup

Create a Pages project from this GitHub repository.

For a plain static HTML project with Pages Functions, use:

- Production branch: `main`
- Build command: `exit 0`
- Build output directory: `.`

Set these environment variables in Cloudflare Pages:

- `SUPABASE_URL`
  Example: `https://your-project-ref.supabase.co`
- `SUPABASE_SECRET_KEY`
  Recommended server-side key
- `SUPABASE_TABLE`
  Optional, default is `app_documents`
- `APP_SYNC_TOKEN`
  Optional but strongly recommended shared sync password

If `APP_SYNC_TOKEN` is set, the browser will prompt for it the first time a sync request receives `401 Unauthorized`.

## How it works

- Static assets are served directly by Cloudflare Pages
- `_routes.json` limits Functions execution to `/api/*`
- Pages Functions talk to Supabase with a server-side secret key
- The browser never receives the Supabase secret key

## Money and investment boundaries

- Daily income, expenses, refunds, and reimbursements are finance transactions.
- Account transfers move money without becoming income or expenses.
- Stock trades remain in the investment board and never become family ledger rows.
- Goose, duck, and chicken goals track earmarked purposes and progress.
- The family asset overview reads investment account summaries only.

The Sites deployment stores the new finance records in dedicated D1 tables through `/api/finance/state`. The existing investment board remains on `/api/state`.

## Legacy local files

These files are still kept for local experiments or rollback:

- `server.py`
- `start-server.ps1`
- `Dockerfile`

The long-term hosted path is now Cloudflare Pages + Supabase.

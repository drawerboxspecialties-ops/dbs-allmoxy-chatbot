# DBS Ops Chat

Internal, password-gated chatbot for Drawer Box Specialties staff. It uses your Allmoxy API credentials to answer questions about **orders, companies/customers, contacts, invoices, and payments**.

## Shared app (recommended for the team)

Host **one** instance so coworkers open a URL and use the company password.  
API keys stay on the server — teammates do **not** need their own keys.

### Recommended: Private GitHub + Vercel

1. Create a **private** GitHub repo and push this project (do not commit `.env.local` or `data/*.db`).
2. Go to [vercel.com](https://vercel.com) → Import that private repo.
3. In Vercel → Project → Settings → Environment Variables, add:

| Name | Notes |
|---|---|
| `ALLMOXY_CLIENT_ID` | from Allmoxy |
| `ALLMOXY_CLIENT_SECRET` | from Allmoxy |
| `ALLMOXY_CONTACT_KEY` | from your contact API Access |
| `ALLMOXY_CONTACT_ID` | e.g. `13935` |
| `ALLMOXY_INSTANCE` | `dbs` |
| `ALLMOXY_API_BASE_URL` | `https://api.allmoxy.com` |
| `ALLMOXY_AUTH_URL` | `https://auth.allmoxy.com/oauth2/token` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | required for chat (AI Studio) |
| `GOOGLE_MODEL` | e.g. `gemini-2.0-flash` |
| `APP_PASSWORD` | shared team login password |
| `APP_SESSION_SECRET` | long random string |
| `ALLMOXY_CACHE_TTL_SECONDS` | `300` |
| `ALLMOXY_MAX_REQUESTS_PER_MINUTE` | `10` |

4. Deploy. Vercel gives a URL like `https://allmoxy-ops-chat.vercel.app`.
5. Share **only that URL + APP_PASSWORD** with DBS staff.

Optional: set a custom domain later (e.g. `opschat.dbsdrawers.com`).

Local SQLite sync (`npm run db:sync`) is for your PC/server jobs; the shared Vercel chat uses **live Allmoxy** (best for current status).

## Setup

1. Copy env values:

```bash
cp .env.example .env.local
```

2. Fill in `.env.local`:
   - `ALLMOXY_CLIENT_ID` / `ALLMOXY_CLIENT_SECRET` from [dbs.allmoxy.com](https://dbs.allmoxy.com) → Settings → Integrations
   - `ALLMOXY_CONTACT_KEY` from Integrations → **Company Contacts** (create an Access Key for an employee; the table must not be empty)
   - `GOOGLE_GENERATIVE_AI_API_KEY` for chat answers (from Google AI Studio)
   - `APP_PASSWORD` shared team password for the UI
   - `APP_SESSION_SECRET` long random string

OAuth alone is not enough — Allmoxy also requires a contact Access Key (`contact_key` header) for API data calls.

Find/create that key under: **Contacts → your employee → Edit → API Access → Create Key**.

3. Install and run:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## What it can do (v1)

Read-only lookups via Allmoxy API (`https://apidocs.allmoxy.com/`):

- Companies / customers
- Contacts
- Orders & quotes (+ counts by status)
- Invoices
- Payment transactions

## Local SQLite database

The app can sync Allmoxy data into a local SQLite file at `data/allmoxy.db` (gitignored).

### Important: avoid the “pull everything every 30 minutes” problem
Allmoxy warned DBS about jobs that re-request huge historical ranges. This project follows their guidance:

- **Incremental only** for schedules (`npm run db:sync`)
- Uses a **watermark + 5-minute buffer** window (e.g. 9:25→9:55, then 9:55→10:25)
- **No overlapping syncs**
- **Chunked catch-up** (max 6h window per run) instead of one giant pull
- **Full sync locked** unless you intentionally run `npm run db:sync:full` once

### First-time / full sync (manual, rare)
```bash
npm run db:sync:full
```

### Scheduled / daily incremental sync
```bash
npm run db:sync
```

### Windows Task Scheduler (nightly)
1. Open Task Scheduler → Create Basic Task
2. Trigger: Daily (e.g. 11:00 PM)
3. Action: Start a program
   - Program: `npm.cmd`
   - Arguments: `run db:sync`   ← incremental only
   - Start in: `C:\Users\kovas\allmoxy-ops-chat`

Chat still uses live Allmoxy by default (with firewall + small targeted lookups). It does **not** poll the whole Allmoxy database on a timer.

## API firewall (smart usage)

To avoid overloading Allmoxy while still answering fully:

- **Cache** successful GET responses (~2 minutes by default)
- **Coalesce** duplicate in-flight requests into one upstream call
- **Rate limit** upstream calls (default **10/minute**; cache hits free)
- **Cache** defaults to **5 minutes** so repeat questions across the team reuse data
- **Efficient tools**: small search pages, prefer one detailed `related_objects` fetch
- Tunables in `.env.local`: `ALLMOXY_CACHE_TTL_SECONDS`, `ALLMOXY_MAX_REQUESTS_PER_MINUTE`

## Security notes

- Keep Client ID / Secret only in `.env.local` (gitignored).
- Do not commit or paste secrets into chat/PRs.
- Chat and health routes require a valid session cookie.
- Tools are read-only; the assistant is instructed not to create/update/delete records.

## Docs

- Allmoxy API: https://apidocs.allmoxy.com/
- Instance: https://dbs.allmoxy.com/

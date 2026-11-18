# ClearSplit

Private, invitation-only expense-sharing PWA (Splitwise-style) for a small circle: couples, flatmates, trips.
Hebrew (RTL, default) and English (LTR), light/dark, installable on iPhone, Android and desktop.

## Features

- **Groups** (trip, apartment, couple, …) with members, admins, archive, leave/remove (only at zero balance).
- **Friends**: secure one-time invitation links; each friendship has a private 1:1 ledger.
- **Expenses**: one or many payers; split equally, by exact amounts, percentages or shares; live preview; receipts (images/PDF, private storage); notes; categories; edit/delete/restore with full revision history.
- **Balances** derived from the ledger, per group and per currency (currencies are never mixed); **debt simplification** suggestions.
- **Settlements**: manual payment records with a pending → confirmed workflow; reject/cancel/reverse, all audited. No money is moved by the app.
- **Activity feed**, in-app **notifications** (realtime), search & filters, **CSV export** (UTF-8 BOM for Hebrew, formula-injection safe).
- **Owner administration**: invite new users, allow/deny member invitations, invitation validity, disable/enable users.
- **Settings**: name, photo, language, currency, theme, notification preferences, personal data export (JSON/CSV), account deletion.
- **PWA**: manifest + maskable icons, service worker (app shell only), offline indicator, writes disabled offline, update prompt.

## Architecture

```
Browser (React SPA / PWA)  ──HTTPS──►  Supabase
  Vite + React + TS               ├─ Postgres: tables + RLS (read-only for clients)
  Tailwind, Radix, Lucide         ├─ SECURITY DEFINER functions for every write (validated, transactional)
  TanStack Query, i18next         ├─ Auth (email + password, sign-up gated by invitation trigger)
  vite-plugin-pwa (Workbox)       ├─ Realtime (postgres_changes, RLS-filtered)
                                  └─ Storage: private `receipts` and `avatars` buckets
Static hosting: Render static site (free) – no backend server.
```

### Money & ledger

- Amounts are integer **minor units** (`bigint`), never floats. Parsing/formatting is string-based (`src/lib/money.ts`).
- Splits use deterministic largest-remainder apportionment (`src/lib/split.ts`); the server re-validates every invariant (payers sum = splits sum = total, percentages = 100 %, participants are active members).
- Balances are **derived** (`_group_nets`) from expense payers/splits and *confirmed* settlements; there is no editable balance column. Sum of nets in a group per currency is always 0 (tested).
- Edits replace an expense's lines atomically with optimistic concurrency (`version`) and append a snapshot to `expense_revisions`; deletes are soft and reversible.
- Idempotency keys on expenses and settlements prevent duplicate submissions.

### Security model

| Concern | Mechanism |
|---|---|
| No public registration | `after insert` trigger on `auth.users` rejects any sign-up without a valid, unexpired, unused invitation token (hashed with SHA-256; only the hash is stored). |
| Owner bootstrap | `bootstrap_owner_invitation(email)` – callable only from the SQL editor (not granted to clients). No email/password in source. |
| Data isolation | RLS on every table; membership helpers (`is_group_member`, `can_see_profile`). Users see only groups they belong to and people they share a group/friendship with. |
| Writes | Clients have **no** insert/update/delete on financial tables; all writes go through validated functions. Profile updates are column-restricted + guarded by a trigger. |
| Settlement fraud | A payment recorded by the payer stays *pending* until the recipient confirms. |
| Disabled users | `is_active=false` makes every RLS helper return false immediately. |
| Files | Private buckets; paths are scoped to `group_id/expense_id/` and checked by storage policies. Signed URLs expire in minutes. |
| Invitation links | Token travels in the URL fragment (`/join#token`) so it never hits server logs or `Referer`. |
| Frontend | Only the public anon key is shipped. CSP, HSTS, X-Frame-Options etc. via `render.yaml`. Service worker never caches API responses. |

## Development

```bash
npm install
cp .env.example .env.local   # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

### Environment variables

| Name | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL (public) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (public; protected by RLS) |
| `VITE_APP_URL` | Public URL of the deployed app, used to build invitation links |
| `TEST_DATABASE_URL` | Postgres URL for DB tests only (CI) |

Never put the service-role key in the frontend or in this repository.

### Database migrations

SQL migrations live in `supabase/migrations/` and are applied in order (Supabase CLI `supabase db push`, the dashboard SQL editor, or the Supabase MCP connector).

Required Supabase Auth settings:
- **Email provider enabled**, *Confirm email* **off** (the invitation already proves the link was delivered; also avoids the free tier e-mail rate limit). Anonymous/OAuth sign-ins off.
- **Site URL / redirect URLs**: the deployed app URL (`…/reset-password` for password resets).

### Initialising the owner account

1. In the Supabase SQL editor run: `select public.bootstrap_owner_invitation('you@example.com');`
2. Open `https://<app-url>/join#<returned-token>` and create your password (link valid 48 h, single use).
3. From **Settings → Administration** invite your partner and friends.

## Testing

```bash
npm run typecheck && npm run lint
npm test            # unit (split/ledger/money/csv) + DB tests (needs Postgres 16, see TEST_DATABASE_URL)
npm run test:e2e    # Playwright, mobile + desktop, Supabase API mocked in the browser
npm run build && npm run check:pwa
```

- **Unit** (34): equal/exact/percentage/shares splits, rounding fuzzing, multi-payer, simplification invariants, multi-currency, CSV injection.
- **DB** (30): runs every migration on a fresh Postgres with a Supabase stub, then exercises the real functions & RLS as different users: sign-up gate, invitation reuse/expiry/revocation, scenarios A/B/C, edit/delete/restore, settlements (pending/confirm/reject/cancel/reverse), idempotency, outsider access, direct-write denial, disabled users, storage policies, account deletion, SQL ↔ TypeScript balance equivalence.
- **E2E** (16 × 2 viewports): login/i18n/RTL, invitation flow, dashboard, expense form previews & payloads, server error display, unauthorized access, offline mode, dark mode, manifest/icons/service worker, offline app shell.

## Deployment (Render, free static site)

1. Push to GitHub. In Render: **New → Blueprint** → select this repo (uses `render.yaml`).
2. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_URL`.
3. Every push to `main` redeploys automatically. Static sites on Render's free tier do not sleep.

## Backup & recovery

- Supabase free tier has no point-in-time recovery; take periodic logical backups: `pg_dump --schema=public --data-only "$DB_URL" > backup.sql` (or Dashboard → Database → Backups on paid plans).
- Free-tier projects **pause after ~7 days of inactivity**; restore from the dashboard. Regular use prevents this.
- Users can export their own data from Settings.

## Installing the PWA

- **iPhone (Safari)**: Share → *Add to Home Screen* → Add.
- **Android (Chrome)**: ⋮ → *Install app* / *Add to Home screen*.
- **Desktop (Chrome/Edge)**: install icon in the address bar → Install.

## Known limitations

- No automatic currency conversion: balances are kept per currency (by design; no fabricated rates).
- Browser **push** notifications are not implemented (in-app realtime notifications only).
- Invitation e-mails are not sent by the app; links are shared via the system share sheet, copy, or `mailto:`.
- Offline mode is read-only for already-loaded screens; financial writes require a connection.
- Password reset relies on Supabase's built-in mailer (rate-limited on the free tier; configure custom SMTP for heavier use).

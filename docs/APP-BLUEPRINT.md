# ZZ Store — build prompt (paste to your coding agent)

Build a complete, production-ready wholesale/retail management web app named **ZZ Store**, deployable to my Ubuntu server exactly like my Distribuili app. Follow every convention below — they are proven in production, not suggestions.

## 1. Stack (exact)
- **Next.js 16.2.4** (App Router) + TypeScript 5 + **Tailwind CSS v4** + **Prisma 7** + **PostgreSQL 16**
- **next-intl**, locales `["ar", "fr", "en"]`, default `ar`. Arabic-first, full RTL. All routes locale-prefixed (`/[locale]/...`), `localePrefix: "always"`.
- Package manager: **npm**. No pnpm/yarn files.

## 2. What the app is
ZZ Store manages a wholesale store: products with units/packs, suppliers, purchase invoices, customers, sales (tickets + delivery notes + invoices), van/truck stock with transfers depot→van, client/supplier debts with payments, expenses, and basic reports. Arabic UI first (French/English complete). Roles: Admin, Vendeur, Livreur (role-filtered sidebar).

## 3. Non-negotiable architecture
- `src/app/[locale]/(app)/...` for staff pages behind one `AppShell` (sidebar + topbar); `src/app/[locale]/(public)/...` for login (no shell).
- `src/proxy.ts`: JWT sliding session (`access_token` 12h + `refresh_token`), protected prefixes redirect to login, locale handling, API passthrough with token renewal. Never bounce authenticated users off `/login`.
- Auth: bcrypt passwords, `getSession()` helper reading the access cookie + company check (dead company → clean login redirect, never a loop).
- Multi-tenant by `companyId` on every table. Every Prisma query is company-scoped.
- Money/numbers: **one** formatter module `src/lib/format.ts` (`dz()`, `dzMoney()` with NBSP grouping + LRI/PDI bidi isolation). Never raw `toLocaleString`/`toFixed` for display. Wrap every Latin code/phone/date inside Arabic text with `<bdi>` + correct `dir`. Use logical CSS (`ms-/me-`, `text-start/end`) — never physical `ml/mr/text-left`.
- Design tokens only: `bg-(--bg-*)`, `text-(--text-*)`, `border-(--border-*)`, `bg-(--brand-500)` — no hardcoded colors. Flat cards (no shadows except deliberate hero/HR accents). Page wrapper `space-y-4 p-5 md:p-6`. Shared `Button`/`Input(h-11)`/`Card`/`Modal`/`KpiCard` components.
- Health endpoint: `GET /api/health` → `{ok:true, db:"up"|"down"}` (real DB `SELECT 1` check).

## 4. Database rules
- Prisma schema is the source of truth. **Every schema change ships with a migration file** (`prisma/migrations/`) — never `db push` shared/deviating state. Verify with `prisma migrate diff` before committing.
- Seed script creates a demo company + admin + vendeur + livreur (`prisma/seed.ts`, wired as `prisma db seed`).
- `.env` never committed. Ship `.env.example` with placeholders only.

## 5. Deployment contract (must work on my server out of the box)
The server runs many apps; yours must follow this exact contract:
- `docker-compose.prod.yml` with services **db** (postgres:16-alpine, `pgdata` volume, healthcheck), **app** (Dockerfile `runner` target, `PORT 3000` + `HOSTNAME 0.0.0.0`, host port `"${APP_PORT:-30XX}:3000"` — pick a free one, never hardcode a taken port), **migrate** (`--profile tools`, builder target, `npx prisma migrate deploy`), **seed** (`--profile tools`, first-deploy only).
- `.env` on server holds `POSTGRES_PASSWORD`, `JWT_SECRET` (chmod 600). `DATABASE_URL` for app/migrate points at `db:5432`.
- `scripts/deploy.sh`: `git pull --ff-only` → migrate → `up -d --build app db` → 30× health-check loop → rollback (`up -d --no-build`) on failure. Respects `APP_PORT`/`APP_URL` env.
- `scripts/poll-deploy.sh` + install docs: cron `*/2 * * * *` → fetch origin, deploy only when HEAD moved, log to `logs/` (gitignored).
- `Dockerfile` multi-stage (`deps` → `builder` → `runner`), standalone output (`output: "standalone"`), `outputFileTracingIncludes` for any runtime-read files.
- `.dockerignore`: node_modules, .next, .env*, *.db, backups, logs. `.gitignore`: same + certs/keys, *.apk, *.exe, dist-electron, android build dirs, OS files.
- Never commit secrets, keys, or `*.pem`. Dev-default passwords only in `.env.example`/compose comments, clearly marked.

## 6. Hosting integration (server side, my setup)
- App listens on its container port; host nginx reverse-proxies `https://<name>.khiatadz.com` → `127.0.0.1:$APP_PORT` (provide the exact `sites-enabled` server block in your final message, modeled on: static `/_next/static/` cache 1y immutable + `/` proxy with `X-Forwarded-*`, websocket upgrade, 60s timeouts, port 80 block; certbot adds the 443 block).
- Alternative path you must also support: Cloudflare Tunnel ingress (`hostname → http://127.0.0.1:$APP_PORT`) — no code changes needed, just document it.
- Every API/cookie must work behind a proxy: trust `X-Forwarded-For`/`X-Forwarded-Proto` for IP and secure cookies (`COOKIE_SECURE` handling).

## 7. Definition of done (verify all, report results)
1. `npm run typecheck` clean, `npm run build` clean.
2. Deployed via the compose stack locally: `/api/health` → `db:"up"`, login page 200, seeded logins work.
3. Push → server auto-deploys (or document the exact server commands).
4. I will test: Arabic RTL on desktop + phone widths, debts math, stock movements depot→van, offline-tolerant where applicable.

Build it section by section, verifying as you go. Ask me only when a business rule is genuinely ambiguous — otherwise decide with Algerian wholesale defaults (DZD, NBSP grouping, FR/AR bilingual refs).

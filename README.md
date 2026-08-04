# PhotoDost

> A **face-recognition photo-delivery SaaS for event photographers**. Upload an event's photos, share one QR — each guest takes one selfie and instantly gets only the photos they're in. Multi-tenant, self-hosted ML, cost-optimized storage, sold as annual INR subscription plans capped by **total storage**.

The authoritative build plan is **[`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)** — read it for the product model, pricing, phasing, and what's built vs. pending.

---

## What it does

One Next.js app serving an authenticated **photographer dashboard** plus a public **guest gallery**. Each photographer signs in (magic link / Google), lands in a **workspace**, and everything they create is scoped to it.

- **Create an event** (`/events`, `/events/new`, `/events/[slug]`) → bulk-upload photos via presigned uploads.
- The **worker** pulls each upload, runs it through the self-hosted ML service (InsightFace `buffalo_l`), and stores 512-d face embeddings in pgvector.
- **Share a QR** → guests open `/g/[token]`, take/upload a selfie → largest face embedded → pgvector cosine search returns only the photos that guest appears in (threshold 0.55, capped at 200). Falls back to "show all" if ML is down or no face is found.
- `guest_searches` logs hashed IP/UA + timing for rate-limiting/abuse signals.

**Subscriptions (INR):** every workspace starts on a **7-day free trial** (500 MB, 1 event), then buys an **annual** plan capped only by **total storage** — 25 GB ₹999, 50 GB ₹1,399, 100 GB ₹1,999 — via Cashfree Subscriptions (UPI Autopay / eNACH / cards) on `/app/billing`. Events are unlimited on paid tiers because storage is the only cost that scales per customer. Everything is free/unlimited to test until billing is switched on (`BILLING_ENABLED` flag) — and the app refuses to enforce quotas unless Cashfree is fully configured, so it can't cap a workspace that has no way to upgrade. Setup runbook: **[`docs/BILLING.md`](./docs/BILLING.md)**.

---

## Architecture

```
photodost/  (monorepo: pnpm workspaces + Turborepo)
├── apps/
│   ├── web/        Next.js 15 (App Router, React 19): auth, onboarding,
│   │               dashboard, event management, guest gallery, all HTTP APIs.
│   │               Key libs: auth.ts, session.ts, workspaces.ts, storage.ts, s3.ts.
│   ├── worker/     Node + BullMQ: face-embed pipeline + nightly storage
│   │               reconciliation (reconcile.ts). Calls the ML service.
│   └── ml/         Python FastAPI + InsightFace: /embed and /embed/primary.
├── packages/
│   └── db/         Drizzle schema + client. Tables: user/session/account/verification
│                   (Better Auth), workspaces, memberships, events, assets,
│                   asset_variants, face_embeddings [pgvector], guest_searches,
│                   storage_ledger.
├── infra/docker/   Local stack: Postgres+pgvector, Redis, MinIO, Mailpit, ML.
├── DEVELOPMENT_PLAN.md   ← authoritative build plan
└── README.md
```

**Tenancy:** single DB, row-level scoping by `workspace_id`. Management reads go through a workspace-scoped data layer (`lib/events.ts`) — a slug alone never reaches another tenant's data.

**Storage accounting:** `lib/storage.ts` owns the `PLANS` quota map + reserve/commit/reclaim. Counter on `workspaces.storage_used_bytes`, audit trail in `storage_ledger`, healed by the worker's `recomputeAllWorkspaceUsage`.

---

## Prerequisites

- **Node.js 22** (`.nvmrc` is set; use `fnm`/`nvm`).
- **pnpm 9** (`corepack enable`).
- **Docker Desktop** (Postgres, Redis, MinIO, Mailpit, ML).

---

## Quick start

```bash
# 1. Install JS deps
pnpm install

# 2. Copy env templates (one per app + root)
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/ml/.env.example apps/ml/.env

# 3. Generate the Better Auth secret (required — auth won't boot without it)
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> apps/web/.env

# 4. Bring the local backend up (Postgres+pgvector, Redis, MinIO, Mailpit)
pnpm infra:up

# 5. Push the Drizzle schema
pnpm db:push

# 6. Start the web app + worker
pnpm dev
```

### Trying the full flow locally
1. Open http://localhost:3030 → **Sign in**, enter any email.
2. Open **Mailpit** at http://localhost:8025 → click the magic link.
3. Land on `/onboarding` → create your workspace → `/app`.
4. Create an event, upload photos, and share the QR / guest link.

| URL                               | What it is                                           |
| --------------------------------- | ---------------------------------------------------- |
| http://localhost:3030             | Web app — start at `/sign-in`                        |
| http://localhost:3030/api/healthz | Web service health probe                             |
| http://localhost:8025             | **Mailpit** — magic-link sign-in emails land here    |
| http://localhost:9001             | MinIO console (`minioadmin` / `minioadmin`)          |
| http://localhost:8000/healthz     | ML service health (only with the `ml` profile up)    |

> **Port note:** non-default host ports to avoid local clashes — Web **3030**, Postgres 5432, Redis **6380**, MinIO 9000/9001, ML 8000, Mailpit SMTP/UI 1025/8025. All `.env.example` files already point here.

**On your phone:** find your laptop IP (`ipconfig getifaddr en0`) and visit `http://<ip>:3030`. (Selfie camera APIs need HTTPS — use an `ngrok`/`cloudflared` tunnel for real-device testing.)

### Bring up the ML service (needed for face matching)

Gated behind a Compose profile so the ~290 MB `buffalo_l` build doesn't slow first-run. Without it, guest search falls back to "show all photos."

```bash
docker compose -f infra/docker/docker-compose.yml --profile ml up -d ml
```

---

## Common scripts

```bash
pnpm dev               # Run web + worker in watch mode
pnpm build             # Build everything
pnpm typecheck         # Typecheck every app/package
pnpm lint              # Lint every app/package
pnpm format[:check]    # Prettier

pnpm db:generate       # Generate a Drizzle migration from schema changes
pnpm db:push           # Push schema to DATABASE_URL
pnpm db:studio         # Drizzle Studio

pnpm infra:up/down/logs
pnpm infra:reset       # ⚠️ wipes volumes (Postgres data, MinIO bucket, etc.)
```

---

## Locked decisions

| Decision      | Choice                                                        |
| ------------- | ------------------------------------------------------------- |
| Product       | **Single product** — face-recognition event galleries         |
| Auth          | **Better Auth** — magic link + Google OAuth                   |
| Tenancy       | One DB, row-level `workspace_id`; 1 user : 1 workspace (teams later) |
| Quota model   | **Total storage cap** per plan; events unlimited on paid tiers |
| Billing       | **Annual INR subscriptions** via Cashfree (UPI Autopay), 7-day trial |
| Object store  | MinIO local → **Backblaze B2** + Cloudflare CDN in prod (one env swap) |
| DB            | Postgres + pgvector                                           |
| ML stack      | Python + FastAPI + InsightFace `buffalo_l`                    |
| Queue         | Redis + BullMQ                                                |
| Hosting       | Vercel (web) + Railway/Fly (worker, ml)                       |
| Accent color  | indigo `#5046E5`                                              |

---

## License

Private. © PhotoDost.

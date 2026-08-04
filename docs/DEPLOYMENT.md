# Deployment runbook

Ordered path from "works on my laptop" to "taking real money". Each step is checkable; later steps assume earlier ones.

**Legend:** ✅ done · 🔴 blocker (nothing works without it) · 🟠 needed before real customers · 🟡 should-do, not blocking

**Plan:** deploy first with Cashfree **sandbox** keys so the whole thing is live and walkable on the internet, then switch to production keys (Stage 5) once it's proven.

---

## Stage 0 — Repo foundations

### 0.1 ✅ Put this in git — DONE

Live at https://github.com/sethipriyanshu/photodost.

```bash
git init -b main
git add -A
git commit -m "PhotoDost: face-recognition photo delivery"
gh repo create photodost --private --source=. --push
```

Confirm `.gitignore` covers `.env` (it does) and that **no `.env` file is in the commit**:

```bash
git ls-files | grep -E '(^|/)\.env$' && echo "STOP — secrets staged" || echo "clean"
```

Your Cashfree sandbox keys are in `apps/web/.env` and `.env`. Both are ignored, but verify before pushing.

### 0.2 ✅ Get CI green — DONE (all three jobs)

`pnpm format:check`, `typecheck`, `lint` and `build` all pass locally as of now — formatting had been failing on 28 files and was fixed. Push and confirm the Actions run is green before building on top of it.

### 0.3 ✅ Switch from `db:push` to real migrations — DONE

There is no `packages/db/drizzle` directory — the schema has only ever been applied with `drizzle-kit push`, which diffs and can **drop columns** without asking. That is acceptable on a laptop and not acceptable against production data.

```bash
pnpm db:generate          # writes versioned SQL
git add packages/db && git commit -m "Baseline migration"
```

Then use `drizzle-kit migrate` (not `push`) for every production deploy. Add a `db:migrate` script and run it as a release step.

---

## Stage 1 — Finish proving billing (sandbox)

### 1.1 🔴 Authorize a mandate in a browser

Every Cashfree API call is verified, but **no mandate has been authorized through the checkout modal and no webhook has reached a running instance.** This is the single largest untested gap.

```bash
cloudflared tunnel --url http://localhost:3030
```

Then, in `apps/web/.env`, point `APP_URL` and `BETTER_AUTH_URL` at the printed HTTPS URL and set `BILLING_ENABLED=true`.

In the Cashfree dashboard → Developers → Webhooks, add `https://<tunnel>/api/billing/webhook` with these four events:
`SUBSCRIPTION_STATUS_CHANGED`, `SUBSCRIPTION_AUTH_STATUS`, `SUBSCRIPTION_PAYMENT_SUCCESS`, `SUBSCRIPTION_PAYMENT_FAILED`.

Walk it: `/app/billing` → enter a mobile number → **Choose Pro** → authorize with sandbox VPA `success@upi`.

Verify:

```sql
select plan, billing_plan_key, subscription_status, current_period_end, billing_phone
from workspaces;
```

Expect `plan='pro'`, `subscription_status='active'`, a non-null `current_period_end`. Then check the webhook shows a 200 delivery.

### 1.2 🟠 Test the failure paths

- `failure@upi` → mandate declines, workspace stays unchanged.
- Cancel → `cancel_at_period_end=true`, quotas **unchanged**.
- Set `current_period_end` to the past, restart the worker → billing sweep issues the real CANCEL and drops to `free`.
- Set `subscription_status='past_due'` → uploads blocked, guest gallery still works.

---

## Stage 2 — Provision production infrastructure

### 2.1 ✅ Postgres — Neon — DONE (Singapore, PG 17.10, 12 tables, pgvector verified)

Needs the `vector` extension. Create the DB, then:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Apply migrations, then confirm the HNSW index exists — the worker creates it on boot (`ensureHnswIndex`), but verify rather than assume:

```sql
select indexname from pg_indexes where tablename = 'face_embeddings';
```

### 2.2 🔴 Redis — Railway (not Upstash)

BullMQ polls continuously — ~1–1.5 commands/second per Worker while completely idle, and there are two Workers. Upstash bills per command, so that's ~216k commands/day doing nothing: the free tier lasts about two days and pay-as-you-go lands near $13/month before a single photo is processed. Bull is [effectively incompatible with Upstash](https://github.com/OptimalBits/bull/discussions/2422) for this reason.

Railway Redis is flat-rate, and since the worker runs there too it gets private networking (`redis.railway.internal`) — so Redis is never exposed to the internet. Set the region to Singapore to match Neon.

Whatever you use, **eviction must be off**. A queue whose keys can be evicted loses jobs silently.

### 2.3 🔴 Object storage — Backblaze B2 + Cloudflare

1. Create a **private** B2 bucket.
2. Create an application key scoped to that bucket. Copy `keyID` and `applicationKey`.
3. Put a Cloudflare-proxied custom domain in front of it (e.g. `cdn.photodost.app`).
   **This matters:** serving from the raw `f004.backblazeb2.com` URL bills egress and defeats the entire reason for choosing B2. Egress is free only through Cloudflare (Bandwidth Alliance).
4. Set the production block from `apps/web/.env.example`, with `S3_FORCE_PATH_STYLE=false`.

Then verify against real B2 — the code is provider-agnostic and hardened for it, but has only been exercised against MinIO:

- a presigned browser upload succeeds
- `HeadObject` returns the right `ContentLength`
- the worker's variant upload succeeds
- an object is fetchable through the Cloudflare domain
- `deleteObject` works (the retention purge depends on it)

### 2.4 🔴 SMTP

Currently Mailpit only. Magic-link sign-in **and** the retention warning emails both depend on real SMTP. Use Resend/SES/Postmark, set `SMTP_*` + `EMAIL_FROM`, and verify your sending domain (SPF/DKIM) — sign-in emails landing in spam means nobody can log in.

### 2.5 🔴 Rotate every secret

```bash
openssl rand -hex 32     # BETTER_AUTH_SECRET
```

`apps/web/.env:16` still holds the placeholder `replace-me-with-a-32-byte-random-string`; auth will not boot on it. Production values go in the host's env settings, never in a file.

---

## Stage 3 — Things that don't exist yet

### 3.1 ✅ Worker Dockerfile — DONE (image builds, container boots)

Only `apps/ml/Dockerfile` exists. The worker has no deploy artifact. It needs a multi-stage build that installs pnpm workspace deps, builds `@photodost/db` and the worker, and runs `node dist/index.js`. Note it needs `sharp` (native) — use a Debian-based Node 22 image, not Alpine, or install the musl build explicitly.

### 3.2 ✅ Lock down the ML service — DONE (bearer token, fails closed in production)

`apps/ml` has **no authentication of any kind** — no token, no allowlist. Deployed publicly, anyone can post images to `/embed` and burn your CPU.

Either bind it to a private network so only the worker can reach it, or add a shared-secret header check in `apps/ml/app/main.py` plus an `ML_SERVICE_TOKEN` the worker sends. Do not deploy it publicly as-is.

### 3.3 🟠 Make `/api/healthz` mean something

It currently returns `{status: "ok"}` unconditionally without touching Postgres, Redis or S3 — so a platform health check passes while the app is completely broken. Have it check each dependency and return 503 when one is down.

### 3.4 🟠 Bulk download

The retention emails tell photographers to "download anything you want to keep", but there is no way to download an event in bulk — only one photo at a time. Shipping deletion warnings without this makes them substantially unfair.

---

## Stage 4 — Deploy (decided: Railway for everything)

**Decision:** all three services on Railway Hobby, face matching **on** from day one.
~₹1,843/month. Reviewed after two months against a kill criterion (see below).

Rejected alternatives and why, so this isn't re-argued later:

| Option | ₹/mo | Why not |
|---|---|---|
| Hetzner CX22, all-in-one | 360 | Cheapest with ML on, but we'd administer the box |
| Railway staged, no ML | 523 | Launches with the core differentiator switched off |
| Fly.io, ML autosuspend | 450–600 | Good fit, but a new platform to learn under time pressure |
| Oracle Always Free | 0 | Signup/capacity unpredictable; instances can be reclaimed |

### The kill criterion

Because billing is annual, cash arrives upfront: **4 paying customers (~₹4,000) covers the
entire two-month experiment cost of ₹3,686.** Monthly margin break-even is 29 customers, but
that is the wrong number to judge the experiment by. Review at 60 days on customers acquired.

### 4.1 Services

Three Railway services from this repo, plus Redis:

| Service | Build | Notes |
|---|---|---|
| `web` | `apps/web/Dockerfile` | Next.js standalone output |
| `worker` | `apps/worker/Dockerfile` | already built and boot-tested |
| `ml` | `apps/ml/Dockerfile` | needs ≥2 GB; the memory cost driver |
| `redis` | Railway plugin | private networking, eviction off |

Set the region to **Singapore** on every service to match Neon.

### 4.2 Env vars, per service

Each service reads its own env — the worker does **not** see the web app's. Missing
`CASHFREE_*` on the worker silently disables the cancellation sweep and retention emails.

- **web** — `DATABASE_URL` (pooled), `REDIS_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `APP_URL`, `S3_*`, `S3_PUBLIC_URL`, `ML_SERVICE_URL`, `ML_SERVICE_TOKEN`, `SMTP_*`,
  `EMAIL_FROM`, `BILLING_ENABLED`, `CASHFREE_*`
- **worker** — `DATABASE_URL` (pooled), `REDIS_URL`, `S3_*`, `ML_SERVICE_URL`,
  `ML_SERVICE_TOKEN`, `SMTP_*`, `EMAIL_FROM`, `APP_URL`, `BILLING_ENABLED`, `CASHFREE_*`
- **ml** — `ML_ENV=production`, `ML_SERVICE_TOKEN` (same value everywhere)

`ML_SERVICE_URL` uses Railway's private hostname so the ML service is never public.
With `ML_ENV=production` it refuses to boot without a token, which is the intended guard.

### 4.3 Migrations

Run from your machine against the **direct** (non-pooler) Neon URL:

```bash
DATABASE_URL="<DIRECT_URL>" pnpm db:migrate
```

Not `db:push` — it diffs and can drop columns.

## Stage 5 — Go live

### 5.1 🔴 Cashfree production

Complete KYC (PAN, GST if registered, bank proof) and get Subscriptions + UPI Autopay activated on the **live** account. Then:

```bash
pnpm billing:create-plans     # with production keys — plans are per-environment
```

Set `CASHFREE_MODE=production` and the live keys. `billingConfigError()` will refuse a test key in production mode, which is the intended guardrail.

Register the production webhook at `https://<domain>/api/billing/webhook`.

### 5.2 🔴 Smoke test production with a real ₹999

Sandbox proves the wiring; only a live transaction proves the account. Subscribe on the cheapest tier with your own UPI, confirm the row and the webhook, then cancel.

### 5.3 🟠 Flip the flag

`BILLING_ENABLED=true` on **both** web and worker. Until then everything runs on Beta quotas and nothing is charged.

### 5.4 🟠 Legal and compliance

Face embeddings are biometric data under India's DPDP Act. The guest consent checkbox exists; the surrounding paperwork does not. You need a privacy policy stating what's collected and for how long, terms of service, refund/cancellation policy (Cashfree requires this for KYC), and pricing pages that state GST treatment. Confirm whether your displayed prices are GST-inclusive — the unit economics in `DEVELOPMENT_PLAN.md` §2 assume they are.

---

## Stage 6 — After launch

- 🟡 **Error tracking** — Sentry on web and worker. There is none.
- 🟡 **Uptime checks** — on `/api/healthz` and the ML service.
- 🟡 **Dunning** — nothing emails a customer when a charge fails.
- 🟡 **GST invoices** — Cashfree can generate them; nothing requests or stores them.
- 🟡 **Proration** — a plan change creates a second subscription without cancelling the first. Fix before anyone upgrades mid-cycle.
- 🟡 **Backups** — verify Neon PITR is on. Note that photo objects are **not** backed up, and the retention purge deletes them irreversibly.
- 🟡 **Tests** — there are none. The riskiest untested logic is `accessEndedAtSql()`, which decides whose photos get deleted; it's verified by hand but has no regression test.

---

## Shortest path to a live payment

If you want to compress this: **0.1 → 0.2 → 1.1 → 2.1–2.5 → 3.1 → 3.2 → 4.x → 5.1 → 5.2**.

Everything else can follow, with two exceptions I would not skip: **3.2** (an unauthenticated ML service is a standing invitation) and **3.4** (deleting photos after telling people to download them, with no way to download them).

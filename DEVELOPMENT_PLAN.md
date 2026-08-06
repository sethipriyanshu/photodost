# PhotoDost — Development Plan

> **Authoritative plan.** Supersedes the old `MVP_PLAN.md` / `SAAS_PLAN.md` (which described a two-product "events + flipbook albums" vision — the flipbook album product has been removed).

PhotoDost is a **face-recognition photo-delivery SaaS for event photographers**. A photographer signs up, gets a workspace, creates an **event**, bulk-uploads the event's photos, and shares **one QR code**. Each guest takes **one selfie** and instantly gets only the photos they appear in — no login, no scrolling through thousands of shots.

Photographers buy an **annual subscription** (INR) capped by **total storage**, after a 7-day free trial. Everything is testable for free until the payment phase is switched on.

---

## 1. Product model

| Concept | Meaning |
|---|---|
| **Workspace** | One photographer/studio. Unit of ownership, quota, and billing. |
| **Event** | A shoot (wedding, party, conference). Has photos, a share token, a QR. |
| **Asset** | One uploaded photo. Worker embeds every face in it (pgvector). |
| **Guest** | Anonymous viewer. Selfie → cosine search → their photos only. |

**Quota model (decided): total storage only.** Storage is the one cost that scales per customer, so it is the only thing a paid plan caps:
- `storage_quota_bytes` — total bytes across all events.
- `event_quota` — **NULL means unlimited**, which is every paid tier. Only the free trial caps it (at 1).

Enforced at two points: **event creation** (free trial only) and **upload presign/finalize** (block when the storage cap would be exceeded). A third gate blocks writes when the subscription has lapsed or the trial has expired, while leaving guest galleries readable.

---

## 2. Pricing (INR) — annual only

**Storage is the only lever.** It's the one cost that scales per customer, so it's the only thing a plan caps; event count is unlimited on every paid tier. Config-as-code in `apps/web/src/lib/storage.ts` (`PLANS`).

| Plan | Storage | Events | Annual | Storage cost/yr | Margin |
|---|---|---|---|---|---|
| **Free** | 500 MB | 1 | ₹0 — 7-day trial | ~₹4 | — |
| **Starter** | 10 GB | unlimited | ₹999 | ₹81 | 90% |
| **Pro** | 50 GB | unlimited | ₹2,499 | ₹404 | 81% |
| **Studio** | 100 GB | unlimited | ₹3,999 | ₹807 | 76% |

> Reference: a DSLR JPEG is ~6–10 MB, so a 1,500-photo wedding ≈ 12 GB. **Starter does not fit one full wedding** — it is sized for a single smaller shoot, with the upgrade or a storage add-on as the path beyond that. Pro ≈ 4 weddings, Studio ≈ 8.

Margins assume the customer fills the quota, ~10% variant overhead, and GST-inclusive prices. Break-even against Railway's ₹1,843/month is roughly **14 customers** on an even mix.

**Unit economics — needs attention.** At R2's $0.015/GB-month (~₹15.8/GB-year) the Studio tier costs ~₹1,584/yr in storage against ₹1,999 of revenue, and GST-inclusive pricing plus the unbilled `asset_variants` overhead takes that gross margin to roughly zero. Two open items follow from this:

- ✅ **Cheaper object storage — decided: Backblaze B2** (~$0.00695/GB-month) fronted by Cloudflare, which keeps egress free via the Bandwidth Alliance and cuts storage COGS ~2.2×, restoring Studio to ~50% margin. The code is provider-agnostic and now configurable for it; only the production bucket + credentials remain.
- ✅ **Retention — decided:** photos are deleted 7 days after a subscription ends or a trial expires, with two warning emails. Bounds the cost of dead accounts.

**Decided:** provider is **Cashfree Subscriptions** (UPI Autopay / eNACH / cards; RBI-authorised; settles to an Indian bank account). Cadence is **annual only**.

---

## 3. Architecture (unchanged core)

```
apps/
  web/     Next.js 15 (App Router, React 19) — auth, onboarding, dashboard,
           event management, guest selfie gallery, all HTTP APIs.
  worker/  Node + BullMQ — face-embed pipeline, (soon) derivatives, nightly
           storage reconciliation. Calls the ML service.
  ml/      Python FastAPI + InsightFace (buffalo_l) — /embed, /embed/primary.
packages/
  db/      Drizzle schema + client. Postgres + pgvector.
infra/docker/  Postgres+pgvector, Redis, MinIO, Mailpit, ML.
```

**What already works (kept from the pre-pivot build):**
- ✅ Auth & tenancy — Better Auth (magic link + Google), workspaces + memberships, onboarding, route/API gating.
- ✅ Storage accounting — byte counter, `storage_ledger`, reserve-at-presign / commit-at-finalize (HEADs real object size) / reclaim-on-delete, nightly reconciliation.
- ✅ Event galleries — create event, presigned bulk upload, worker embeds faces into pgvector (HNSW), guest selfie search (cosine, threshold 0.55, fallback to "show all").
- ✅ QR generation, guest search abuse logging (`guest_searches`).

---

## 4. Testing-before-payment principle

**Everything must be fully usable and testable before any payment code exists.** Mechanism: a `BILLING_ENABLED` flag (default `false`).

- While `false`: every workspace runs on a generous **Beta plan** (high event cap + large storage). Quota *tracking* still runs (so the meters are real), but no paywall and nothing blocks testing; dashboard shows "Beta — unlimited".
- When flipped `true` (Phase 5): real plans enforce; over-quota actions prompt an upgrade.

This lets Phases 1–4 ship and be exercised end-to-end with no gateway account.

---

## 5. Phased plan (payment is last)

Each phase is independently shippable and testable.

### ✅ Phase 0 — Purge & rebrand (DONE)
Removed the flipbook album product entirely (routes, APIs, public viewer, `lib/albums.ts`, `albums`/`album_sheets` tables, album storage-ledger reasons, `react-pageflip`, product-switcher nav). Rewrote landing + dashboard as a single face-recognition product. Monorepo typechecks clean.

### ✅ Phase 1 — Events-count quota (on top of storage) (DONE)
- ✅ Schema: `workspaces.event_quota` (int, defaults to the Starter allotment); `PLANS` in `apps/web/src/lib/storage.ts` carries `{ label, priceInr, eventQuota, quotaBytes }`.
- ✅ Enforce event cap on create — `checkEventQuota()` counts the workspace's events and `events/new/actions.ts` returns a friendly "You've reached your plan's event limit (N). Upgrade to create more events."
- ✅ Dashboard shows **two** meters — events used/allotted and storage used/allotted (`app/app/page.tsx`).
- ✅ `BILLING_ENABLED=false` (default) → `effectiveQuotas()` returns the Beta allowance (999 events / 100 GB) so nothing blocks testing; usage is still tracked so both meters are real.
- **Test:** with `BILLING_ENABLED=true` and a low `event_quota`, create events up to the cap and confirm the block; storage meter unaffected.

### ✅ Phase 2 — Productionize the face-recognition flow (DONE)
- ✅ **Derivatives:** worker generates `thumb` (480px) + `preview` (1600px) via sharp in the embed job, stores `asset_variants`, records EXIF-aware width/height. `displayUrls()` feeds thumbnails to grids, previews to the lightbox, originals to download. Not counted against quota (platform overhead). Delete removes derivative objects too.
- ✅ **sha256 dedupe:** client hashes each file (Web Crypto); the presign step skips re-uploading content already in the event and returns the existing asset.
- ✅ **Guest experience:** explicit biometric-**consent** checkbox gates the search (server rejects without it); every search **logged** to `guest_searches` (salted-hashed IP/UA, count, timing); **rate limit** 15/min per hashed IP → 429. Existing "no face / show all" fallbacks retained.
- ✅ **Event management:** set **cover** photo (shown on the events list), delete photos (reclaims storage), **rotate/pause** share token, tune **match sensitivity** (`match_threshold`, now actually used by matching) from the dashboard.
- Retained from before: real per-file upload progress, HEIC rejection, downloadable QR, per-photo download/share.
- **Remaining polish (optional, low priority):** decouple derivatives from the embed job (use the reserved `process-asset` queue) so thumbnails still generate when ML is down; printable QR sheet; short public URL (Phase D).
- **Test:** full photographer→guest loop on a real phone (via tunnel for camera HTTPS).

### ✅ Phase 3 — Workspace & account UX (DONE)
- ✅ Settings page (`/app/settings`): edit studio name, workspace slug (normalized + uniqueness-checked), accent color; account section with signed-in email + sign out. Linked from the dashboard header.
- ✅ Accent color is now **live** — it brands the public guest gallery (overrides the primary token for that subtree).
- ✅ Unified usage view (events + storage meters + plan card, "Beta · unlimited") already on the dashboard from Phase 1.
- **Deferred (Phase D-style infra):** wildcard subdomain routing + custom event slugs — bigger host-based-routing work, not needed for testing.

### Phase 4 — Hardening & deploy
- Structured logging/observability, consistent error handling. (Guest-search rate limiting is already done and DB-backed, so it survives serverless — no Redis needed for it.)
- Make the **ML service private** (internal-only network).
- Production config: Backblaze B2 + Cloudflare CDN, Neon Postgres+pgvector, Railway Redis; secrets management; healthchecks.
- Biometric-data compliance pass (consent record, retention/auto-purge of embeddings, privacy copy).

### Phase 5 — Cashfree INR billing (BUILT, SANDBOX-VERIFIED, NOT YET LIVE)
Runbook: **[`docs/BILLING.md`](./docs/BILLING.md)**.

- ✅ Annual-only plan catalog (`PLANS` in `lib/storage.ts`) plus a `free` 7-day trial tier, and `pnpm billing:create-plans` to create the matching Cashfree plans from it. Plan IDs are merchant-supplied and derived from the catalog, so there are no plan-ID env vars.
- ✅ Cashfree Subscriptions: `/app/billing` page with mobile capture, `POST /api/billing/subscribe`, eager `POST /api/billing/confirm` (no client input — re-fetches server-side from the caller's own row), `POST /api/billing/cancel` (records intent).
- ✅ Signature-verified webhook → sets `plan` + `event_quota` + `storage_quota_bytes` + `subscription_status` + `current_period_end`. Idempotent, so redelivery is safe. Re-fetches from the API when an event carries only a partial subscription.
- ✅ Billing columns are provider-neutral (`billing_customer_id` / `billing_subscription_id` / `billing_plan_key`), plus `billing_phone` and `cancel_at_period_end`.
- ✅ Enforcement: `past_due` / `canceled` / expired trial blocks new events + uploads while leaving guest galleries readable; quota errors carry an `upgradeUrl`.
- ✅ Safety interlock: `billingReady()` keeps the app on Beta quotas unless the app ID, secret and a matching mode are present — so billing can never be "on" without an upgrade path. Also catches a sandbox-key/production-mode mismatch, which would otherwise surface as a confusing 401.
- ✅ Cancel-at-period-end is emulated: Cashfree's CANCEL is immediate, so `/api/billing/cancel` sets a flag and the worker's daily sweep (`apps/worker/src/billing-sweep.ts`) issues the real CANCEL once the period lapses, then drops the workspace to `free`.
- ✅ **Sandbox-verified:** credentials, plan creation (all three ACTIVE), subscription creation with tags echoed back, session-ID issuance, CANCEL, and webhook signature verification (including that a hex digest and body-only signing are both rejected) have each been exercised against `sandbox.cashfree.com`.
- ⬜ **Not verified end to end through a browser** — no mandate has actually been authorized via the checkout modal, and no webhook has been delivered to a running instance. Do that behind a tunnel before flipping `BILLING_ENABLED=true`.
- ⬜ **Still open:** GST-compliant invoices; paid-tier retention policy (see §2); proration and mid-cycle upgrade/downgrade (a plan change currently creates a second subscription without cancelling the first); dunning email on failed charge; trial-expiry warning email.

---

## 6. Immediate next step

Phases 0–3 are done and Phase 5's billing code is written and sandbox-verified at the API level, but no mandate has been authorized through a browser yet.

Two tracks left:
1. **Finish proving billing** — run `docs/BILLING.md` behind a `cloudflared` tunnel, authorize a sandbox UPI mandate through the checkout modal, confirm the webhook lands, then close the open items (invoices, retention, proration, dunning).
2. **Phase 4 — hardening & deploy** — structured logging/observability, consistent error handling, ML service auth (done), production config (B2 + Cloudflare / Neon / Railway Redis + secrets), biometric-compliance pass.

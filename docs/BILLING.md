# Billing setup (Cashfree)

PhotoDost sells **annual INR subscriptions** capped by total storage. This is the runbook for going from no Cashfree account to live billing.

**Nothing here is required to develop or test the product.** With `BILLING_ENABLED=false` (the default) every workspace runs on Beta quotas — unlimited events / 100 GB — usage is tracked so the meters are real, but nothing is capped and no payment is taken.

---

## The plan model

| Tier | Storage | Events | Price |
|---|---|---|---|
| Free | 500 MB | 1 | ₹0 — 7-day trial |
| Starter | 25 GB | unlimited | ₹999/yr |
| Pro | 50 GB | unlimited | ₹1,399/yr |
| Studio (`business`) | 100 GB | unlimited | ₹1,999/yr |

There is **no monthly cadence** and **no permanent free tier**. Every workspace starts on `free` with `trial_ends_at` set 7 days out; when that lapses, writes are blocked until it subscribes. Storage is the only cap on paid tiers because storage is the only cost that scales per customer — `event_quota` is `NULL` there, and NULL means unlimited.

## How it fits together

| Piece | Where |
|---|---|
| Plan catalog (prices, quotas, labels) | `apps/web/src/lib/storage.ts` → `PLANS` |
| Readiness / config guard | `apps/web/src/lib/billing-config.ts` |
| Cashfree REST client + signatures | `apps/web/src/lib/billing.ts` |
| Checkout start | `POST /api/billing/subscribe` |
| Checkout confirm (eager) | `POST /api/billing/confirm` |
| Webhook (authoritative) | `POST /api/billing/webhook` |
| Cancel (records intent) | `POST /api/billing/cancel` |
| Deferred cancel (does the work) | `apps/worker/src/billing-sweep.ts` |
| Customer-facing page | `/app/billing` |

`PLANS` is the single source of truth. The Cashfree plans are created **from** it, and the webhook mirrors the purchased plan's `eventQuota` / `quotaBytes` onto the workspace row. Change a price in one place.

### The safety interlock

`billingReady()` returns true only when `BILLING_ENABLED=true` **and** the app ID, secret key and a valid mode are present. Every quota decision keys off that, not the raw flag.

This is deliberate: enforcing per-plan quotas while Cashfree is unconfigured would cap a workspace with no way to upgrade — locking your own users out. A half-configured deploy stays in Beta and `/app/billing` says exactly which env var is missing.

---

## Setup

### 1. Create the account

1. Sign up at [cashfree.com](https://www.cashfree.com) → you land in **Sandbox**.
2. Complete KYC only when you're ready to take real money; sandbox works fully without it.
3. **Subscriptions** must be enabled on the account, with UPI Autopay and eNACH. If it isn't visible, request activation from support — this is the one step with a human in the loop, so do it early.

### 2. Get API credentials

Dashboard → **Developers** → **API Keys**. You get an **App ID** and a **Secret Key**; the secret is shown once.

```bash
CASHFREE_APP_ID=TEST1234567890abcdef
CASHFREE_SECRET_KEY=cfsk_ma_test_xxxxxxxxxxxx
CASHFREE_MODE=sandbox          # or production
```

Three variables, and that's all. Note what is **not** here:

- **No webhook secret.** Cashfree signs webhooks with the same `CASHFREE_SECRET_KEY`.
- **No plan IDs.** They're merchant-supplied and derived from the catalog by `cashfreePlanId()`, so they can't drift or go missing.

`CASHFREE_MODE` is load-bearing: Cashfree switches environments by **base URL** (`sandbox.cashfree.com/pg` vs `api.cashfree.com/pg`), not by key prefix. A sandbox key against the production host fails as a 401 that reads like a bad secret, so `billingConfigError()` cross-checks the two and refuses a mismatch up front.

### 3. Create the plans

```bash
pnpm billing:create-plans --dry-run   # preview
pnpm billing:create-plans             # create
```

Nothing to paste back. Re-running is safe — existing plans report `exists` and are left alone.

A live plan's amount can't be edited. To reprice: edit `PLANS`, give the tier a new plan ID, re-run. Existing subscribers stay on what they bought.

### 4. Create the webhook

Dashboard → **Developers** → **Webhooks** → **Add**.

- **URL:** `https://<your-domain>/api/billing/webhook`
- **Events:** `SUBSCRIPTION_STATUS_CHANGED`, `SUBSCRIPTION_AUTH_STATUS`, `SUBSCRIPTION_PAYMENT_SUCCESS`, `SUBSCRIPTION_PAYMENT_FAILED`

For local testing Cashfree needs a public URL:

```bash
cloudflared tunnel --url http://localhost:3030
# use the printed https URL for both the webhook and APP_URL
```

### 5. Flip the flag

```bash
BILLING_ENABLED=true
```

Restart the web app **and the worker** — the worker needs the same three Cashfree vars to run the deferred-cancellation sweep. If anything is missing, `/app/billing` names the exact variable and the app stays on Beta quotas.

---

## Testing a subscription

Sandbox UPI VPAs: `success@upi` authorizes the mandate, `failure@upi` declines it. Test cards work too — any future expiry, any CVV.

Walk through:

1. `/app/billing` → enter a mobile number → **Choose Pro** → checkout opens in a modal.
2. Authorize the mandate → the SDK callback calls `/api/billing/confirm` → the page shows **Pro**.
3. Confirm the webhook landed: Dashboard → Developers → Webhooks → your webhook → recent deliveries should show a 200.
4. Verify the row:

```sql
select plan, billing_plan_key, event_quota, storage_quota_bytes,
       subscription_status, current_period_end, cancel_at_period_end
from workspaces;
```

5. Test the lapse path: set `subscription_status='past_due'` by hand and confirm new events/uploads are blocked while the guest gallery still works.
6. Test the trial path: set `trial_ends_at` to the past on a `free` workspace and confirm the same.

Note `next_schedule_date` — the source of `current_period_end` — is null while a subscription is `INITIALIZED`. It only appears once the mandate is authorized, so a half-finished checkout leaves `current_period_end` null. That's expected.

---

## Behaviour notes

**The webhook is authoritative.** `/api/billing/confirm` exists only so the dashboard updates instantly instead of waiting on delivery. It takes **no request body**: Cashfree hands the browser no signature to verify, so instead the subscription ID is read from the caller's own workspace row (written by `/subscribe` before checkout opened) and re-fetched from the API. There is no client-supplied identifier at all, so a client cannot point it at someone else's subscription. Both paths call the same `applySubscriptionToWorkspace`, so whichever lands second is a no-op and redelivery is idempotent.

**Webhook signatures are unusual in three ways** and all three are easy to get wrong: the signed string is `timestamp + rawBody` (not the body alone), the digest is **base64** (not hex), and the key is the ordinary API secret. The headers are `x-webhook-signature` and `x-webhook-timestamp`.

**Not every event carries a full subscription.** Payment events describe the charge and may embed only a partial subscription. When the payload lacks a status or the `workspace_id` tag, the handler re-fetches the subscription from the API and applies that instead. A failed re-fetch returns 500 so Cashfree retries; a valid-but-unusable payload returns 200, because retrying our own data problem would just loop.

**Workspace mapping is server-side.** The workspace ID goes into `subscription_tags` at creation and is read back from there, so a forged callback can't retarget another tenant.

**Lapses block writes, not reads.** `past_due`, `canceled`, and an expired trial stop new events and uploads. Existing galleries, guest selfie search, and downloads keep working — a photographer's clients shouldn't lose their gallery because a card expired.

**Cancellation is at period end, and we implement it ourselves.** Cashfree's `CANCEL` action is immediate; there is no `cancel_at_cycle_end`. So `/api/billing/cancel` only sets `cancel_at_period_end` on the workspace and changes nothing else. The worker's daily sweep (`billing-sweep.ts`) issues the real CANCEL once `current_period_end` has passed, then drops the workspace to `free`. If the sweep fails it leaves the flag set and retries tomorrow — cancelling a day late is better than dropping a paying workspace's quotas while its mandate is still live.

**A ₹1 refundable authorization** is charged at mandate setup (`authorization_amount`). Without it a UPI Autopay mandate can register and only fail on the first real charge, which is a much worse place to discover a bad account.

---

---

## Retention — photos are deleted 7 days after access ends

**This deletes customer data permanently.** Implemented in `apps/worker/src/retention.ts`, running daily.

| Day | What happens |
|---|---|
| 0 | Paid period lapses (or trial expires). Writes blocked, galleries still live. **First email:** "photos kept until <date>". |
| 4 | **Final notice email:** "deleted in 3 days". |
| 7 | Objects, `assets` rows and `face_embeddings` deleted. Event rows survive as shells. |

Tunable via `RETENTION_GRACE_DAYS` and `RETENTION_FINAL_WARNING_DAYS` in `packages/db/src/schema.ts`.

**What survives:** the `events` rows, so a QR printed on a wedding invitation still resolves — `/g/[token]` renders "these photos are no longer available" instead of a 404. `guest_searches` is untouched.

### The anchor rule — read before changing

Everything keys off `accessEndedAtSql()` in `packages/db/src/retention.ts`, and **the clause order is load-bearing**:

1. `canceled` is checked **first**, because the billing sweep sets `plan = 'free'` when it drops a cancelled workspace. A former subscriber therefore looks like a free one, and if the trial branch ran first it would read their years-old `trial_ends_at` and purge immediately instead of after the grace period.
2. The trial branch accepts `trialing` **or** `incomplete` — an abandoned checkout parks a workspace in `incomplete` forever, and those uploads would otherwise never be collected.
3. `past_due` is deliberately absent. A declined card blocks writes but is recoverable; it must never destroy galleries.

`/app/billing` mirrors this same logic in TypeScript to show the countdown. If you change one, change both.

### Two safety properties

- **No silent deletion.** A workspace is only purged if the first warning email actually sent (`retention_warned_at IS NOT NULL`). A broken mailer blocks deletion rather than deleting quietly.
- **Objects before rows.** Deleting rows first and then crashing would lose the keys and orphan the bytes forever. This way a crash leaves rows pointing at already-deleted objects, which the next sweep retries and reconciliation accounts for. A partial object-delete failure aborts before touching the DB.

Bulk deletions are logged at `warn` with byte counts and land in `storage_ledger` under the `retention_purge` reason, distinct from a user's own `asset_delete`.

---

## Not built yet

- **GST-compliant invoices** — Cashfree can generate them, but nothing in the app requests or stores them.
- **Dunning** — no email is sent when a charge fails; the photographer only sees it on `/app/billing`.
- **Bulk download** — the retention emails tell people to download their photos, but there's no "download everything" button. They have to save them one at a time, which makes the warning much less actionable than it reads. Worth closing before launch.
- **Proration on upgrade/downgrade** — subscribing to a different tier creates a *new* subscription; the old one isn't cancelled automatically and no credit is issued. Handle mid-cycle plan changes before launch.
- **Trial expiry email** — the trial simply stops working on day 7 with no warning.

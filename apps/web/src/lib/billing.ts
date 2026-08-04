import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { env } from "./env";
import { CASHFREE_API_VERSION, cashfreeApiBase, cashfreeMode } from "./billing-config";
import {
  PLANS,
  type PaidPlan,
  type Plan,
  cashfreePlanId,
  isPaidPlan,
  parsePlanKey,
  planKey,
} from "./storage";

// ---------------------------------------------------------------------------
// REST client
// ---------------------------------------------------------------------------

export class CashfreeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "CashfreeError";
  }
}

/**
 * Cashfree authenticates with a pair of headers rather than HTTP Basic, and
 * pins payload shapes to `x-api-version` — an unset or older version silently
 * changes field names, so it is always sent.
 */
async function cashfreeFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown; idempotencyKey?: string },
): Promise<T> {
  if (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY) {
    throw new CashfreeError("Cashfree API credentials are not configured.", 500);
  }

  const headers: Record<string, string> = {
    "x-client-id": env.CASHFREE_APP_ID,
    "x-client-secret": env.CASHFREE_SECRET_KEY,
    "x-api-version": CASHFREE_API_VERSION,
    "Content-Type": "application/json",
  };
  // Cashfree dedupes retried writes on this key, which matters because our
  // subscription IDs are deterministic: a retry must not read as a new attempt.
  if (init?.idempotencyKey) headers["x-idempotency-key"] = init.idempotencyKey;

  const res = await fetch(`${cashfreeApiBase()}${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    // Never let a hung gateway hold a request open indefinitely.
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  const text = await res.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    // Cashfree returns errors flat: { code, message, type }.
    const code = typeof payload.code === "string" ? payload.code : undefined;
    const message =
      typeof payload.message === "string"
        ? payload.message
        : `Cashfree request failed (${res.status})`;
    throw new CashfreeError(message, res.status, code);
  }

  return payload as T;
}

/**
 * The subset of Cashfree's subscription entity we depend on. Statuses are
 * INITIALIZED | ACTIVE | PAUSED | CANCELLED | COMPLETED | FAILED.
 */
export interface CashfreeSubscription {
  subscription_id: string;
  cf_subscription_id?: string | null;
  subscription_status: string;
  /** Only present on the create response — this is what checkout consumes. */
  subscription_session_id?: string | null;
  customer_details?: {
    customer_name?: string | null;
    customer_email?: string | null;
    customer_phone?: string | null;
  } | null;
  plan_details?: { plan_id?: string | null } | null;
  authorisation_details?: {
    authorization_status?: string | null;
    authorization_reference?: string | null;
  } | null;
  /** ISO 8601. The next scheduled debit — our period end. */
  next_schedule_date?: string | null;
  subscription_expiry_time?: string | null;
  /** Echoed back on every webhook; how we map a subscription to a workspace. */
  subscription_tags?: Record<string, string> | null;
}

/**
 * A refundable ₹1 debit proves the mandate works at authorization time. Without
 * it a UPI Autopay mandate can be registered and only fail on the first real
 * charge, which is a much worse place to discover a bad account.
 */
const AUTHORIZATION_AMOUNT = 1;

/**
 * Build the merchant-supplied subscription ID. Cashfree lets us choose it, so
 * it encodes the workspace and a random suffix: readable in their dashboard,
 * and still unique across resubscribes (a workspace that cancels and comes back
 * must not collide with its own retired subscription).
 */
function newSubscriptionId(workspaceId: string): string {
  // Cashfree allows alphanumerics, dot, hyphen, underscore and space.
  const short = workspaceId.replace(/-/g, "").slice(0, 12);
  return `ws_${short}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/**
 * Create an annual subscription for a workspace and return it, including the
 * `subscription_session_id` the browser needs to open checkout.
 *
 * The subscription is *not* paid at this point — the webhook is authoritative.
 */
export async function createSubscription(opts: {
  plan: PaidPlan;
  workspaceId: string;
  email: string;
  phone: string;
  customerName: string;
  returnUrl: string;
}): Promise<CashfreeSubscription> {
  const subscriptionId = newSubscriptionId(opts.workspaceId);

  return cashfreeFetch<CashfreeSubscription>("/subscriptions", {
    method: "POST",
    idempotencyKey: randomUUID(),
    body: {
      subscription_id: subscriptionId,
      customer_details: {
        customer_name: opts.customerName,
        customer_email: opts.email,
        customer_phone: opts.phone,
      },
      // Reference the pre-created plan rather than inlining one, so the amount
      // charged is always the catalog's and can't drift per subscription.
      plan_details: { plan_id: cashfreePlanId(opts.plan) },
      authorization_details: {
        authorization_amount: AUTHORIZATION_AMOUNT,
        authorization_amount_refund: true,
        payment_methods: ["upi", "card", "enach"],
      },
      subscription_meta: {
        return_url: opts.returnUrl,
        notification_channel: ["EMAIL"],
      },
      // Echoed back on every webhook — this is how we map a Cashfree
      // subscription to a workspace without trusting the client.
      subscription_tags: {
        workspace_id: opts.workspaceId,
        plan_key: planKey(opts.plan),
      },
    },
  });
}

export async function fetchSubscription(subscriptionId: string): Promise<CashfreeSubscription> {
  return cashfreeFetch<CashfreeSubscription>(
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
  );
}

/**
 * Cancel a subscription **immediately**.
 *
 * Cashfree has no cancel-at-cycle-end option, so this is not what
 * `/api/billing/cancel` calls. That route records intent on the workspace and
 * the worker's daily sweep calls this once the paid period has actually lapsed
 * — see `apps/worker/src/billing-sweep.ts`.
 */
export async function cancelSubscriptionNow(subscriptionId: string): Promise<CashfreeSubscription> {
  return cashfreeFetch<CashfreeSubscription>(
    `/subscriptions/${encodeURIComponent(subscriptionId)}/manage`,
    {
      method: "POST",
      body: { subscription_id: subscriptionId, action: "CANCEL" },
    },
  );
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/** Constant-time compare of two base64 digests. */
function safeEqualBase64(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "base64");
  const bufB = Buffer.from(b, "base64");
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a Cashfree webhook.
 *
 * Three things differ from most gateways and all of them are easy to get wrong:
 * the signed string is `timestamp + rawBody` (not the body alone), the digest is
 * **base64** (not hex), and the signing key is the ordinary API secret — there
 * is no separate webhook secret to configure.
 *
 * MUST be given the raw request body: re-serializing the parsed JSON changes
 * the bytes and the HMAC will not match.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
): boolean {
  if (!signature || !timestamp || !env.CASHFREE_SECRET_KEY) return false;
  const expected = createHmac("sha256", env.CASHFREE_SECRET_KEY)
    .update(timestamp + rawBody)
    .digest("base64");
  return safeEqualBase64(expected, signature);
}

// ---------------------------------------------------------------------------
// Status mapping + persistence
// ---------------------------------------------------------------------------

type SubscriptionStatus = (typeof schema.subscriptionStatus.enumValues)[number];

/**
 * Map Cashfree's subscription lifecycle onto our provider-neutral enum.
 *
 *   ACTIVE               → active
 *   PAUSED               → past_due   (access frozen, recoverable)
 *   CANCELLED/COMPLETED  → canceled
 *   FAILED               → past_due   (mandate or charge failed; recoverable
 *                                      by re-authorizing, so not terminal)
 *   INITIALIZED          → incomplete (mandate not yet authorized)
 */
export function mapSubscriptionStatus(cashfreeStatus: string): SubscriptionStatus {
  switch (cashfreeStatus.toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "PAUSED":
    case "FAILED":
      return "past_due";
    case "CANCELLED":
    case "COMPLETED":
      return "canceled";
    case "INITIALIZED":
    default:
      return "incomplete";
  }
}

/** Parse a Cashfree ISO 8601 timestamp, tolerating null/garbage. */
function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Apply a Cashfree subscription to its workspace: mirror the purchased plan's
 * quotas onto the row and record the provider IDs + status.
 *
 * The workspace is resolved from `subscription_tags.workspace_id`, which we set
 * at creation time — so a forged webhook body can't retarget another tenant
 * (the HMAC is checked first anyway).
 */
export async function applySubscriptionToWorkspace(
  sub: CashfreeSubscription,
): Promise<{ ok: true; workspaceId: string } | { ok: false; reason: string }> {
  const workspaceId = sub.subscription_tags?.workspace_id;
  if (!workspaceId) {
    return {
      ok: false,
      reason: `subscription ${sub.subscription_id} has no workspace_id tag`,
    };
  }

  const parsed = parsePlanKey(sub.subscription_tags?.plan_key ?? null);
  if (!parsed) {
    return {
      ok: false,
      reason: `subscription ${sub.subscription_id} has no recognizable plan_key tag`,
    };
  }

  const status = mapSubscriptionStatus(sub.subscription_status);

  // A canceled/completed subscription must not keep its paid allotments. It
  // drops to the free tier's caps rather than to a paid tier's, so nothing is
  // left pointing at allotments it isn't paying for.
  const lapsed = status === "canceled";
  const target: Plan = lapsed ? "free" : parsed.plan;

  const [updated] = await db
    .update(schema.workspaces)
    .set({
      plan: target,
      eventQuota: PLANS[target].eventQuota,
      storageQuotaBytes: PLANS[target].quotaBytes,
      billingSubscriptionId: sub.subscription_id,
      billingCustomerId: sub.cf_subscription_id ?? null,
      billingPlanKey: planKey(parsed.plan),
      subscriptionStatus: status,
      currentPeriodEnd: parseDate(sub.next_schedule_date),
      // A fresh activation clears any earlier cancel intent — resubscribing
      // must not inherit a pending cancellation from a previous cycle.
      ...(status === "active" ? { cancelAtPeriodEnd: false } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.workspaces.id, workspaceId))
    .returning({ id: schema.workspaces.id });

  if (!updated) return { ok: false, reason: `workspace ${workspaceId} not found` };
  return { ok: true, workspaceId: updated.id };
}

/** Rupee formatting for plan cards and invoices copy. */
export function formatInr(rupees: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}

export { cashfreeMode, isPaidPlan };
export { billingConfigError, billingReady } from "./billing-config";

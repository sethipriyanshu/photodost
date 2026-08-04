import "server-only";
import { NextResponse } from "next/server";
import { count, eq, sql } from "drizzle-orm";
import { TRIAL_DAYS } from "@photodost/db";
import { db, schema } from "./db";
import { env } from "./env";
import { billingReady } from "./billing-config";

const MB = 1024 * 1024;
const GB = 1024 * MB;

export { TRIAL_DAYS };

export type Plan = (typeof schema.plan.enumValues)[number];

/**
 * A paid plan. `free` is the trial tier — it has no price and no Cashfree plan
 * object, so anything that talks to the gateway is typed against this instead.
 */
export type PaidPlan = Exclude<Plan, "free">;

export const PAID_PLANS: readonly PaidPlan[] = ["starter", "pro", "business"] as const;

export function isPaidPlan(plan: Plan): plan is PaidPlan {
  return plan !== "free";
}

export interface PlanDefinition {
  label: string;
  /** Null means unlimited — storage is the only cap on paid tiers. */
  eventQuota: number | null;
  quotaBytes: number;
  /** Whole rupees per year. Zero for the free tier. */
  priceInr: number;
  blurb: string;
}

/**
 * Plan catalog. Config-as-code so the quotas we enforce can never drift from
 * the plan definition, and so the Cashfree plans can be created straight from
 * this map (`pnpm billing:create-plans`).
 *
 * Billing is **annual only** — there is no monthly cadence. Storage is the sole
 * cap on paid tiers because it is the only cost that scales with a customer;
 * event count is capped only on the free trial.
 *
 * Note: the DB enum's top tier is `business`, branded "Studio" in the UI.
 */
export const PLANS: Record<Plan, PlanDefinition> = {
  free: {
    label: "Free",
    eventQuota: 1,
    quotaBytes: 500 * MB,
    priceInr: 0,
    blurb: `One event, ${TRIAL_DAYS} days, no card needed.`,
  },
  starter: {
    label: "Starter",
    eventQuota: null,
    quotaBytes: 25 * GB,
    priceInr: 999,
    blurb: "For photographers shooting a few events a year.",
  },
  pro: {
    label: "Pro",
    eventQuota: null,
    quotaBytes: 50 * GB,
    priceInr: 1399,
    blurb: "For a working studio with a steady season.",
  },
  business: {
    label: "Studio",
    eventQuota: null,
    quotaBytes: 100 * GB,
    priceInr: 1999,
    blurb: "For teams running events every week.",
  },
};

/**
 * Catalog key stored on the workspace row and echoed in Cashfree's
 * `subscription_tags`, e.g. "pro". Now that billing is annual-only this is just
 * the plan name, but it stays a distinct function because it is a wire format:
 * it round-trips through the gateway and back via the webhook.
 */
export function planKey(plan: Plan): string {
  return plan;
}

/** Inverse of `planKey`. Returns null for anything unrecognized or unpayable. */
export function parsePlanKey(key: string | null): { plan: PaidPlan } | null {
  if (!key) return null;
  // Tolerate the legacy "plan:cadence" form so a workspace that subscribed
  // under the Razorpay catalog still renders its plan instead of falling back
  // to Beta. The cadence half is discarded — everything is annual now.
  const name = key.split(":")[0];
  if (!name || !(name in PLANS)) return null;
  const plan = name as Plan;
  if (!isPaidPlan(plan)) return null;
  return { plan };
}

/** The deterministic Cashfree plan_id for a tier. Merchant-supplied, so it
 * derives from the catalog rather than living in an env var. */
export function cashfreePlanId(plan: PaidPlan): string {
  return `photodost_${plan}_annual`;
}

export function quotaForPlan(plan: Plan): number {
  return PLANS[plan].quotaBytes;
}

// ---------------------------------------------------------------------------
// Beta mode. Until billing is live, every workspace runs on a generous Beta
// plan: usage is still tracked so the meters are real, but the caps are high
// enough that nothing blocks testing.
//
// Note this keys off `billingReady()`, not the raw BILLING_ENABLED flag —
// enforcing per-plan quotas while Cashfree is unconfigured would leave a
// workspace capped with no way to upgrade, so a misconfigured deploy stays in
// Beta rather than locking its own users out.
// ---------------------------------------------------------------------------
export const BILLING_ENABLED = env.BILLING_ENABLED;

/** Beta allowance: unlimited events (null), 100 GB of storage. */
const BETA_QUOTAS = { eventQuota: null, storageQuotaBytes: 100 * GB } as const;

export interface EffectiveQuotas {
  /** Null means unlimited. */
  eventQuota: number | null;
  storageQuotaBytes: number;
}

/**
 * The quotas actually enforced for a workspace right now. In Beta this is the
 * generous shared allowance; once billing is live it's the workspace's own
 * plan-derived columns.
 */
export function effectiveQuotas(ws: {
  eventQuota: number | null;
  storageQuotaBytes: number;
}): EffectiveQuotas {
  if (!billingReady()) return { ...BETA_QUOTAS };
  return { eventQuota: ws.eventQuota, storageQuotaBytes: ws.storageQuotaBytes };
}

export interface Usage {
  usedBytes: number;
  quotaBytes: number;
  remainingBytes: number;
  plan: Plan;
}

export function usageFromWorkspace(ws: {
  storageUsedBytes: number;
  storageQuotaBytes: number;
  plan: Plan;
}): Usage {
  return {
    usedBytes: ws.storageUsedBytes,
    quotaBytes: ws.storageQuotaBytes,
    remainingBytes: Math.max(0, ws.storageQuotaBytes - ws.storageUsedBytes),
    plan: ws.plan,
  };
}

/**
 * Reserve check at presign time: would adding `additionalBytes` blow the cap?
 * Best-effort (uses the denormalized counter) — the authoritative commit at
 * finalize re-checks against real object sizes. Reads fresh from the DB so a
 * stale page render can't let an over-cap upload start.
 */
export async function checkQuota(
  workspaceId: string,
  additionalBytes: number,
): Promise<{ ok: boolean; usage: Usage }> {
  const [ws] = await db
    .select({
      storageUsedBytes: schema.workspaces.storageUsedBytes,
      storageQuotaBytes: schema.workspaces.storageQuotaBytes,
      eventQuota: schema.workspaces.eventQuota,
      plan: schema.workspaces.plan,
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);

  if (!ws)
    return { ok: false, usage: { usedBytes: 0, quotaBytes: 0, remainingBytes: 0, plan: "free" } };

  const { storageQuotaBytes } = effectiveQuotas(ws);
  const usage = usageFromWorkspace({ ...ws, storageQuotaBytes });
  return { ok: usage.usedBytes + additionalBytes <= usage.quotaBytes, usage };
}

/**
 * Whether the workspace's billing state should block new writes, and which
 * state caused it. Returns null in Beta mode (nothing to enforce).
 *
 * `trial_expired` is the free tier's 7-day window running out: the workspace
 * has never paid and its trial is over, so it can't create or upload until it
 * subscribes. `incomplete` is deliberately not blocking — that's a checkout
 * mid-flight, and the storage caps already bound what it can do.
 */
export function subscriptionBlock(ws: {
  plan: Plan;
  subscriptionStatus: (typeof schema.subscriptionStatus.enumValues)[number];
  trialEndsAt: Date | null;
}): "past_due" | "canceled" | "trial_expired" | null {
  if (!billingReady()) return null;
  if (ws.subscriptionStatus === "past_due") return "past_due";
  if (ws.subscriptionStatus === "canceled") return "canceled";
  if (ws.plan === "free" && ws.trialEndsAt && ws.trialEndsAt.getTime() <= Date.now()) {
    return "trial_expired";
  }
  return null;
}

export interface EventUsage {
  used: number;
  /** Null means unlimited. */
  quota: number | null;
  /** Null when the quota is unlimited. */
  remaining: number | null;
}

/**
 * Event-count quota check at create time. Best-effort like `checkQuota` (a
 * concurrent create could momentarily exceed the cap — acceptable for a soft
 * cap). Returns the current usage so callers can render an upgrade prompt.
 *
 * A null quota means unlimited, which is every paid tier: storage is the only
 * dimension that scales with cost, so only the free trial caps event count.
 */
export async function checkEventQuota(
  workspaceId: string,
): Promise<{ ok: boolean; usage: EventUsage }> {
  const [ws] = await db
    .select({
      eventQuota: schema.workspaces.eventQuota,
      storageQuotaBytes: schema.workspaces.storageQuotaBytes,
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);

  // A missing workspace gets a zero quota, not an unlimited one — failing open
  // here would let an orphaned ID create events without limit.
  const quota = ws ? effectiveQuotas(ws).eventQuota : 0;

  const [row] = await db
    .select({ n: count() })
    .from(schema.events)
    .where(eq(schema.events.workspaceId, workspaceId));
  const used = Number(row?.n ?? 0);

  if (quota === null) return { ok: true, usage: { used, quota: null, remaining: null } };
  return { ok: used < quota, usage: { used, quota, remaining: Math.max(0, quota - used) } };
}

type Reason = (typeof schema.storageLedger.reason.enumValues)[number];
// A db handle or a transaction handle — both expose insert/update/select, so
// callers can run a delta atomically with the row change that caused it.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type StorageExecutor = typeof db | Tx;

/**
 * Record a usage change: bump the workspace counter and append a ledger row in
 * one statement each. Pass a transaction handle (`tx`) to make it atomic with
 * the row insert/delete that caused it. Positive delta adds, negative frees.
 */
export async function recordStorageDelta(
  exec: StorageExecutor,
  opts: { workspaceId: string; deltaBytes: number; reason: Reason; objectKey?: string | null },
): Promise<void> {
  if (opts.deltaBytes === 0) return;
  await exec
    .update(schema.workspaces)
    .set({
      // Clamp at 0 so a double-decrement can't drive usage negative.
      storageUsedBytes: sql`GREATEST(0, ${schema.workspaces.storageUsedBytes} + ${opts.deltaBytes})`,
      updatedAt: new Date(),
    })
    .where(eq(schema.workspaces.id, opts.workspaceId));

  await exec.insert(schema.storageLedger).values({
    workspaceId: opts.workspaceId,
    deltaBytes: opts.deltaBytes,
    reason: opts.reason,
    objectKey: opts.objectKey ?? null,
  });
}

/**
 * Standard 402 Payment Required response when a workspace is out of storage.
 * Includes a `code` and figures the client can render an upgrade prompt from.
 */
export function quotaExceededResponse(usage: Usage, requestedBytes: number): NextResponse {
  return NextResponse.json(
    {
      error: "Storage limit reached",
      code: "quota_exceeded",
      plan: usage.plan,
      usedBytes: usage.usedBytes,
      quotaBytes: usage.quotaBytes,
      remainingBytes: usage.remainingBytes,
      requestedBytes,
      upgradeUrl: "/app/billing",
      message: `This upload needs ${formatBytes(requestedBytes)} but only ${formatBytes(
        usage.remainingBytes,
      )} is left on your ${PLANS[usage.plan].label} plan. Upgrade to add more storage.`,
    },
    { status: 402 },
  );
}

/**
 * 402 for a workspace whose subscription has lapsed. Distinct from a quota
 * block: the fix is fixing payment, not buying a bigger plan.
 *
 * Note this gates *writes* only. Guest galleries and existing photos stay
 * readable — a photographer's clients shouldn't lose their gallery because a
 * card expired.
 */
export function subscriptionLapsedResponse(
  status: "past_due" | "canceled" | "trial_expired",
): NextResponse {
  const message =
    status === "past_due"
      ? "A payment on your subscription failed. Update it to keep uploading — your existing galleries stay live."
      : status === "trial_expired"
        ? `Your ${TRIAL_DAYS}-day free trial has ended. Choose a plan to create events and upload again — what you've already shared stays live.`
        : "Your subscription has ended. Renew to create events and upload again — your existing galleries stay live.";

  return NextResponse.json(
    {
      error: "Subscription inactive",
      code: "subscription_inactive",
      status,
      upgradeUrl: "/app/billing",
      message,
    },
    { status: 402 },
  );
}

/** Human-readable bytes for error messages / UI. */
export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

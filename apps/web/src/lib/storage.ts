import "server-only";
import { NextResponse } from "next/server";
import { count, eq, sql } from "drizzle-orm";
import { TRIAL_DAYS } from "@photodost/db";
import { db, schema } from "./db";
import { env } from "./env";

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
    quotaBytes: 10 * GB,
    priceInr: 999,
    blurb: "For a single event or a smaller shoot.",
  },
  pro: {
    label: "Pro",
    eventQuota: null,
    quotaBytes: 50 * GB,
    priceInr: 2499,
    blurb: "For a working studio with a steady season.",
  },
  business: {
    label: "Studio",
    eventQuota: null,
    quotaBytes: 100 * GB,
    priceInr: 3999,
    blurb: "For teams running events every week.",
  },
};

/**
 * The selling points shown on a plan card.
 *
 * Single source of truth because two pages render these — the public landing
 * page and `/app/billing` — and a customer seeing fewer features than the
 * marketing page promised is a bad way to find out they've drifted.
 *
 * Ordered so the concrete, verifiable things come first and the service-level
 * promises last.
 */
export function planFeatures(plan: PaidPlan): string[] {
  const gb = Math.round(PLANS[plan].quotaBytes / (1024 * 1024 * 1024));
  // PAID_PLANS is ordered cheapest first; index 0 is the entry tier.
  const tier = PAID_PLANS.indexOf(plan);

  return [
    `${gb} GB storage`,
    "Unlimited events",
    "Unlimited albums",
    "Face matching on every photo",
    "Unlimited guest selfie searches",
    "QR code sharing",
    tier === 0 ? "Buy additional storage anytime" : "Additional storage at discounted rates",
    tier === 0
      ? "Chat & email support"
      : tier === 1
        ? "Priority chat support"
        : "Priority 24/7 chat & call support",
    ...(tier === 0 ? [] : ["Enhanced cloud backup"]),
  ];
}

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
// Quota enforcement
//
// Quotas come from the workspace's own plan columns, always. There is no
// payment gateway in V1 — plans are sold in person and provisioned by the admin
// — so there is nothing to gate enforcement on.
//
// This used to key off `billingReady()`, which meant "no gateway configured"
// silently granted every workspace a 100 GB Beta allowance. Under the current
// model that would make an admin-assigned plan decorative: someone sold a 25 GB
// plan would quietly get 100 GB.
//
// The original reasoning for the interlock — never cap a workspace that has no
// way to upgrade — still holds, but the upgrade path is now a phone call rather
// than a checkout page, so it's always available.
// ---------------------------------------------------------------------------
export const BILLING_ENABLED = env.BILLING_ENABLED;

export interface EffectiveQuotas {
  /** Null means unlimited. */
  eventQuota: number | null;
  storageQuotaBytes: number;
}

/**
 * The quotas actually enforced for a workspace right now: whatever its plan
 * allots. The free tier's 500 MB / 1 event is the 7-day trial; every paid tier
 * is storage-capped with unlimited events.
 */
export function effectiveQuotas(ws: {
  eventQuota: number | null;
  storageQuotaBytes: number;
}): EffectiveQuotas {
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
 * Whether the workspace's state should block new writes, and what caused it.
 *
 * All four cases block creating events and uploading, and none of them touch
 * reads: existing galleries, guest selfie search and downloads keep working. A
 * photographer's clients shouldn't lose access to their wedding photos because
 * the photographer's term lapsed — they aren't the ones who owe anything.
 *
 *   trial_expired — the free tier's 7-day window ran out
 *   plan_expired  — an admin-provisioned term reached its end and wasn't renewed
 *   canceled      — the admin cancelled the account
 *   past_due      — legacy gateway state; retained so old rows behave sensibly
 */
export function subscriptionBlock(ws: {
  plan: Plan;
  subscriptionStatus: (typeof schema.subscriptionStatus.enumValues)[number];
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}): "past_due" | "canceled" | "trial_expired" | "plan_expired" | null {
  if (ws.subscriptionStatus === "past_due") return "past_due";
  if (ws.subscriptionStatus === "canceled") return "canceled";

  // A paid term that simply ran out. Checked before the trial branch because a
  // lapsed paid account keeps `plan` set, and its `trialEndsAt` is null anyway.
  if (ws.plan !== "free" && ws.currentPeriodEnd && ws.currentPeriodEnd.getTime() <= Date.now()) {
    return "plan_expired";
  }

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
  status: "past_due" | "canceled" | "trial_expired" | "plan_expired",
): NextResponse {
  const message =
    status === "trial_expired"
      ? `Your ${TRIAL_DAYS}-day free trial has ended. Contact us to choose a plan — what you've already shared stays live for your guests.`
      : status === "plan_expired"
        ? "Your plan has ended. Contact us to renew and start uploading again — your existing galleries stay live for your guests."
        : status === "past_due"
          ? "There's a problem with your plan. Contact us to sort it out — your existing galleries stay live."
          : "Your account has been closed. Contact us to reactivate it — your existing galleries stay live for your guests.";

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
  // Empty is genuinely zero. The floor below exists so a small-but-real file
  // never reads as "0 KB", but an untouched account should say 0, not 1 KB.
  if (bytes <= 0) return "0 KB";
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

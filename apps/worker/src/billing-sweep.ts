import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db, schema } from "./db.js";
import { env } from "./env.js";
import { logger } from "./logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deferred cancellation sweep.
 *
 * Cashfree's CANCEL action is immediate — there is no cancel-at-cycle-end
 * option. So `/api/billing/cancel` only records intent (`cancel_at_period_end`)
 * and this job does the real work once the paid period has actually lapsed:
 * call Cashfree, then drop the workspace to the free tier's caps.
 *
 * Without this, a scheduled cancellation would never take effect and a
 * workspace would keep its paid quotas indefinitely.
 */

const FREE_QUOTA_BYTES = 500 * 1024 * 1024;
const FREE_EVENT_QUOTA = 1;

function apiBase(): string {
  return env.CASHFREE_MODE === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

/**
 * Issue the real CANCEL. Treats "already cancelled" as success: the webhook may
 * have beaten us to it, and either way the desired end state is the same.
 */
async function cancelAtCashfree(subscriptionId: string): Promise<void> {
  const res = await fetch(
    `${apiBase()}/subscriptions/${encodeURIComponent(subscriptionId)}/manage`,
    {
      method: "POST",
      headers: {
        "x-client-id": env.CASHFREE_APP_ID,
        "x-client-secret": env.CASHFREE_SECRET_KEY,
        "x-api-version": "2026-01-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subscription_id: subscriptionId, action: "CANCEL" }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (res.ok) return;

  const text = await res.text().catch(() => "");
  // A subscription that's already cancelled/completed is the end state we want.
  if (/already|cancel|not\s*active|invalid.*status/i.test(text)) {
    logger.info({ subscriptionId, body: text }, "subscription already inactive at Cashfree");
    return;
  }
  throw new Error(`Cashfree CANCEL failed (${res.status}): ${text}`);
}

/**
 * Cancel every subscription whose period has ended and which the customer asked
 * to end. Idempotent: a workspace is only picked up while it still has
 * `cancel_at_period_end` set, and the update that clears it is the same
 * statement that drops the quotas.
 */
export async function sweepScheduledCancellationsOnce(): Promise<void> {
  if (!env.BILLING_ENABLED || !env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY) {
    logger.debug("billing sweep skipped (billing not configured)");
    return;
  }

  let due: { id: string; billingSubscriptionId: string | null }[];
  try {
    due = await db
      .select({
        id: schema.workspaces.id,
        billingSubscriptionId: schema.workspaces.billingSubscriptionId,
      })
      .from(schema.workspaces)
      .where(
        and(
          eq(schema.workspaces.cancelAtPeriodEnd, true),
          isNotNull(schema.workspaces.currentPeriodEnd),
          lte(schema.workspaces.currentPeriodEnd, sql`now()`),
        ),
      );
  } catch (err) {
    logger.error({ err }, "billing sweep could not query due cancellations");
    return;
  }

  if (due.length === 0) {
    logger.debug("billing sweep: nothing due");
    return;
  }

  for (const ws of due) {
    try {
      if (ws.billingSubscriptionId) {
        await cancelAtCashfree(ws.billingSubscriptionId);
      }

      await db
        .update(schema.workspaces)
        .set({
          plan: "free",
          eventQuota: FREE_EVENT_QUOTA,
          storageQuotaBytes: FREE_QUOTA_BYTES,
          subscriptionStatus: "canceled",
          cancelAtPeriodEnd: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.workspaces.id, ws.id));

      logger.info(
        { workspaceId: ws.id, subscriptionId: ws.billingSubscriptionId },
        "scheduled cancellation applied; workspace dropped to free",
      );
    } catch (err) {
      // Leave the flag set so the next sweep retries. Better to cancel a day
      // late than to drop a paying workspace's quotas while its mandate is
      // still live at the gateway.
      logger.error(
        { err, workspaceId: ws.id, subscriptionId: ws.billingSubscriptionId },
        "scheduled cancellation failed; will retry on next sweep",
      );
    }
  }
}

export function startBillingSweep(): NodeJS.Timeout {
  void sweepScheduledCancellationsOnce();
  const timer = setInterval(() => void sweepScheduledCancellationsOnce(), DAY_MS);
  // Don't keep the process alive solely for this timer.
  timer.unref?.();
  return timer;
}

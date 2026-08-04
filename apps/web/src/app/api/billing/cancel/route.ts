import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSessionWorkspace } from "@/lib/session";
import { db, schema } from "@/lib/db";
import { billingReady } from "@/lib/billing";

export const runtime = "nodejs";

/**
 * Cancel the workspace's subscription at the end of the paid period.
 *
 * Cashfree has no cancel-at-cycle-end option — its CANCEL action terminates the
 * mandate on the spot — so this route deliberately does **not** call Cashfree.
 * It records the intent, leaves quotas and access exactly as they are, and lets
 * the worker's daily sweep issue the real CANCEL once `current_period_end` has
 * passed (see apps/worker/src/billing-sweep.ts).
 *
 * The alternative — cancelling immediately — would take a year of paid access
 * away from someone who cancels in month one, and take their clients' galleries
 * down with it.
 */
export async function POST(): Promise<NextResponse> {
  const ctx = await getSessionWorkspace();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!billingReady()) {
    return NextResponse.json({ error: "Billing is not available." }, { status: 503 });
  }

  if (!ctx.workspace.billingSubscriptionId) {
    return NextResponse.json({ error: "No active subscription." }, { status: 400 });
  }

  if (ctx.workspace.cancelAtPeriodEnd) {
    // Idempotent: a double-click shouldn't read as an error.
    return NextResponse.json({ ok: true, alreadyScheduled: true });
  }

  await db
    .update(schema.workspaces)
    .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
    .where(eq(schema.workspaces.id, ctx.workspace.id));

  console.info(
    `[billing/cancel] scheduled cancellation for workspace ${ctx.workspace.id} ` +
      `(subscription ${ctx.workspace.billingSubscriptionId}, ` +
      `period ends ${ctx.workspace.currentPeriodEnd?.toISOString() ?? "unknown"})`,
  );

  return NextResponse.json({ ok: true, effectiveAt: ctx.workspace.currentPeriodEnd });
}

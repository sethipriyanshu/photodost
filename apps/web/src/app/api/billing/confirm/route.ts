import { NextResponse } from "next/server";
import {
  CashfreeError,
  applySubscriptionToWorkspace,
  billingReady,
  fetchSubscription,
} from "@/lib/billing";
import { getSessionWorkspace } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Called by the checkout callback in the browser, and again when the billing
 * page loads after Cashfree's return redirect.
 *
 * This is a *convenience* path so the dashboard reflects the new plan
 * immediately instead of waiting on webhook delivery. The webhook remains
 * authoritative, and both paths funnel into the same
 * `applySubscriptionToWorkspace`, so whichever lands second is a no-op.
 *
 * Unlike the Razorpay version this takes **no request body**. Cashfree hands the
 * browser no signature to verify, so there is nothing a client could usefully
 * assert; instead the subscription ID is read from the caller's own workspace
 * row (written by /subscribe before checkout opened) and re-fetched from
 * Cashfree. A client therefore cannot point this at a subscription that isn't
 * theirs — there is no client-supplied identifier at all.
 */
export async function POST(): Promise<NextResponse> {
  const ctx = await getSessionWorkspace();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!billingReady()) {
    return NextResponse.json({ error: "Billing is not available." }, { status: 503 });
  }

  const subscriptionId = ctx.workspace.billingSubscriptionId;
  if (!subscriptionId) {
    return NextResponse.json({ error: "No subscription to confirm." }, { status: 400 });
  }

  try {
    const subscription = await fetchSubscription(subscriptionId);

    // Belt and braces: the ID came from our own row, but the tag is what
    // `applySubscriptionToWorkspace` keys the write off, so verify the two
    // agree before letting it run.
    const taggedWorkspace = subscription.subscription_tags?.workspace_id;
    if (taggedWorkspace !== ctx.workspace.id) {
      console.warn(
        `[billing/confirm] workspace mismatch: subscription ${subscriptionId} ` +
          `is tagged ${taggedWorkspace ?? "unknown"}, caller is ${ctx.workspace.id}`,
      );
      return NextResponse.json({ error: "This subscription is not yours." }, { status: 403 });
    }

    const result = await applySubscriptionToWorkspace(subscription);
    if (!result.ok) {
      console.error(`[billing/confirm] could not apply: ${result.reason}`);
      return NextResponse.json({ error: "Could not activate the plan." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status: subscription.subscription_status });
  } catch (err) {
    if (err instanceof CashfreeError) {
      console.error(`[billing/confirm] Cashfree error (${err.status}): ${err.message}`);
      return NextResponse.json({ error: "Could not reach Cashfree." }, { status: 502 });
    }
    console.error("[billing/confirm] unexpected error", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}

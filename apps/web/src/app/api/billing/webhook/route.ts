import { NextResponse } from "next/server";
import {
  applySubscriptionToWorkspace,
  fetchSubscription,
  verifyWebhookSignature,
  type CashfreeSubscription,
} from "@/lib/billing";

export const runtime = "nodejs";
// Signature verification needs the exact bytes Cashfree signed, so this route
// must never be statically optimized or have its body pre-parsed.
export const dynamic = "force-dynamic";

/**
 * Cashfree subscription webhook.
 *
 * Subscribe to these events when creating the webhook in the dashboard:
 *   SUBSCRIPTION_STATUS_CHANGED, SUBSCRIPTION_AUTH_STATUS,
 *   SUBSCRIPTION_PAYMENT_SUCCESS, SUBSCRIPTION_PAYMENT_FAILED
 *
 * Unlike Razorpay, the events do not all carry a complete subscription entity —
 * payment events describe the *charge*, and the embedded subscription block can
 * be partial. So when the payload lacks what we need to apply a change, the
 * subscription is re-fetched from the API and that is applied instead. Doing so
 * also keeps redelivery idempotent: the same event twice writes the same row.
 */
export async function POST(req: Request): Promise<NextResponse> {
  // Raw text, not req.json() — re-serializing would change the bytes.
  const rawBody = await req.text();
  const signature = req.headers.get("x-webhook-signature");
  const timestamp = req.headers.get("x-webhook-timestamp");

  if (!verifyWebhookSignature(rawBody, signature, timestamp)) {
    console.warn("[billing/webhook] rejected: bad or missing signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: {
    type?: string;
    event_time?: string;
    data?: {
      subscription_details?: Partial<CashfreeSubscription>;
      subscription?: Partial<CashfreeSubscription>;
    };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const event = payload.type ?? "unknown";
  // Cashfree nests the subscription under different keys depending on the event
  // family, so accept either shape.
  const embedded = payload.data?.subscription_details ?? payload.data?.subscription;
  const subscriptionId = embedded?.subscription_id;

  if (!subscriptionId) {
    // Acknowledge so Cashfree stops retrying something we can't act on.
    console.info(`[billing/webhook] ignoring ${event} (no subscription id)`);
    return NextResponse.json({ received: true, ignored: event });
  }

  // Apply from the payload when it's complete enough; otherwise ask the API.
  // The tags carry the workspace mapping, so a payload without them is unusable
  // regardless of how much else it contains.
  let subscription: CashfreeSubscription;
  if (embedded.subscription_status && embedded.subscription_tags?.workspace_id) {
    subscription = embedded as CashfreeSubscription;
  } else {
    try {
      subscription = await fetchSubscription(subscriptionId);
    } catch (err) {
      // 500 so Cashfree retries — unlike a data problem, a failed fetch is
      // transient and redelivery is exactly what should happen.
      console.error(`[billing/webhook] ${event}: could not fetch ${subscriptionId}`, err);
      return NextResponse.json({ error: "Could not load subscription" }, { status: 500 });
    }
  }

  const result = await applySubscriptionToWorkspace(subscription);

  if (!result.ok) {
    // 200 on purpose: the signature was valid, so retrying won't help — this is
    // our data problem to fix, not a delivery failure. Retries would just loop.
    console.error(`[billing/webhook] ${event} could not be applied: ${result.reason}`);
    return NextResponse.json({ received: true, applied: false, reason: result.reason });
  }

  console.info(
    `[billing/webhook] ${event} applied to workspace ${result.workspaceId} ` +
      `(subscription ${subscription.subscription_id} → ${subscription.subscription_status})`,
  );

  return NextResponse.json({ received: true, applied: true });
}

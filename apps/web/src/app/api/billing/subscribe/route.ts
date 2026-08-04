import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSessionWorkspace } from "@/lib/session";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import {
  CashfreeError,
  billingConfigError,
  billingReady,
  cashfreeMode,
  createSubscription,
} from "@/lib/billing";
import { PLANS, planKey } from "@/lib/storage";

export const runtime = "nodejs";

const inputSchema = z.object({
  plan: z.enum(["starter", "pro", "business"]),
  // Cashfree requires a customer phone number on every subscription and we hold
  // none from signup, so checkout collects one. Normalized to bare 10 digits;
  // Cashfree rejects anything outside the 6-9 Indian mobile series.
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, "").replace(/^(\+?91)/, ""))
    .pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number.")),
});

/**
 * Create a Cashfree subscription for the signed-in workspace and hand the
 * browser the session ID checkout needs. The subscription is *not* considered
 * paid here — the webhook is the source of truth; this only opens checkout.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const ctx = await getSessionWorkspace();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!billingReady()) {
    const reason = billingConfigError() ?? "Billing is not enabled on this deployment.";
    console.error(`[billing/subscribe] refused: ${reason}`);
    return NextResponse.json(
      { error: "Billing is not available yet.", code: "billing_unavailable" },
      { status: 503 },
    );
  }

  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message ?? "Choose a valid plan.";
    return NextResponse.json({ error: issue }, { status: 400 });
  }

  const { plan, phone } = parsed.data;

  try {
    const subscription = await createSubscription({
      plan,
      workspaceId: ctx.workspace.id,
      email: ctx.user.email,
      phone,
      customerName: ctx.workspace.name,
      // Where Cashfree sends the customer once the mandate is authorized. The
      // billing page reconciles on load, which is what covers the cases the
      // in-page callback misses — a UPI app-switch on mobile, or a closed tab.
      returnUrl: `${env.APP_URL}/app/billing?checkout=return`,
    });

    if (!subscription.subscription_session_id) {
      console.error(
        `[billing/subscribe] no session id returned for ${subscription.subscription_id}`,
      );
      return NextResponse.json(
        { error: "Could not start checkout. Please try again." },
        { status: 502 },
      );
    }

    // Record the subscription before checkout opens, so /confirm can re-fetch it
    // server-side without the browser telling us which subscription to trust.
    // Status is untouched: it stays whatever it was until a webhook or a
    // verified confirm says the mandate is live.
    await db
      .update(schema.workspaces)
      .set({
        billingSubscriptionId: subscription.subscription_id,
        billingPhone: phone,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaces.id, ctx.workspace.id));

    return NextResponse.json({
      subscriptionId: subscription.subscription_id,
      // Consumed by cashfree.subscriptionsCheckout() in the browser. Note the
      // SDK option is `subsSessionId`, not `subscriptionSessionId`.
      subsSessionId: subscription.subscription_session_id,
      mode: cashfreeMode(),
      planKey: planKey(plan),
      planLabel: PLANS[plan].label,
      amountInr: PLANS[plan].priceInr,
    });
  } catch (err) {
    if (err instanceof CashfreeError) {
      console.error(`[billing/subscribe] Cashfree error (${err.status}): ${err.message}`);
      return NextResponse.json(
        { error: "Could not start checkout. Please try again." },
        { status: 502 },
      );
    }
    console.error("[billing/subscribe] unexpected error", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { load } from "@cashfreepayments/cashfree-js";
import { Button } from "@/components/ui/button";

type PaidPlan = "starter" | "pro" | "business";
type Mode = "sandbox" | "production";

interface PlanOption {
  plan: PaidPlan;
  label: string;
  blurb: string;
  price: string;
  /** Null means unlimited. */
  eventQuota: number | null;
  storageGb: number;
}

/** Bare 10-digit Indian mobile, after stripping spaces, dashes and +91. */
function normalizePhone(raw: string): string {
  return raw.replace(/[\s-]/g, "").replace(/^(\+?91)/, "");
}

function isValidPhone(raw: string): boolean {
  return /^[6-9]\d{9}$/.test(normalizePhone(raw));
}

export function PlanPicker({
  live,
  currentPlan,
  canCancel,
  cancelScheduled,
  defaultPhone,
  plans,
}: {
  live: boolean;
  currentPlan: PaidPlan | null;
  canCancel: boolean;
  cancelScheduled: boolean;
  defaultPhone: string | null;
  plans: PlanOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [pending, setPending] = useState<PaidPlan | null>(null);
  const [cancelling, setCancelling] = useState(false);

  /**
   * Reconcile after Cashfree's return redirect. UPI Autopay on mobile leaves the
   * page to another app, so the in-page callback often never runs — without this
   * the user comes back to a page still showing their old plan.
   */
  const reconciled = useRef(false);
  useEffect(() => {
    if (!live || reconciled.current) return;
    if (searchParams.get("checkout") !== "return") return;
    reconciled.current = true;

    void (async () => {
      const res = await fetch("/api/billing/confirm", { method: "POST" });
      if (res.ok) {
        toast.success("Your plan is active.");
      } else {
        toast.message("Payment received — activating your plan.", {
          description: "This can take a few seconds. Refresh if it doesn't update.",
        });
      }
      router.replace("/app/billing");
      router.refresh();
    })();
  }, [live, searchParams, router]);

  const subscribe = useCallback(
    async (plan: PaidPlan) => {
      if (!isValidPhone(phone)) {
        setPhoneError("Enter a valid 10-digit Indian mobile number.");
        return;
      }
      setPhoneError(null);
      setPending(plan);

      try {
        const res = await fetch("/api/billing/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan, phone: normalizePhone(phone) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not start checkout.");

        const cashfree = await load({ mode: data.mode as Mode });
        if (!cashfree) throw new Error("Checkout failed to load.");

        // Note the option is `subsSessionId` — not `subscriptionSessionId`.
        const result = await cashfree.subscriptionsCheckout({
          subsSessionId: data.subsSessionId,
          redirectTarget: "_modal",
        });

        if (result?.error) {
          // Covers an abandoned mandate as well as a real failure; both leave the
          // subscription unauthorized, so there is nothing to confirm.
          toast.error(result.error.message ?? "Checkout was not completed.");
          return;
        }

        // Confirm eagerly so the page reflects the new plan straight away; the
        // webhook is still the authoritative write.
        const confirm = await fetch("/api/billing/confirm", { method: "POST" });
        if (confirm.ok) {
          toast.success(`You're on ${data.planLabel}.`);
          router.refresh();
        } else {
          toast.message("Payment received — activating your plan.", {
            description: "This can take a few seconds. Refresh if it doesn't update.",
          });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not start checkout.");
      } finally {
        setPending(null);
      }
    },
    [phone, router],
  );

  const cancel = useCallback(async () => {
    setCancelling(true);
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not cancel.");
      toast.success("Subscription will end at the close of this billing period.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel.");
    } finally {
      setCancelling(false);
    }
  }, [router]);

  return (
    <section className="mt-6">
      {live ? (
        <div className="mx-auto max-w-sm">
          <label htmlFor="billing-phone" className="text-sm font-medium">
            Mobile number
          </label>
          <input
            id="billing-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (phoneError) setPhoneError(null);
            }}
            className="border-border bg-background mt-1.5 w-full rounded-lg border px-3 py-2 text-sm"
            aria-invalid={phoneError ? true : undefined}
            aria-describedby="billing-phone-hint"
          />
          <p
            id="billing-phone-hint"
            className={`mt-1.5 text-xs ${phoneError ? "text-destructive" : "text-muted-foreground"}`}
          >
            {phoneError ?? "Required by our payment provider to set up UPI Autopay."}
          </p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {plans.map((option) => {
          const isCurrent = live && currentPlan === option.plan;
          return (
            <div
              key={option.plan}
              className={`border-border bg-card relative rounded-2xl border p-5 ${
                isCurrent ? "ring-primary ring-2" : ""
              }`}
            >
              {isCurrent ? (
                <span className="bg-primary text-primary-foreground absolute -top-2.5 right-4 rounded-full px-2.5 py-0.5 text-xs font-semibold">
                  Current
                </span>
              ) : null}

              <h3 className="font-semibold">{option.label}</h3>
              <p className="text-muted-foreground mt-1 text-xs">{option.blurb}</p>

              <p className="mt-3 text-2xl font-bold tracking-tight">
                {option.price}
                <span className="text-muted-foreground text-sm font-medium">/yr</span>
              </p>

              <ul className="text-muted-foreground mt-4 space-y-1.5 text-sm">
                <li className="flex items-center gap-2">
                  <Check className="text-primary size-3.5" />
                  {option.eventQuota === null ? "Unlimited events" : `${option.eventQuota} events`}
                </li>
                <li className="flex items-center gap-2">
                  <Check className="text-primary size-3.5" />
                  {option.storageGb} GB storage
                </li>
                <li className="flex items-center gap-2">
                  <Check className="text-primary size-3.5" />
                  Unlimited guest searches
                </li>
              </ul>

              <Button
                className="mt-5 w-full rounded-full"
                variant={isCurrent ? "outline" : "default"}
                disabled={!live || isCurrent || pending !== null}
                onClick={() => subscribe(option.plan)}
              >
                {pending === option.plan ? <Loader2 className="size-4 animate-spin" /> : null}
                {isCurrent
                  ? "Current plan"
                  : !live
                    ? "Unavailable in Beta"
                    : `Choose ${option.label}`}
              </Button>
            </div>
          );
        })}
      </div>

      {canCancel ? (
        <div className="mt-5 text-center">
          {cancelScheduled ? (
            <p className="text-muted-foreground text-xs">
              Your subscription is set to end at the close of this billing period. You keep full
              access until then.
            </p>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={cancel} disabled={cancelling}>
                {cancelling ? <Loader2 className="size-4 animate-spin" /> : null}
                Cancel subscription
              </Button>
              <p className="text-muted-foreground mt-1 text-xs">
                You keep access until the end of the period you&apos;ve paid for.
              </p>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

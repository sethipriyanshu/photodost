import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, MessageCircle, Phone } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { countWorkspaceEvents } from "@/lib/events";
import { SALES_CONTACT } from "@/lib/contact";
import {
  PAID_PLANS,
  PLANS,
  TRIAL_DAYS,
  effectiveQuotas,
  formatBytes,
  planFeatures,
} from "@/lib/storage";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Your plan" };
export const dynamic = "force-dynamic";

const GB = 1024 * 1024 * 1024;

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Plan page for V1: no gateway, no checkout.
 *
 * Plans are bought by contacting the admin, who takes payment in person and
 * provisions the account by hand. So this page's job is to show what you're on,
 * when it ends, and how to get more — not to process a payment.
 */
export default async function BillingPage() {
  const { workspace } = await requireWorkspace();
  const eventCount = await countWorkspaceEvents(workspace.id);
  const quotas = effectiveQuotas(workspace);

  const plan = PLANS[workspace.plan];
  const onTrial = workspace.plan === "free";
  const endsAt = onTrial ? workspace.trialEndsAt : workspace.currentPeriodEnd;
  const expired = endsAt !== null && endsAt.getTime() <= Date.now();
  const cancelled = workspace.subscriptionStatus === "canceled";

  const daysLeft =
    endsAt && !expired ? Math.ceil((endsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;

  return (
    <div className="mx-auto min-h-dvh max-w-4xl px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app">
            <ArrowLeft className="size-4" />
            Dashboard
          </Link>
        </Button>
      </header>

      <div className="mt-6">
        <h1 className="text-2xl font-semibold tracking-tight">Your plan</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Plans are billed yearly and capped by total storage. Events are unlimited on every paid
          plan.
        </p>
      </div>

      {/* Current state */}
      <section className="border-border bg-card mt-6 rounded-2xl border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Current plan</h2>
            <p className="mt-1 text-2xl font-bold tracking-tight">{plan.label}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {quotas.eventQuota === null
                ? `${eventCount} events`
                : `${eventCount} / ${quotas.eventQuota} events`}{" "}
              · {formatBytes(workspace.storageUsedBytes)} / {formatBytes(quotas.storageQuotaBytes)}{" "}
              storage
            </p>
          </div>

          {endsAt ? (
            <div className="text-right text-sm">
              <p className="text-muted-foreground">
                {cancelled
                  ? "Access until"
                  : expired
                    ? onTrial
                      ? "Trial ended"
                      : "Ended"
                    : onTrial
                      ? "Trial ends"
                      : "Valid until"}
              </p>
              <p className="font-medium">{formatDate(endsAt)}</p>
              {daysLeft !== null ? (
                <p className="text-muted-foreground text-xs">
                  {daysLeft} day{daysLeft === 1 ? "" : "s"} left
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {cancelled ? (
          <p className="border-border text-destructive mt-4 border-t pt-4 text-sm">
            This account has been closed. Existing galleries and guest search keep working — contact
            us to reactivate it.
          </p>
        ) : expired ? (
          <p className="border-border text-destructive mt-4 border-t pt-4 text-sm">
            {onTrial ? `Your ${TRIAL_DAYS}-day free trial has ended.` : "Your plan has ended."} You
            can&apos;t create events or upload photos until it&apos;s renewed. Everything
            you&apos;ve already shared stays live for your guests.
          </p>
        ) : null}
      </section>

      {/* How to buy */}
      <section className="border-primary/30 bg-primary/5 mt-4 rounded-2xl border p-6">
        <h2 className="font-semibold">
          {onTrial ? "Ready to upgrade?" : "Need more storage or a renewal?"}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Talk to us directly and we&apos;ll set you up. Your account is activated the same day.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild className="rounded-full">
            <a href={SALES_CONTACT.whatsappUrl} target="_blank" rel="noreferrer">
              <MessageCircle className="size-4" />
              WhatsApp us
            </a>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <a href={SALES_CONTACT.telUrl}>
              <Phone className="size-4" />
              {SALES_CONTACT.display}
            </a>
          </Button>
        </div>
      </section>

      {/* Plans */}
      <section className="mt-6">
        <h2 className="mb-3 font-semibold">Plans</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {PAID_PLANS.map((key) => {
            const p = PLANS[key];
            const isCurrent = workspace.plan === key && !expired && !cancelled;
            return (
              <div
                key={key}
                className={`border-border bg-card relative rounded-2xl border p-5 ${
                  isCurrent ? "ring-primary ring-2" : ""
                }`}
              >
                {isCurrent ? (
                  <span className="bg-primary text-primary-foreground absolute -top-2.5 right-4 rounded-full px-2.5 py-0.5 text-xs font-semibold">
                    Current
                  </span>
                ) : null}
                <h3 className="font-semibold">{p.label}</h3>
                <p className="text-muted-foreground mt-1 text-xs">{p.blurb}</p>
                <p className="mt-3 text-2xl font-bold tracking-tight">
                  ₹{p.priceInr.toLocaleString("en-IN")}
                  <span className="text-muted-foreground text-sm font-medium">/yr</span>
                </p>
                <ul className="text-muted-foreground mt-4 space-y-1.5 text-sm">
                  {planFeatures(key).map((feature) => (
                    <li key={feature} className="flex items-center gap-2">
                      <Check className="text-primary size-3.5 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="text-muted-foreground mt-4 text-center text-xs">
          Prices in INR, billed yearly.
        </p>
      </section>
    </div>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { countWorkspaceEvents } from "@/lib/events";
import { billingConfigError, billingReady, formatInr } from "@/lib/billing";
import { RETENTION_GRACE_DAYS } from "@photodost/db";
import {
  BILLING_ENABLED,
  PAID_PLANS,
  PLANS,
  TRIAL_DAYS,
  effectiveQuotas,
  parsePlanKey,
} from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { PlanPicker } from "./plan-picker";

export const metadata: Metadata = { title: "Plan & billing" };
export const dynamic = "force-dynamic";

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** Storage caps span 500 MB to 100 GB, so pick the unit per value. */
function formatQuota(bytes: number): string {
  return bytes >= GB ? `${Math.round(bytes / GB)} GB` : `${Math.round(bytes / MB)} MB`;
}

export default async function BillingPage() {
  const { workspace } = await requireWorkspace();
  const eventCount = await countWorkspaceEvents(workspace.id);
  const quotas = effectiveQuotas(workspace);

  const live = billingReady();
  const configError = billingConfigError();
  const current = parsePlanKey(workspace.billingPlanKey);
  // A paid plan only counts as current while the subscription is actually good
  // for it — a past_due or canceled row shouldn't render as "Current".
  const onPaidPlan =
    current !== null && workspace.plan !== "free" && workspace.subscriptionStatus === "active";

  const trialActive = live && workspace.plan === "free" && workspace.trialEndsAt !== null;
  const trialExpired = trialActive && workspace.trialEndsAt!.getTime() <= Date.now();

  // Mirror of `accessEndedAtSql()` in @photodost/db — the clause order matters
  // for the same reason it does there: a cancelled ex-subscriber has plan 'free'
  // and a long-expired trial date, so `canceled` must be checked first or this
  // would show a deletion date in the past.
  const accessEndedAt =
    workspace.subscriptionStatus === "canceled"
      ? (workspace.currentPeriodEnd ?? workspace.updatedAt)
      : workspace.plan === "free" &&
          (workspace.subscriptionStatus === "trialing" ||
            workspace.subscriptionStatus === "incomplete")
        ? workspace.trialEndsAt
        : null;

  const deleteOn =
    accessEndedAt && accessEndedAt.getTime() <= Date.now() && !workspace.photosPurgedAt
      ? new Date(accessEndedAt.getTime() + RETENTION_GRACE_DAYS * 24 * 60 * 60 * 1000)
      : null;

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
        <h1 className="text-2xl font-semibold tracking-tight">Plan &amp; billing</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every paid plan is billed yearly and capped only by total storage — events are unlimited.
        </p>
      </div>

      {/* Current state */}
      <section className="border-border bg-card mt-6 rounded-2xl border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Current plan</h2>
            <p className="mt-1 text-2xl font-bold tracking-tight">
              {!live ? "Beta" : onPaidPlan ? PLANS[current.plan].label : PLANS.free.label}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {quotas.eventQuota === null
                ? `${eventCount} events`
                : `${eventCount} / ${quotas.eventQuota} events`}{" "}
              · {(workspace.storageUsedBytes / GB).toFixed(1)} GB /{" "}
              {formatQuota(quotas.storageQuotaBytes)} storage
            </p>
          </div>

          {live && onPaidPlan && workspace.currentPeriodEnd ? (
            <div className="text-right text-sm">
              <p className="text-muted-foreground">
                {workspace.cancelAtPeriodEnd ? "Access until" : "Renews on"}
              </p>
              <p className="font-medium">{formatDate(workspace.currentPeriodEnd)}</p>
            </div>
          ) : trialActive ? (
            <div className="text-right text-sm">
              <p className="text-muted-foreground">{trialExpired ? "Trial ended" : "Trial ends"}</p>
              <p className="font-medium">{formatDate(workspace.trialEndsAt!)}</p>
            </div>
          ) : null}
        </div>

        {live && workspace.subscriptionStatus === "past_due" ? (
          <p className="border-border text-destructive mt-4 border-t pt-4 text-sm">
            A payment failed. New events and uploads are paused until it clears — existing galleries
            keep working for your guests.
          </p>
        ) : trialExpired ? (
          <p className="border-border text-destructive mt-4 border-t pt-4 text-sm">
            Your {TRIAL_DAYS}-day free trial has ended. Choose a plan to create events and upload
            again — what you&apos;ve already shared stays live for your guests.
          </p>
        ) : null}

        {/* The countdown to irreversible deletion, while there's still time to act. */}
        {live && workspace.photosPurgedAt ? (
          <p className="border-border text-muted-foreground mt-4 border-t pt-4 text-sm">
            Your photos were deleted on {formatDate(workspace.photosPurgedAt)} after the retention
            period ended. Subscribing again lets you upload new photos, but cannot restore these.
          </p>
        ) : live && deleteOn ? (
          <p className="border-border text-destructive mt-4 border-t pt-4 text-sm">
            <strong>Your photos will be permanently deleted on {formatDate(deleteOn)}.</strong>{" "}
            Subscribe before then to keep them, or download anything you need — deletion cannot be
            undone.
          </p>
        ) : null}
      </section>

      {/* Why billing isn't live, when it isn't */}
      {!live ? (
        <section className="border-border bg-muted/40 mt-4 rounded-2xl border p-5">
          <div className="flex gap-3">
            <AlertTriangle className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div className="text-sm">
              {configError ? (
                <>
                  <p className="font-medium">Billing is enabled but not configured.</p>
                  <p className="text-muted-foreground mt-1">{configError}</p>
                  <p className="text-muted-foreground mt-2">
                    Until that&apos;s fixed the app stays on Beta quotas, so nobody gets capped
                    without a way to upgrade.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">Beta — everything is unlimited.</p>
                  <p className="text-muted-foreground mt-1">
                    Usage is tracked so the meters are real, but nothing is capped and no payment is
                    taken. The plans below are what will apply once{" "}
                    <code className="text-xs">BILLING_ENABLED</code> is switched on.
                  </p>
                </>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {/* Plans. Suspense because PlanPicker reads searchParams to reconcile the
          post-checkout return redirect. */}
      <Suspense fallback={null}>
        <PlanPicker
          live={live}
          currentPlan={onPaidPlan ? current.plan : null}
          canCancel={live && onPaidPlan && Boolean(workspace.billingSubscriptionId)}
          cancelScheduled={workspace.cancelAtPeriodEnd}
          defaultPhone={workspace.billingPhone}
          plans={PAID_PLANS.map((plan) => ({
            plan,
            label: PLANS[plan].label,
            blurb: PLANS[plan].blurb,
            price: formatInr(PLANS[plan].priceInr),
            eventQuota: PLANS[plan].eventQuota,
            storageGb: Math.round(PLANS[plan].quotaBytes / GB),
          }))}
        />
      </Suspense>

      {BILLING_ENABLED ? null : (
        <p className="text-muted-foreground mt-6 text-center text-xs">
          Prices in INR, billed yearly. GST invoicing lands with the live gateway.
        </p>
      )}
    </div>
  );
}

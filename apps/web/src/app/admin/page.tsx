import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LogOut } from "lucide-react";
import { adminConfigured, isAdmin } from "@/lib/admin-auth";
import { listAdminAccounts, summarize } from "@/lib/admin-data";
import { PLANS, formatBytes } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { AccountsTable, type AccountRow } from "./accounts-table";
import { CreateAccountForm } from "./create-account-form";
import { AdminLoginForm } from "./login-form";
import { logoutAction, planOptions } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  // Keep the admin area out of search results. It's password-gated regardless,
  // but there's no reason for it to be discoverable.
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  if (!(await isAdmin())) {
    if (!adminConfigured()) {
      return (
        <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
          <div className="border-border bg-card rounded-2xl border p-6">
            <h1 className="font-semibold">Admin isn&apos;t configured</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Set <code className="text-xs">ADMIN_USERNAME</code> and{" "}
              <code className="text-xs">ADMIN_PASSWORD_HASH</code> on this deployment. The password
              is stored only as a scrypt hash — see{" "}
              <code className="text-xs">lib/admin-auth.ts</code> for how to generate one.
            </p>
          </div>
        </div>
      );
    }
    return <AdminLoginForm />;
  }

  const accounts = await listAdminAccounts();
  const summary = summarize(accounts, (plan) => PLANS[plan].priceInr);
  const plans = await planOptions();

  const rows: AccountRow[] = accounts.map((a) => ({
    userId: a.userId,
    username: a.username,
    studioName: a.studioName,
    workspaceId: a.workspaceId,
    planLabel: a.plan
      ? PLANS[a.plan].label
      : a.provisionedPlan
        ? PLANS[a.provisionedPlan].label
        : null,
    status: a.status,
    isTrial: a.isTrial,
    endsAtIso: a.endsAt?.toISOString() ?? null,
    setUp: a.workspaceId !== null,
    events: a.events,
    photos: a.photos,
    storageUsed: formatBytes(a.storageUsedBytes),
    storageQuota: a.storageQuotaBytes === null ? null : formatBytes(a.storageQuotaBytes),
    guestSearches: a.guestSearches,
    lastActivityIso: a.lastActivityAt?.toISOString() ?? null,
  }));

  return (
    <div className="mx-auto min-h-dvh max-w-6xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Accounts, plans and usage. Payment is taken in person.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/">
              <ArrowLeft className="size-4" />
              Site
            </Link>
          </Button>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm" className="rounded-full">
              <LogOut className="size-3.5" />
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Paid accounts" value={String(summary.active)} />
        <Stat label="Trials" value={String(summary.trials)} />
        <Stat
          label="Expiring in 30d"
          value={String(summary.expiringSoon)}
          tone={summary.expiringSoon > 0 ? "warn" : undefined}
        />
        <Stat label="Storage used" value={formatBytes(summary.storageUsedBytes)} />
        <Stat label="Annual value" value={`₹${summary.annualValueInr.toLocaleString("en-IN")}`} />
      </section>

      <div className="mt-6">
        <CreateAccountForm plans={plans} />
      </div>

      <div className="mt-6">
        <h2 className="mb-3 font-semibold">All accounts</h2>
        <AccountsTable rows={rows} />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="border-border bg-card rounded-xl border p-4">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div
        className={`mt-1 text-xl font-semibold tabular-nums ${
          tone === "warn" ? "text-amber-600 dark:text-amber-400" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Camera, HardDrive, Plus, Settings2, Users } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { countWorkspaceEvents } from "@/lib/events";
import { PLANS, effectiveQuotas } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const GB = 1024 * 1024 * 1024;
function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(bytes >= 10 * GB ? 0 : 1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** A null total means an unlimited quota — nothing to fill a bar with. */
function pct(used: number, total: number | null): number {
  if (total === null || total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

export default async function DashboardPage() {
  const { user, workspace } = await requireWorkspace();
  const eventCount = await countWorkspaceEvents(workspace.id);

  const quotas = effectiveQuotas(workspace);
  // The plan on the row is the plan being enforced — there is no gateway to be
  // half-configured, so the badge can state it plainly.
  const planLabel = PLANS[workspace.plan].label;
  const onTrial = workspace.plan === "free";
  const trialDaysLeft =
    onTrial && workspace.trialEndsAt
      ? Math.ceil((workspace.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : null;

  return (
    <div className="relative min-h-dvh">
      <header className="safe-top glass sticky top-0 z-40">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="bg-primary text-primary-foreground shadow-primary/30 grid size-8 place-items-center rounded-xl shadow-lg">
              <Camera className="size-4" />
            </span>
            <span className="hidden sm:inline">PhotoDost</span>
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm" className="rounded-full">
              <Link href="/app/settings">
                <Settings2 className="size-4" />
                <span className="hidden sm:inline">Settings</span>
              </Link>
            </Button>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="reveal-group mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* Workspace identity */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
              Workspace
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">{workspace.name}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {workspace.slug}.photodost.app
              <span className="text-muted-foreground/60 mx-2">·</span>
              {user.email}
            </p>
          </div>
          <Link
            href="/app/billing"
            className="glass hover:bg-muted/50 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition"
          >
            <span className="bg-primary size-1.5 animate-pulse rounded-full" />
            {planLabel}
            {trialDaysLeft !== null
              ? trialDaysLeft > 0
                ? ` · ${trialDaysLeft}d left`
                : " · expired"
              : null}
          </Link>
        </div>

        {/* Usage meters */}
        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          <Meter
            icon={<Users className="size-4" />}
            label="Events"
            used={`${eventCount}`}
            total={quotas.eventQuota === null ? "∞" : `${quotas.eventQuota}`}
            suffix="events"
            pct={pct(eventCount, quotas.eventQuota)}
          />
          <Meter
            icon={<HardDrive className="size-4" />}
            label="Storage"
            used={formatBytes(workspace.storageUsedBytes)}
            total={formatBytes(quotas.storageQuotaBytes)}
            pct={pct(workspace.storageUsedBytes, quotas.storageQuotaBytes)}
          />
        </section>

        {/* Events hub */}
        <section className="mt-8">
          <div className="border-border bg-card lift relative overflow-hidden rounded-3xl border p-6 sm:p-8">
            <div
              className="from-primary/10 absolute -right-20 -top-20 size-56 rounded-full bg-gradient-to-br to-transparent blur-3xl"
              aria-hidden
            />
            <div className="relative flex flex-wrap items-center justify-between gap-5">
              <div className="flex items-center gap-4">
                <div className="bg-primary/10 text-primary size-13 grid place-items-center rounded-2xl">
                  <Users className="size-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Event galleries</h2>
                  <p className="text-muted-foreground text-sm">
                    {eventCount} {eventCount === 1 ? "event" : "events"} · face-matching QR
                    galleries
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button asChild className="rounded-full px-5">
                  <Link href="/events/new">
                    <Plus className="size-4" />
                    New event
                  </Link>
                </Button>
                {eventCount > 0 ? (
                  <Button asChild variant="outline" className="rounded-full px-5">
                    <Link href="/events">
                      View all
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Meter({
  icon,
  label,
  used,
  total,
  suffix,
  pct,
}: {
  icon: React.ReactNode;
  label: string;
  used: string;
  total: string;
  suffix?: string;
  pct: number;
}) {
  return (
    <div className="border-border bg-card rounded-3xl border p-5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-semibold">
          {icon}
          {label}
        </span>
        <span className="text-muted-foreground tabular-nums">
          <span className="text-foreground font-semibold">{used}</span> / {total}{" "}
          {suffix ? `${suffix}` : ""}
        </span>
      </div>
      <div className="bg-muted mt-3 h-2.5 overflow-hidden rounded-full">
        <div className="meter-fill h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}

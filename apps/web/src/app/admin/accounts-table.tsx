"use client";

import { useState } from "react";
import { AlertTriangle, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelAccountAction, extendAccountAction } from "./actions";

export interface AccountRow {
  userId: string;
  username: string | null;
  studioName: string | null;
  workspaceId: string | null;
  planLabel: string | null;
  status: string | null;
  isTrial: boolean;
  endsAtIso: string | null;
  setUp: boolean;
  events: number;
  photos: number;
  storageUsed: string;
  storageQuota: string | null;
  guestSearches: number;
  lastActivityIso: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function relative(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}

function StatusPill({ row }: { row: AccountRow }) {
  const left = daysLeft(row.endsAtIso);

  let label: string;
  let tone: string;

  if (row.status === "canceled") {
    label = "Cancelled";
    tone = "bg-destructive/10 text-destructive";
  } else if (!row.setUp) {
    label = "Not set up";
    tone = "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  } else if (left !== null && left <= 0) {
    label = "Expired";
    tone = "bg-destructive/10 text-destructive";
  } else if (row.isTrial) {
    label = left !== null ? `Trial · ${left}d` : "Trial";
    tone = "bg-sky-500/15 text-sky-700 dark:text-sky-400";
  } else if (left !== null && left <= 30) {
    label = `Expiring · ${left}d`;
    tone = "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  } else {
    label = "Active";
    tone = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  }

  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {label}
    </span>
  );
}

export function AccountsTable({ rows }: { rows: AccountRow[] }) {
  const [confirming, setConfirming] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground border-border rounded-2xl border border-dashed p-8 text-center text-sm">
        No accounts yet. Create one above after taking payment.
      </p>
    );
  }

  return (
    <div className="border-border overflow-x-auto rounded-2xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-xs">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Account</th>
            <th className="px-3 py-2 text-left font-medium">Plan</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Events</th>
            <th className="px-3 py-2 text-right font-medium">Photos</th>
            <th className="px-3 py-2 text-right font-medium">Storage</th>
            <th className="px-3 py-2 text-right font-medium">Guests</th>
            <th className="px-3 py-2 text-left font-medium">Last active</th>
            <th className="px-3 py-2 text-left font-medium">Ends</th>
            <th className="px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.userId} className="border-border border-t align-middle">
              <td className="px-3 py-2.5">
                <div className="font-medium">{row.studioName ?? "—"}</div>
                <div className="text-muted-foreground font-mono text-xs">
                  {row.username ?? "google sign-in"}
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5">{row.planLabel ?? "—"}</td>
              <td className="px-3 py-2.5">
                <StatusPill row={row} />
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{row.events}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{row.photos}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                {row.storageUsed}
                {row.storageQuota ? (
                  <span className="text-muted-foreground"> / {row.storageQuota}</span>
                ) : null}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{row.guestSearches}</td>
              <td className="text-muted-foreground whitespace-nowrap px-3 py-2.5">
                {relative(row.lastActivityIso)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5">{fmtDate(row.endsAtIso)}</td>
              <td className="px-3 py-2.5">
                <div className="flex justify-end gap-1.5">
                  <form action={extendAccountAction}>
                    <input type="hidden" name="workspaceId" value={row.workspaceId ?? ""} />
                    <input type="hidden" name="userId" value={row.userId} />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      title="Extend by 365 days from today"
                    >
                      <RotateCcw className="size-3.5" />
                      Renew
                    </Button>
                  </form>

                  {row.workspaceId && row.status !== "canceled" ? (
                    confirming === row.userId ? (
                      <form action={cancelAccountAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="workspaceId" value={row.workspaceId} />
                        <Button
                          type="submit"
                          variant="destructive"
                          size="sm"
                          className="rounded-full"
                        >
                          Confirm
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-full"
                          onClick={() => setConfirming(null)}
                        >
                          No
                        </Button>
                      </form>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive rounded-full"
                        onClick={() => setConfirming(row.userId)}
                      >
                        <XCircle className="size-3.5" />
                        Cancel
                      </Button>
                    )
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-muted-foreground border-border flex items-start gap-2 border-t px-3 py-2.5 text-xs">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        Cancelling blocks new events and uploads. Existing galleries and guest search keep working,
        and photos become eligible for deletion after the retention period.
      </p>
    </div>
  );
}

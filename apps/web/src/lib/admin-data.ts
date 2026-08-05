import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./db";
import type { Plan } from "./storage";

/**
 * Read side of the admin area: every account with enough usage detail to tell
 * at a glance whether someone is actually using what they bought.
 */

export interface AdminAccount {
  userId: string;
  username: string | null;
  studioName: string | null;
  workspaceId: string | null;
  workspaceSlug: string | null;
  plan: Plan | null;
  /** What the admin sold, before the customer has named their studio. */
  provisionedPlan: Plan | null;
  status: string | null;
  /** End of the paid term, or of the free trial. */
  endsAt: Date | null;
  isTrial: boolean;
  /** Null until they finish onboarding. */
  setUpAt: Date | null;
  createdAt: Date;
  events: number;
  photos: number;
  storageUsedBytes: number;
  storageQuotaBytes: number | null;
  guestSearches: number;
  lastActivityAt: Date | null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * One query rather than a per-account fan-out. The aggregates are computed in
 * correlated subqueries instead of joins so that a workspace with many assets
 * can't multiply the guest-search count (and vice versa) — the classic
 * fan-out-times-fan-out mistake when aggregating two unrelated child tables.
 */
export async function listAdminAccounts(): Promise<AdminAccount[]> {
  const result = await db.execute<Record<string, unknown>>(sql`
    SELECT
      u.id                        AS user_id,
      u.username                  AS username,
      u.provisioned_plan          AS provisioned_plan,
      u.provisioned_until         AS provisioned_until,
      u.created_at                AS created_at,
      w.id                        AS workspace_id,
      w.name                      AS studio_name,
      w.slug                      AS workspace_slug,
      w.plan                      AS plan,
      w.subscription_status       AS status,
      w.current_period_end        AS current_period_end,
      w.trial_ends_at             AS trial_ends_at,
      w.storage_used_bytes        AS storage_used_bytes,
      w.storage_quota_bytes       AS storage_quota_bytes,
      w.created_at                AS set_up_at,
      COALESCE((
        SELECT count(*) FROM events e WHERE e.workspace_id = w.id
      ), 0)                       AS events,
      COALESCE((
        SELECT count(*) FROM assets a
        JOIN events e2 ON e2.id = a.event_id
        WHERE e2.workspace_id = w.id
      ), 0)                       AS photos,
      COALESCE((
        SELECT count(*) FROM guest_searches gs
        JOIN events e3 ON e3.id = gs.event_id
        WHERE e3.workspace_id = w.id
      ), 0)                       AS guest_searches,
      GREATEST(
        COALESCE((SELECT max(e4.created_at) FROM events e4 WHERE e4.workspace_id = w.id), 'epoch'),
        COALESCE((
          SELECT max(gs2.created_at) FROM guest_searches gs2
          JOIN events e5 ON e5.id = gs2.event_id
          WHERE e5.workspace_id = w.id
        ), 'epoch')
      )                           AS last_activity_at
    FROM "user" u
    LEFT JOIN memberships m ON m.user_id = u.id AND m.role = 'owner'
    LEFT JOIN workspaces w ON w.id = m.workspace_id
    ORDER BY u.created_at DESC
  `);

  const rows =
    (result as unknown as { rows?: Record<string, unknown>[] }).rows ??
    (result as unknown as Record<string, unknown>[]);
  if (!Array.isArray(rows)) return [];

  return rows.map((r) => {
    const plan = (r.plan as Plan | null) ?? null;
    const isTrial = plan === "free";
    const lastActivity = toDate(r.last_activity_at);

    return {
      userId: String(r.user_id),
      username: (r.username as string | null) ?? null,
      studioName: (r.studio_name as string | null) ?? null,
      workspaceId: (r.workspace_id as string | null) ?? null,
      workspaceSlug: (r.workspace_slug as string | null) ?? null,
      plan,
      provisionedPlan: (r.provisioned_plan as Plan | null) ?? null,
      status: (r.status as string | null) ?? null,
      // A trial ends at trial_ends_at; a paid term at current_period_end. Before
      // onboarding neither exists, so fall back to what the admin sold.
      endsAt: isTrial
        ? toDate(r.trial_ends_at)
        : (toDate(r.current_period_end) ?? toDate(r.provisioned_until)),
      isTrial,
      setUpAt: toDate(r.set_up_at),
      createdAt: toDate(r.created_at) ?? new Date(0),
      events: Number(r.events ?? 0),
      photos: Number(r.photos ?? 0),
      storageUsedBytes: Number(r.storage_used_bytes ?? 0),
      storageQuotaBytes:
        r.storage_quota_bytes === null || r.storage_quota_bytes === undefined
          ? null
          : Number(r.storage_quota_bytes),
      guestSearches: Number(r.guest_searches ?? 0),
      // 'epoch' is the GREATEST() floor, meaning "never".
      lastActivityAt: lastActivity && lastActivity.getTime() > 0 ? lastActivity : null,
    };
  });
}

export interface AdminSummary {
  total: number;
  active: number;
  trials: number;
  expiringSoon: number;
  storageUsedBytes: number;
  /** Annual value of currently-active paid accounts, in rupees. */
  annualValueInr: number;
}

export function summarize(accounts: AdminAccount[], priceOf: (plan: Plan) => number): AdminSummary {
  const now = Date.now();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  let active = 0;
  let trials = 0;
  let expiringSoon = 0;
  let storageUsedBytes = 0;
  let annualValueInr = 0;

  for (const a of accounts) {
    storageUsedBytes += a.storageUsedBytes;
    const live = a.endsAt === null || a.endsAt.getTime() > now;
    const notCancelled = a.status !== "canceled";

    if (a.isTrial) {
      if (live && notCancelled) trials += 1;
    } else if (a.plan && live && notCancelled) {
      active += 1;
      annualValueInr += priceOf(a.plan);
      if (a.endsAt && a.endsAt.getTime() - now < THIRTY_DAYS) expiringSoon += 1;
    }
  }

  return {
    total: accounts.length,
    active,
    trials,
    expiringSoon,
    storageUsedBytes,
    annualValueInr,
  };
}

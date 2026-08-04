import { sql } from "drizzle-orm";
import type { Database } from "./client";

/**
 * Recompute `workspaces.storage_used_bytes` for every workspace from the
 * authoritative source rows (live event assets). This heals any drift between
 * the denormalized counter and reality (e.g. from crashed uploads or a missed
 * decrement). Idempotent; safe to run on a schedule.
 *
 * Returns the number of workspaces whose stored counter was corrected.
 */
export async function recomputeAllWorkspaceUsage(db: Database): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    WITH computed AS (
      SELECT
        w.id,
        COALESCE(
          (
            SELECT COALESCE(SUM(a.bytes), 0)
            FROM assets a
            JOIN events e ON e.id = a.event_id
            WHERE e.workspace_id = w.id AND a.deleted_at IS NULL
          ),
          0
        )::bigint AS total
      FROM workspaces w
    )
    UPDATE workspaces w
    SET storage_used_bytes = computed.total, updated_at = now()
    FROM computed
    WHERE w.id = computed.id
      AND w.storage_used_bytes <> computed.total
    RETURNING w.id;
  `);

  const rows =
    (result as unknown as { rows?: { id: string }[] }).rows ??
    (result as unknown as { id: string }[]);
  return Array.isArray(rows) ? rows.length : 0;
}

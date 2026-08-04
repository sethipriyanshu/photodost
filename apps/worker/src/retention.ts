import { eq, sql } from "drizzle-orm";
import {
  RETENTION_FINAL_WARNING_DAYS,
  RETENTION_GRACE_DAYS,
  accessEndedAtSql,
  purgeDueAtSql,
} from "@photodost/db";
import { db, schema } from "./db.js";
import { deleteObject } from "./s3.js";
import { retentionFinalEmail, retentionStartEmail, sendEmail } from "./email.js";
import { logger } from "./logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Retention sweep. Runs daily and does three things in order:
 *
 *   1. Send the "grace period started" email to workspaces whose access just
 *      ended.
 *   2. Send the final notice N days before deletion.
 *   3. Delete the photos of workspaces past the grace period.
 *
 * The anchor for all three is `accessEndedAtSql()` in @photodost/db — read the
 * comment there before changing anything, because the clause order guards
 * against purging a cancelled customer's photos immediately.
 *
 * **This deletes data irreversibly.** Two properties keep that safe:
 *
 * - Nothing is purged unless the grace period has fully elapsed, and
 *   `past_due` (a recoverable failed charge) never counts as access ending.
 * - A workspace is only purged if the first warning email was actually sent
 *   (`retention_warned_at IS NOT NULL`). If mail is broken, photos are not
 *   deleted — silence plus deletion is the one combination we refuse to ship.
 */

interface DueRow {
  id: string;
  name: string;
  email: string;
  deleteOn: Date;
  wasTrial: boolean;
}

/** Workspaces whose grace period has just begun and haven't been told yet. */
async function findNeedingFirstWarning(): Promise<DueRow[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    email: string;
    delete_on: string;
    was_trial: boolean;
  }>(sql`
    SELECT w.id, w.name, u.email,
           ${purgeDueAtSql(RETENTION_GRACE_DAYS)} AS delete_on,
           (w.subscription_status <> 'canceled') AS was_trial
    FROM workspaces w
    JOIN "user" u ON u.id = w.owner_user_id
    WHERE ${accessEndedAtSql()} IS NOT NULL
      AND ${accessEndedAtSql()} <= now()
      AND w.retention_warned_at IS NULL
      AND w.photos_purged_at IS NULL
      -- Nothing to warn about if there are no photos to lose.
      AND EXISTS (
        SELECT 1 FROM events e JOIN assets a ON a.event_id = e.id
        WHERE e.workspace_id = w.id
      )
  `);
  return normalize(rows);
}

/** Workspaces inside the final-warning window that haven't had the second email. */
async function findNeedingFinalWarning(): Promise<DueRow[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    email: string;
    delete_on: string;
    was_trial: boolean;
  }>(sql`
    SELECT w.id, w.name, u.email,
           ${purgeDueAtSql(RETENTION_GRACE_DAYS)} AS delete_on,
           (w.subscription_status <> 'canceled') AS was_trial
    FROM workspaces w
    JOIN "user" u ON u.id = w.owner_user_id
    WHERE ${accessEndedAtSql()} IS NOT NULL
      AND w.retention_final_warned_at IS NULL
      AND w.photos_purged_at IS NULL
      AND ${purgeDueAtSql(RETENTION_GRACE_DAYS)} > now()
      AND ${purgeDueAtSql(RETENTION_GRACE_DAYS)} <= now() + ${sql.raw(
        `interval '${RETENTION_FINAL_WARNING_DAYS} days'`,
      )}
      AND EXISTS (
        SELECT 1 FROM events e JOIN assets a ON a.event_id = e.id
        WHERE e.workspace_id = w.id
      )
  `);
  return normalize(rows);
}

/** Workspaces past the grace period, warned, and still holding photos. */
async function findDueForPurge(): Promise<DueRow[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    email: string;
    delete_on: string;
    was_trial: boolean;
  }>(sql`
    SELECT w.id, w.name, u.email,
           ${purgeDueAtSql(RETENTION_GRACE_DAYS)} AS delete_on,
           (w.subscription_status <> 'canceled') AS was_trial
    FROM workspaces w
    JOIN "user" u ON u.id = w.owner_user_id
    WHERE ${accessEndedAtSql()} IS NOT NULL
      AND ${purgeDueAtSql(RETENTION_GRACE_DAYS)} <= now()
      -- Refuse to delete silently: the first warning must have gone out.
      AND w.retention_warned_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM events e JOIN assets a ON a.event_id = e.id
        WHERE e.workspace_id = w.id
      )
  `);
  return normalize(rows);
}

function normalize(result: unknown): DueRow[] {
  const rows =
    (result as { rows?: Record<string, unknown>[] }).rows ?? (result as Record<string, unknown>[]);
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    email: String(r.email),
    deleteOn: new Date(String(r.delete_on)),
    wasTrial: Boolean(r.was_trial),
  }));
}

/**
 * Delete every photo belonging to a workspace: objects first, then rows.
 *
 * Objects before rows is deliberate. If we deleted rows first and then crashed,
 * the object keys would be lost and the bytes orphaned in the bucket forever
 * with nothing left pointing at them. Doing it this way, a crash leaves rows
 * whose objects are already gone — which the next sweep simply retries, and
 * which the storage reconciliation already knows how to account for.
 */
async function purgeWorkspacePhotos(workspaceId: string): Promise<{
  assets: number;
  objects: number;
  failedObjects: number;
  bytes: number;
}> {
  const assets = await db
    .select({
      id: schema.assets.id,
      originalKey: schema.assets.originalKey,
      bytes: schema.assets.bytes,
    })
    .from(schema.assets)
    .innerJoin(schema.events, eq(schema.events.id, schema.assets.eventId))
    .where(eq(schema.events.workspaceId, workspaceId));

  if (assets.length === 0) {
    return { assets: 0, objects: 0, failedObjects: 0, bytes: 0 };
  }

  const assetIds = assets.map((a) => a.id);
  const variants = await db
    .select({ key: schema.assetVariants.key })
    .from(schema.assetVariants)
    .where(
      sql`${schema.assetVariants.assetId} IN (${sql.join(
        assetIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );

  const keys = [...assets.map((a) => a.originalKey), ...variants.map((v) => v.key)];
  const results = await Promise.allSettled(keys.map((key) => deleteObject(key)));
  const failedObjects = results.filter((r) => r.status === "rejected").length;

  if (failedObjects > 0) {
    // Don't drop the rows — we'd lose the keys and orphan the bytes. Bail and
    // let the next sweep retry; the rows still point at what's left.
    logger.error(
      { workspaceId, failedObjects, totalObjects: keys.length },
      "retention purge: object deletions failed, leaving DB rows for retry",
    );
    throw new Error(`${failedObjects}/${keys.length} object deletions failed`);
  }

  const totalBytes = assets.reduce((sum, a) => sum + Number(a.bytes), 0);

  // Rows now. face_embeddings and asset_variants go via ON DELETE CASCADE.
  // Event rows are intentionally left behind as shells.
  await db.transaction(async (tx) => {
    await tx.delete(schema.assets).where(
      sql`${schema.assets.id} IN (${sql.join(
        assetIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );

    await tx.insert(schema.storageLedger).values({
      workspaceId,
      deltaBytes: -totalBytes,
      reason: "retention_purge",
      objectKey: null,
    });

    await tx
      .update(schema.workspaces)
      .set({
        storageUsedBytes: sql`GREATEST(0, ${schema.workspaces.storageUsedBytes} - ${totalBytes})`,
        photosPurgedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaces.id, workspaceId));
  });

  return {
    assets: assets.length,
    objects: keys.length,
    failedObjects: 0,
    bytes: totalBytes,
  };
}

export async function runRetentionSweepOnce(): Promise<void> {
  // --- 1. First warning ---------------------------------------------------
  try {
    for (const ws of await findNeedingFirstWarning()) {
      try {
        const mail = retentionStartEmail({
          workspaceName: ws.name,
          deleteOn: ws.deleteOn,
          graceDays: RETENTION_GRACE_DAYS,
          wasTrial: ws.wasTrial,
        });
        await sendEmail({ to: ws.email, ...mail });
        await db
          .update(schema.workspaces)
          .set({ retentionWarnedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.workspaces.id, ws.id));
        logger.info({ workspaceId: ws.id, deleteOn: ws.deleteOn }, "retention: first warning sent");
      } catch (err) {
        // Leave the timestamp null so tomorrow retries — and because the purge
        // requires it to be set, a permanently broken mailer blocks deletion
        // rather than deleting silently.
        logger.error({ err, workspaceId: ws.id }, "retention: first warning failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "retention: could not query first-warning candidates");
  }

  // --- 2. Final warning ---------------------------------------------------
  try {
    for (const ws of await findNeedingFinalWarning()) {
      try {
        const daysLeft = Math.max(1, Math.ceil((ws.deleteOn.getTime() - Date.now()) / DAY_MS));
        const mail = retentionFinalEmail({
          workspaceName: ws.name,
          deleteOn: ws.deleteOn,
          daysLeft,
        });
        await sendEmail({ to: ws.email, ...mail });
        await db
          .update(schema.workspaces)
          .set({ retentionFinalWarnedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.workspaces.id, ws.id));
        logger.info({ workspaceId: ws.id, daysLeft }, "retention: final warning sent");
      } catch (err) {
        logger.error({ err, workspaceId: ws.id }, "retention: final warning failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "retention: could not query final-warning candidates");
  }

  // --- 3. Purge -----------------------------------------------------------
  try {
    for (const ws of await findDueForPurge()) {
      try {
        const result = await purgeWorkspacePhotos(ws.id);
        logger.warn(
          {
            workspaceId: ws.id,
            assetsDeleted: result.assets,
            objectsDeleted: result.objects,
            bytesReclaimed: result.bytes,
          },
          "retention: photos permanently deleted",
        );
      } catch (err) {
        logger.error({ err, workspaceId: ws.id }, "retention: purge failed, will retry");
      }
    }
  } catch (err) {
    logger.error({ err }, "retention: could not query purge candidates");
  }
}

export function startRetentionSweep(): NodeJS.Timeout {
  void runRetentionSweepOnce();
  const timer = setInterval(() => void runRetentionSweepOnce(), DAY_MS);
  // Don't keep the process alive solely for this timer.
  timer.unref?.();
  return timer;
}

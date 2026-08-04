import { and, eq, isNull, inArray } from "drizzle-orm";
import { db, schema } from "./db.js";
import { logger } from "./logger.js";
import { queues } from "./queues.js";
import type { EmbedAssetJobData } from "./processors/embed-asset.js";

/**
 * On startup, look for assets that haven't been processed yet and enqueue
 * embed jobs for them. This makes face matching "just work" for events that
 * were created before face matching was wired in.
 *
 * We pick anything that is `uploaded` (never tried) OR `failed` (last try
 * failed; retry). `processing` is skipped because another worker may already
 * own it. `ready` is skipped because it already has embeddings.
 */
export async function drainPendingAssets(): Promise<number> {
  const pending = await db
    .select({
      assetId: schema.assets.id,
      eventId: schema.assets.eventId,
      key: schema.assets.originalKey,
      mime: schema.assets.mime,
    })
    .from(schema.assets)
    .where(
      and(isNull(schema.assets.deletedAt), inArray(schema.assets.status, ["uploaded", "failed"])),
    );

  if (pending.length === 0) return 0;

  logger.info({ count: pending.length }, "draining pending assets into queue");

  // BullMQ's add() is idempotent on jobId, so retrying a previously-failed
  // job needs the old record cleared first. Otherwise the drain is a no-op
  // for everything that already exhausted its retries.
  for (const row of pending) {
    const existing = await queues.embedAsset.getJob(`embed-${row.assetId}`);
    if (existing) {
      await existing.remove().catch(() => undefined);
    }
  }

  for (const row of pending) {
    const data: EmbedAssetJobData = {
      assetId: row.assetId,
      eventId: row.eventId,
      key: row.key,
      mime: row.mime,
    };
    await queues.embedAsset.add("embed-asset", data, {
      jobId: `embed-${row.assetId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86_400 },
    });
  }

  return pending.length;
}

/**
 * Unused helper kept here for future "reset an asset" flows; not exported
 * from the package, just a convenient util.
 */
export async function markAssetUploaded(assetId: string): Promise<void> {
  await db.update(schema.assets).set({ status: "uploaded" }).where(eq(schema.assets.id, assetId));
}

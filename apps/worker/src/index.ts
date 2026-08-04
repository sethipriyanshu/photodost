import { logger } from "./logger.js";
import { drainPendingAssets } from "./drain.js";
import { ensureHnswIndex } from "./processors/embed-asset.js";
import { startStorageReconciliation } from "./reconcile.js";
import { startBillingSweep } from "./billing-sweep.js";
import { startRetentionSweep } from "./retention.js";
import { shutdown, startWorkers } from "./queues.js";

async function main() {
  logger.info({ nodeEnv: process.env.NODE_ENV }, "photo-dost worker starting");

  // Best-effort: apply the HNSW index for fast vector search. Idempotent.
  try {
    await ensureHnswIndex();
    logger.info("HNSW index ensured");
  } catch (err) {
    logger.warn({ err }, "could not ensure HNSW index (continuing)");
  }

  const workers = startWorkers();

  // Heal any storage-counter drift now and daily thereafter.
  startStorageReconciliation();

  // Apply cancellations whose paid period has lapsed. Cashfree cancels
  // immediately, so this is what makes cancel-at-period-end real.
  startBillingSweep();

  // Warn, then permanently delete photos once the retention grace period has
  // elapsed. Irreversible — see the safety notes in retention.ts.
  startRetentionSweep();

  // Catch up on any photos that were uploaded before face matching ran (or
  // failed mid-flight). Runs once on each boot.
  try {
    const queued = await drainPendingAssets();
    if (queued > 0) {
      logger.info({ queued }, "queued backlog of pending embeds");
    }
  } catch (err) {
    logger.error({ err }, "drainPendingAssets failed (continuing)");
  }

  const stop = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, "received shutdown signal");
    await shutdown(workers);
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "unhandledRejection");
  });
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "uncaughtException");
    process.exit(1);
  });

  logger.info("photo-dost worker ready");
}

main().catch((err) => {
  logger.error({ err }, "fatal error during startup");
  process.exit(1);
});

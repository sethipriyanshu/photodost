import { recomputeAllWorkspaceUsage } from "@photodost/db";
import { db } from "./db.js";
import { logger } from "./logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Recompute every workspace's storage_used_bytes from the authoritative source
 * rows, healing any drift from crashed uploads or missed decrements. Runs once
 * on boot and then daily.
 */
export async function reconcileStorageOnce(): Promise<void> {
  try {
    const corrected = await recomputeAllWorkspaceUsage(db);
    if (corrected > 0) {
      logger.warn({ corrected }, "storage reconciliation corrected workspace counters");
    } else {
      logger.info("storage reconciliation: all workspace counters already accurate");
    }
  } catch (err) {
    logger.error({ err }, "storage reconciliation failed");
  }
}

export function startStorageReconciliation(): NodeJS.Timeout {
  // Fire-and-forget the boot run; don't block worker startup on it.
  void reconcileStorageOnce();
  const timer = setInterval(() => void reconcileStorageOnce(), DAY_MS);
  // Don't keep the process alive solely for this timer.
  timer.unref?.();
  return timer;
}

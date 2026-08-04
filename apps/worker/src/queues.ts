/**
 * BullMQ queue + worker registry.
 *
 *  - `embed-asset`: extracts faces + embeddings from a freshly uploaded photo
 *    and stores them in pgvector. Producer = apps/web, consumer = this worker.
 *
 *  - `process-asset`: future (thumbnails / EXIF) — kept as a no-op stub so
 *    we can wire it without restructuring later.
 */
import { Queue, Worker, type Processor } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { type EmbedAssetJobData, processEmbedAsset } from "./processors/embed-asset.js";

export const QUEUE_NAMES = {
  processAsset: "process-asset",
  embedAsset: "embed-asset",
} as const;

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

connection.on("error", (err: Error) => {
  logger.error({ err }, "redis connection error");
});

export const queues = {
  processAsset: new Queue(QUEUE_NAMES.processAsset, { connection }),
  embedAsset: new Queue<EmbedAssetJobData>(QUEUE_NAMES.embedAsset, {
    connection,
  }),
};

const noopProcessor: Processor = async (job) => {
  logger.info({ queue: job.queueName, jobId: job.id, name: job.name }, "no-op processor invoked");
};

const embedAssetProcessor: Processor<EmbedAssetJobData> = async (job) => {
  return processEmbedAsset(job.data);
};

export function startWorkers(): Worker[] {
  const workers = [
    new Worker(QUEUE_NAMES.processAsset, noopProcessor, {
      connection,
      concurrency: 4,
    }),
    new Worker<EmbedAssetJobData>(QUEUE_NAMES.embedAsset, embedAssetProcessor, {
      connection,
      // Tuned for CPU inference: 2 in flight keeps the ML service warm
      // without queueing inside FastAPI.
      concurrency: 2,
    }),
  ];

  for (const w of workers) {
    w.on("ready", () => logger.info({ queue: w.name }, "worker ready"));
    w.on("completed", (job) => logger.debug({ queue: w.name, jobId: job.id }, "job completed"));
    w.on("failed", (job, err) =>
      logger.error({ queue: w.name, jobId: job?.id, err }, "job failed"),
    );
  }

  return workers;
}

export async function shutdown(workers: Worker[]): Promise<void> {
  logger.info("shutting down workers");
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(Object.values(queues).map((q) => q.close()));
  await connection.quit();
}

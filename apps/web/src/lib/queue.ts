import "server-only";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./env";

declare global {
  var __photodostRedis: Redis | undefined;
  var __photodostQueues:
    | {
        embedAsset: Queue<EmbedAssetJobData>;
      }
    | undefined;
}

export interface EmbedAssetJobData {
  assetId: string;
  eventId: string;
  key: string;
  mime: string;
}

function makeRedis(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    // Producer-only: don't crash the request when redis is temporarily down,
    // queue.add will surface the error in the route handler.
    lazyConnect: false,
  });
}

const connection = globalThis.__photodostRedis ?? makeRedis();
if (env.NODE_ENV !== "production") {
  globalThis.__photodostRedis = connection;
}

const cached =
  globalThis.__photodostQueues ??
  ({
    embedAsset: new Queue<EmbedAssetJobData>("embed-asset", { connection }),
  } as const);

if (env.NODE_ENV !== "production") {
  globalThis.__photodostQueues = cached;
}

export const queues = cached;

export async function enqueueEmbedAsset(data: EmbedAssetJobData): Promise<void> {
  await queues.embedAsset.add("embed-asset", data, {
    jobId: `embed-${data.assetId}`,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86_400 },
  });
}

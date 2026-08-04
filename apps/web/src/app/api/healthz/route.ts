import { NextResponse } from "next/server";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { BUCKET, s3 } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health probe for the platform's load balancer.
 *
 * This previously returned `{status:"ok"}` unconditionally, so the check passed
 * while Postgres, Redis and storage were all unreachable — the platform would
 * keep routing traffic to a completely broken instance. Each dependency is now
 * actually contacted.
 *
 * `?deep=0` returns liveness only, for callers that just want to know the process
 * is answering without paying for three round-trips.
 */

const TIMEOUT_MS = 3_000;

type CheckResult = { ok: true; ms: number } | { ok: false; ms: number; error: string };

async function timed(name: string, fn: () => Promise<unknown>): Promise<CheckResult> {
  const started = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${name} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      ),
    ]);
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function checkPostgres(): Promise<CheckResult> {
  return timed("postgres", () => db.execute(sql`select 1`));
}

function checkStorage(): Promise<CheckResult> {
  return timed("storage", () => s3.send(new HeadBucketCommand({ Bucket: BUCKET })));
}

/**
 * A dedicated short-lived connection rather than the app's shared queue client —
 * a probe should observe Redis, not disturb the pool the request path depends on.
 */
async function checkRedis(): Promise<CheckResult> {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: TIMEOUT_MS,
    lazyConnect: true,
    // Without this, ioredis keeps retrying and the probe outlives its own timeout.
    retryStrategy: () => null,
  });
  try {
    return await timed("redis", async () => {
      await client.connect();
      await client.ping();
    });
  } finally {
    client.disconnect();
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  if (new URL(req.url).searchParams.get("deep") === "0") {
    return NextResponse.json({ status: "ok", service: "photodost-web", checks: "skipped" });
  }

  const [postgres, redis, storage] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkStorage(),
  ]);

  const checks = { postgres, redis, storage };
  const failed = Object.entries(checks)
    .filter(([, result]) => !result.ok)
    .map(([name]) => name);

  // 503 so the platform actually reacts. This takes an instance out of rotation
  // during a dependency blip, which is the right trade for a health check — the
  // alternative is quietly serving errors while reporting green.
  return NextResponse.json(
    {
      status: failed.length === 0 ? "ok" : "degraded",
      service: "photodost-web",
      time: new Date().toISOString(),
      failed,
      checks,
    },
    { status: failed.length === 0 ? 200 : 503 },
  );
}

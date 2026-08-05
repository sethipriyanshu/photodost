import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health probe for the platform's load balancer.
 *
 * Nothing is imported at module scope on purpose. `lib/env` throws on a missing
 * required variable, so importing it here would take the whole route down when
 * the app is misconfigured — which is exactly when a health check most needs to
 * answer. A misconfigured deploy then reports an opaque "service unavailable"
 * instead of naming the variable that's missing.
 *
 * So: every dependency is imported lazily, inside its own check, and a config
 * error is reported as a failed check rather than crashing the handler.
 *
 * - `?deep=0` — liveness. Cannot fail while the process is running.
 * - default    — readiness. Contacts Postgres, Redis and the bucket; 503 if any
 *                is unreachable, with the reason in the body.
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
  return timed("postgres", async () => {
    const [{ db }, { sql }] = await Promise.all([import("@/lib/db"), import("drizzle-orm")]);
    await db.execute(sql`select 1`);
  });
}

function checkStorage(): Promise<CheckResult> {
  return timed("storage", async () => {
    const [{ BUCKET, s3 }, { HeadBucketCommand }] = await Promise.all([
      import("@/lib/s3"),
      import("@aws-sdk/client-s3"),
    ]);
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  });
}

/**
 * A dedicated short-lived connection rather than the app's shared queue client —
 * a probe should observe Redis, not disturb the pool the request path depends on.
 */
function checkRedis(): Promise<CheckResult> {
  return timed("redis", async () => {
    const [{ env }, { Redis }] = await Promise.all([import("@/lib/env"), import("ioredis")]);
    const client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: TIMEOUT_MS,
      lazyConnect: true,
      // Without this, ioredis keeps retrying and outlives the probe's own timeout.
      retryStrategy: () => null,
    });
    try {
      await client.connect();
      await client.ping();
    } finally {
      client.disconnect();
    }
  });
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
  // during a dependency blip, which is the right trade for a readiness check —
  // the alternative is quietly serving errors while reporting green.
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

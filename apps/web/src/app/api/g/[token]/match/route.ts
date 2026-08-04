import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { getEventByShareToken, getVariantKeyMap, listEventAssets } from "@/lib/events";
import { embedPrimaryFace } from "@/lib/ml";
import { displayUrls } from "@/lib/s3";

export const runtime = "nodejs";

// Abuse guard: cap selfie searches per client (hashed IP) in a short window so
// a single device can't hammer the ML service or scrape a whole gallery.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 15;

/** Salted one-way hash so we can rate-limit/audit without storing raw IP/UA. */
function hashed(value: string): string {
  return createHash("sha256").update(`${value}::${env.BETTER_AUTH_SECRET}`).digest("hex");
}

interface RouteContext {
  params: Promise<{ token: string }>;
}

// ArcFace cosine distance is in [0, 2]. Empirically:
//   < 0.40 → very confident same person
//   < 0.50 → confident
//   < 0.60 → loose (more false positives)
// Default 0.55 biases toward "show me more" so guests don't miss themselves on
// a single off-angle frame; the photographer can tune it per event.
const DEFAULT_THRESHOLD = 0.55;

// Cap how many photos we return so a guest can't accidentally DOS the
// thumbnail render on a 2000-photo gallery.
const MAX_RESULTS = 200;

interface VectorRow {
  asset_id: string;
  distance: number;
  original_key: string;
  mime: string;
  width: number | null;
  height: number | null;
  [key: string]: unknown;
}

/**
 * Guest selfie → matched photos. The pipeline:
 *   1. ML /embed/primary returns the single largest face in the selfie.
 *   2. Query face_embeddings for this event_id ordered by cosine distance,
 *      then dedupe to one row per asset (we keep the best face per photo).
 *   3. Join back to assets to build the response.
 *
 * Falls back to "show everything" if face matching is genuinely off (no
 * embeddings yet because the ML service is still warming) so the guest UX
 * stays unbroken end-to-end.
 */
export async function POST(req: Request, { params }: RouteContext) {
  const { token } = await params;
  const event = await getEventByShareToken(token);
  if (!event || event.shareRevokedAt) {
    return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Selfie required (multipart/form-data with `selfie` field)" },
      { status: 400 },
    );
  }

  const selfie = formData.get("selfie");
  if (!(selfie instanceof Blob) || selfie.size === 0) {
    return NextResponse.json({ error: "Selfie required" }, { status: 400 });
  }
  if (selfie.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Selfie too large (max 10MB)" }, { status: 413 });
  }

  // Biometric consent is required before we process a face. The client sends
  // `consent=true` only after the guest ticks the consent box.
  if (formData.get("consent") !== "true") {
    return NextResponse.json(
      { error: "Consent is required to search by selfie.", code: "consent_required" },
      { status: 400 },
    );
  }

  // Hash the client identity so we can rate-limit and audit without storing PII.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const ipHash = hashed(ip);
  const uaHeader = req.headers.get("user-agent");
  const uaHash = uaHeader ? hashed(uaHeader) : null;

  // Rate limit: recent searches from this hashed IP within the window.
  const [rl] = await db
    .select({ n: count() })
    .from(schema.guestSearches)
    .where(
      and(
        eq(schema.guestSearches.ipHash, ipHash),
        gt(schema.guestSearches.createdAt, new Date(Date.now() - RATE_WINDOW_MS)),
      ),
    );
  if (Number(rl?.n ?? 0) >= RATE_MAX) {
    return NextResponse.json(
      { error: "Too many searches. Please wait a moment and try again.", code: "rate_limited" },
      { status: 429 },
    );
  }

  const startedAt = Date.now();

  /** Record the search for abuse detection + analytics. Never blocks the response. */
  const logSearch = async (matchCount: number) => {
    try {
      await db.insert(schema.guestSearches).values({
        eventId: event.id,
        ipHash,
        userAgentHash: uaHash,
        matchCount,
        tookMs: Date.now() - startedAt,
        consentGiven: true,
      });
    } catch (err) {
      console.error("[match] failed to log guest search", err);
    }
  };

  // Try real face matching. If ML is unreachable or returns no face, fall back
  // to showing all photos with faceMatchingActive=false so the UX still works.
  let matched: VectorRow[] | null = null;
  let faceMatchingActive = false;
  let mlError: string | null = null;
  const threshold = event.matchThreshold ?? DEFAULT_THRESHOLD;

  try {
    const ml = await embedPrimaryFace(selfie);
    if (ml.face) {
      const vectorLiteral = `[${ml.face.embedding.join(",")}]`;
      const rows = await db.execute<VectorRow>(sql`
        WITH ranked AS (
          SELECT
            fe.asset_id,
            (fe.embedding <=> ${vectorLiteral}::vector) AS distance,
            ROW_NUMBER() OVER (
              PARTITION BY fe.asset_id
              ORDER BY fe.embedding <=> ${vectorLiteral}::vector
            ) AS rn
          FROM face_embeddings fe
          WHERE fe.event_id = ${event.id}::uuid
        )
        SELECT
          ranked.asset_id,
          ranked.distance,
          a.original_key,
          a.mime,
          a.width,
          a.height
        FROM ranked
        JOIN assets a ON a.id = ranked.asset_id
        WHERE ranked.rn = 1
          AND ranked.distance < ${threshold}
          AND a.deleted_at IS NULL
        ORDER BY ranked.distance ASC
        LIMIT ${MAX_RESULTS};
      `);

      matched = (rows as unknown as { rows: VectorRow[] }).rows ?? (rows as unknown as VectorRow[]);
      faceMatchingActive = true;
    } else {
      mlError = `No face found in selfie (${ml.face_count} candidates).`;
    }
  } catch (err) {
    console.error("[match] ML pipeline failed, falling back", err);
    mlError = err instanceof Error ? err.message : "Face matching unavailable";
  }

  if (matched === null) {
    // Fallback: return every photo so guests still see something useful.
    const allAssets = await listEventAssets(event.id);
    const variantMap = await getVariantKeyMap(allAssets.map((a) => a.id));
    await logSearch(allAssets.length);
    return NextResponse.json({
      event: { name: event.name, date: event.date },
      matchedCount: allAssets.length,
      totalCount: allAssets.length,
      faceMatchingActive: false,
      reason: mlError,
      photos: allAssets.map((a) => ({
        id: a.id,
        ...displayUrls(a.originalKey, variantMap.get(a.id)),
        mime: a.mime,
        width: a.width,
        height: a.height,
        score: null as number | null,
      })),
    });
  }

  // Total photos in the event for the "X of Y" framing.
  const allAssets = await listEventAssets(event.id);
  const variantMap = await getVariantKeyMap(matched.map((r) => r.asset_id));
  await logSearch(matched.length);

  return NextResponse.json({
    event: { name: event.name, date: event.date },
    matchedCount: matched.length,
    totalCount: allAssets.length,
    faceMatchingActive,
    threshold,
    photos: matched.map((row) => ({
      id: row.asset_id,
      ...displayUrls(row.original_key, variantMap.get(row.asset_id)),
      mime: row.mime,
      width: row.width,
      height: row.height,
      score: Number((1 - row.distance).toFixed(3)),
    })),
  });
}

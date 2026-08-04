import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { getEventBySlug, getVariantKeyMap } from "@/lib/events";
import { getSessionWorkspace } from "@/lib/session";
import {
  checkQuota,
  quotaExceededResponse,
  subscriptionBlock,
  subscriptionLapsedResponse,
} from "@/lib/storage";
import { ALLOWED_UPLOAD_MIMES, displayUrls, extFromMime, keys, presignUpload } from "@/lib/s3";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file for the MVP

const bodySchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        mime: z.string().min(1).max(80),
        size: z.number().int().min(1).max(MAX_BYTES),
        // Optional content hash for dedupe. The client computes it when the
        // Web Crypto API is available (secure context); we skip dedupe if absent.
        sha256: z.string().length(64).optional(),
      }),
    )
    .min(1)
    .max(100),
});

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function POST(req: Request, { params }: RouteContext) {
  const { slug } = await params;
  const ctx = await getSessionWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const event = await getEventBySlug(ctx.workspace.id, slug);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // Lapsed subscription: no new uploads. Existing photos and the guest gallery
  // are untouched — only new writes are gated.
  const lapsed = subscriptionBlock(ctx.workspace);
  if (lapsed) return subscriptionLapsedResponse(lapsed);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        issues: parsed.error.issues.map((i) => i.message),
      },
      { status: 400 },
    );
  }

  // Dedupe: if a photo with the same content hash already lives in this event,
  // skip re-uploading it. Look the provided hashes up once.
  const providedHashes = parsed.data.files
    .map((f) => f.sha256)
    .filter((h): h is string => Boolean(h));
  const dupByHash = new Map<
    string,
    { id: string; originalKey: string; mime: string; bytes: number; createdAt: Date }
  >();
  if (providedHashes.length > 0) {
    const existing = await db
      .select({
        id: schema.assets.id,
        sha256: schema.assets.sha256,
        originalKey: schema.assets.originalKey,
        mime: schema.assets.mime,
        bytes: schema.assets.bytes,
        createdAt: schema.assets.createdAt,
      })
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.eventId, event.id),
          inArray(schema.assets.sha256, providedHashes),
          isNull(schema.assets.deletedAt),
        ),
      );
    for (const a of existing) if (a.sha256) dupByHash.set(a.sha256, a);
  }
  const dupVariantMap = await getVariantKeyMap([...dupByHash.values()].map((a) => a.id));

  // Reserve check only against the bytes we'll actually upload (excluding dupes).
  const requestedBytes = parsed.data.files.reduce(
    (sum, f) => sum + (f.sha256 && dupByHash.has(f.sha256) ? 0 : f.size),
    0,
  );
  const { ok, usage } = await checkQuota(ctx.workspace.id, requestedBytes);
  if (!ok) return quotaExceededResponse(usage, requestedBytes);

  const uploads = await Promise.all(
    parsed.data.files.map(async (file) => {
      const mime = file.mime.toLowerCase();
      if (!ALLOWED_UPLOAD_MIMES.has(mime)) {
        return {
          filename: file.filename,
          error: `Unsupported file type: ${mime}`,
        };
      }

      // Already in this event — tell the client to skip the upload.
      if (file.sha256 && dupByHash.has(file.sha256)) {
        const a = dupByHash.get(file.sha256)!;
        const { url, thumbUrl } = displayUrls(a.originalKey, dupVariantMap.get(a.id));
        return {
          filename: file.filename,
          duplicate: true as const,
          asset: {
            id: a.id,
            url,
            thumbUrl,
            mime: a.mime,
            bytes: Number(a.bytes),
            createdAt: a.createdAt,
          },
        };
      }

      const assetId = randomUUID();
      const key = keys.original(ctx.workspace.id, event.id, assetId, extFromMime(mime));
      const uploadUrl = await presignUpload({ key, contentType: mime });

      return {
        filename: file.filename,
        assetId,
        key,
        uploadUrl,
        mime,
        size: file.size,
        sha256: file.sha256,
      };
    }),
  );

  return NextResponse.json({ uploads });
}

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { getEventBySlug, getVariantKeyMap, listEventAssets } from "@/lib/events";
import { getSessionWorkspace } from "@/lib/session";
import { enqueueEmbedAsset } from "@/lib/queue";
import { deleteObject, displayUrls, headObjectSize } from "@/lib/s3";
import { quotaExceededResponse, recordStorageDelta, usageFromWorkspace } from "@/lib/storage";

export const runtime = "nodejs";

const registerSchema = z.object({
  assets: z
    .array(
      z.object({
        assetId: z.string().uuid(),
        key: z.string().min(1),
        mime: z.string().min(1),
        size: z.number().int().min(1),
        filename: z.string().optional(),
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

  const parsed = registerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Authoritative sizing: read the REAL byte size of each uploaded object from
  // storage. We never trust the client-declared size for quota accounting.
  // Objects that aren't there (upload never completed) are dropped.
  const sized = await Promise.all(
    parsed.data.assets.map(async (a) => ({ a, bytes: await headObjectSize(a.key) })),
  );
  const present = sized.filter(
    (s): s is { a: (typeof sized)[number]["a"]; bytes: number } =>
      typeof s.bytes === "number" && s.bytes > 0,
  );
  const totalBytes = present.reduce((sum, s) => sum + s.bytes, 0);

  // Commit atomically: lock the workspace row, re-check the cap against real
  // sizes, insert assets, and bump usage + ledger in one transaction.
  const workspaceId = ctx.workspace.id;
  const result = await db.transaction(async (tx) => {
    const [ws] = await tx
      .select({
        storageUsedBytes: schema.workspaces.storageUsedBytes,
        storageQuotaBytes: schema.workspaces.storageQuotaBytes,
        plan: schema.workspaces.plan,
      })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .for("update")
      .limit(1);

    const usage = usageFromWorkspace(ws!);
    if (usage.usedBytes + totalBytes > usage.quotaBytes) {
      return { over: true as const, usage };
    }

    const rows = present.map(({ a, bytes }) => ({
      id: a.assetId,
      eventId: event.id,
      originalKey: a.key,
      mime: a.mime,
      bytes,
      sha256: a.sha256 ?? null,
      status: "uploaded" as const,
    }));

    const ins = rows.length
      ? await tx.insert(schema.assets).values(rows).onConflictDoNothing().returning({
          id: schema.assets.id,
          originalKey: schema.assets.originalKey,
          mime: schema.assets.mime,
          bytes: schema.assets.bytes,
          createdAt: schema.assets.createdAt,
        })
      : [];

    const committedBytes = ins.reduce((sum, r) => sum + Number(r.bytes), 0);
    await recordStorageDelta(tx, {
      workspaceId,
      deltaBytes: committedBytes,
      reason: "asset_upload",
    });

    return { over: false as const, inserted: ins };
  });

  if (result.over) {
    // Reject and clean up the orphaned objects we declined to count.
    await Promise.allSettled(present.map((s) => deleteObject(s.a.key)));
    return quotaExceededResponse(result.usage, totalBytes);
  }

  const inserted = result.inserted;

  // Fire-and-forget the face-embed jobs. Failure here shouldn't block the
  // upload response — the worker also picks up stragglers on startup.
  await Promise.allSettled(
    inserted.map((a) =>
      enqueueEmbedAsset({
        assetId: a.id,
        eventId: event.id,
        key: a.originalKey,
        mime: a.mime,
      }),
    ),
  );

  return NextResponse.json({
    assets: inserted.map((a) => {
      // Freshly uploaded — derivatives don't exist yet, so thumbUrl falls back
      // to the original until the worker processes it (visible on next refresh).
      const { url, thumbUrl } = displayUrls(a.originalKey);
      return {
        id: a.id,
        url,
        thumbUrl,
        mime: a.mime,
        bytes: a.bytes,
        createdAt: a.createdAt,
      };
    }),
  });
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { slug } = await params;
  const ctx = await getSessionWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const event = await getEventBySlug(ctx.workspace.id, slug);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const assets = await listEventAssets(event.id);
  const variantMap = await getVariantKeyMap(assets.map((a) => a.id));
  return NextResponse.json({
    assets: assets.map((a) => {
      const { url, thumbUrl } = displayUrls(a.originalKey, variantMap.get(a.id));
      return {
        id: a.id,
        url,
        thumbUrl,
        mime: a.mime,
        bytes: a.bytes,
        width: a.width,
        height: a.height,
        createdAt: a.createdAt,
      };
    }),
  });
}

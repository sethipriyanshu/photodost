import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getEventBySlug } from "@/lib/events";
import { getSessionWorkspace } from "@/lib/session";
import { deleteObject } from "@/lib/s3";
import { recordStorageDelta } from "@/lib/storage";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ slug: string; assetId: string }>;
}

/**
 * Hard-delete a photo from an event.
 *
 *  - Cascades to face_embeddings + asset_variants via FK ON DELETE CASCADE.
 *  - Best-effort removes the original object from S3 (and any future
 *    thumb/preview keys we add). S3 failure is logged but doesn't fail the
 *    request — the DB row is the source of truth for what the user can see.
 */
export async function DELETE(_req: Request, { params }: RouteContext) {
  const { slug, assetId } = await params;
  const ctx = await getSessionWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const event = await getEventBySlug(ctx.workspace.id, slug);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // Fetch + delete in one round-trip via `returning()` so we both verify the
  // asset belongs to this event and capture the S3 key + bytes we need for
  // cleanup and quota reclamation.
  const workspaceId = ctx.workspace.id;
  const removed = await db.transaction(async (tx) => {
    // Capture derivative keys before the delete cascades their rows away.
    const variants = await tx
      .select({ key: schema.assetVariants.key })
      .from(schema.assetVariants)
      .where(eq(schema.assetVariants.assetId, assetId));

    const rows = await tx
      .delete(schema.assets)
      .where(and(eq(schema.assets.id, assetId), eq(schema.assets.eventId, event.id)))
      .returning({
        id: schema.assets.id,
        originalKey: schema.assets.originalKey,
        bytes: schema.assets.bytes,
      });
    if (rows[0]) {
      await recordStorageDelta(tx, {
        workspaceId,
        deltaBytes: -Number(rows[0].bytes),
        reason: "asset_delete",
        objectKey: rows[0].originalKey,
      });
    }
    return { rows, variantKeys: variants.map((v) => v.key) };
  });

  if (removed.rows.length === 0) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const asset = removed.rows[0]!;
  // Best-effort remove the original + every derivative object.
  const keys = [asset.originalKey, ...removed.variantKeys];
  await Promise.allSettled(
    keys.map(async (key) => {
      try {
        await deleteObject(key);
      } catch (err) {
        console.error("[delete-asset] S3 delete failed (DB row already gone)", {
          assetId,
          key,
          err: err instanceof Error ? err.message : err,
        });
      }
    }),
  );

  return NextResponse.json({ id: asset.id, deleted: true });
}

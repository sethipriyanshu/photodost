import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ensureAlbum, getAlbumForEvent } from "@/lib/albums";
import { db, schema } from "@/lib/db";
import { getEventBySlug } from "@/lib/events";
import { getSessionWorkspace } from "@/lib/session";
import { deleteObject, headObjectSize } from "@/lib/s3";
import { recordStorageDelta } from "@/lib/storage";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

const finalizeSchema = z.object({
  kind: z.enum(["cover", "spread", "back"]),
  pages: z
    .array(
      z.object({
        pageId: z.string().uuid(),
        key: z.string().min(1).max(512),
        position: z.number().int().min(0).max(500),
        width: z.number().int().positive().nullable().optional(),
        height: z.number().int().positive().nullable().optional(),
      }),
    )
    .min(1)
    .max(60),
});

/**
 * Record album pages after the browser has uploaded them.
 *
 * Byte counts come from HeadObject, never from the client — the same rule the
 * event-photo finalize follows, so a client can't under-report and slip past the
 * storage quota.
 */
export async function POST(req: Request, { params }: RouteContext) {
  const { slug } = await params;
  const ctx = await getSessionWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const event = await getEventBySlug(ctx.workspace.id, slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const parsed = finalizeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { kind, pages } = parsed.data;

  // The key must live under this workspace and event, or a caller could point a
  // page row at somebody else's object.
  const prefix = `w/${ctx.workspace.id}/events/${event.id}/album/`;
  if (pages.some((p) => !p.key.startsWith(prefix))) {
    return NextResponse.json({ error: "Invalid object key" }, { status: 400 });
  }

  const albumId = await ensureAlbum(event.id);

  const sized = await Promise.all(
    pages.map(async (p) => ({ ...p, bytes: await headObjectSize(p.key) })),
  );
  const landed = sized.filter((p): p is typeof p & { bytes: number } => p.bytes !== null);
  if (landed.length === 0) {
    return NextResponse.json({ error: "No uploads completed." }, { status: 400 });
  }

  // Replacing a cover means the old object has to go, or it lingers unreferenced
  // and keeps consuming quota forever.
  let replacedBytes = 0;
  const replacedKeys: string[] = [];
  if (kind !== "spread") {
    const existing = await db
      .select({
        id: schema.albumPages.id,
        objectKey: schema.albumPages.objectKey,
        bytes: schema.albumPages.bytes,
      })
      .from(schema.albumPages)
      .where(and(eq(schema.albumPages.albumId, albumId), eq(schema.albumPages.kind, kind)));
    for (const row of existing) {
      replacedBytes += Number(row.bytes);
      replacedKeys.push(row.objectKey);
    }
    if (existing.length > 0) {
      await db
        .delete(schema.albumPages)
        .where(and(eq(schema.albumPages.albumId, albumId), eq(schema.albumPages.kind, kind)));
    }
  }

  const addedBytes = landed.reduce((sum, p) => sum + p.bytes, 0);

  await db.transaction(async (tx) => {
    await tx.insert(schema.albumPages).values(
      landed.map((p) => ({
        id: p.pageId,
        albumId,
        kind,
        position: p.position,
        objectKey: p.key,
        bytes: p.bytes,
        width: p.width ?? null,
        height: p.height ?? null,
      })),
    );

    const delta = addedBytes - replacedBytes;
    if (delta !== 0) {
      await recordStorageDelta(tx, {
        workspaceId: ctx.workspace.id,
        deltaBytes: delta,
        reason: delta > 0 ? "album_upload" : "album_delete",
      });
    }
  });

  // Best-effort: the rows are already gone, so a failure here only leaks bytes
  // in the bucket, which reconciliation and the retention purge will catch.
  await Promise.allSettled(replacedKeys.map((k) => deleteObject(k)));

  const album = await getAlbumForEvent(event.id);
  return NextResponse.json({ album, added: landed.length });
}

/** Remove one page (a spread, or a cover the photographer wants gone). */
export async function DELETE(req: Request, { params }: RouteContext) {
  const { slug } = await params;
  const ctx = await getSessionWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const event = await getEventBySlug(ctx.workspace.id, slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const pageId = new URL(req.url).searchParams.get("pageId");
  if (!pageId) return NextResponse.json({ error: "pageId is required" }, { status: 400 });

  const album = await getAlbumForEvent(event.id);
  if (!album) return NextResponse.json({ error: "No album" }, { status: 404 });

  const [removed] = await db
    .delete(schema.albumPages)
    .where(and(eq(schema.albumPages.id, pageId), eq(schema.albumPages.albumId, album.id)))
    .returning({ objectKey: schema.albumPages.objectKey, bytes: schema.albumPages.bytes });

  if (!removed) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  await recordStorageDelta(db, {
    workspaceId: ctx.workspace.id,
    deltaBytes: -Number(removed.bytes),
    reason: "album_delete",
    objectKey: removed.objectKey,
  });
  await deleteObject(removed.objectKey).catch(() => {});

  return NextResponse.json({ album: await getAlbumForEvent(event.id) });
}

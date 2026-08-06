import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ensureAlbum, getAlbumForEvent } from "@/lib/albums";
import { db, schema } from "@/lib/db";
import { getEventBySlug } from "@/lib/events";
import { getSessionWorkspace } from "@/lib/session";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

const patchSchema = z.object({ published: z.boolean() });

/**
 * Publish or unpublish the album.
 *
 * Guests only ever see a published album, so a photographer can upload twenty
 * spreads over an afternoon without a half-built book being visible from the QR
 * the whole time.
 */
export async function PATCH(req: Request, { params }: RouteContext) {
  const { slug } = await params;
  const ctx = await getSessionWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const event = await getEventBySlug(ctx.workspace.id, slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const albumId = await ensureAlbum(event.id);

  if (parsed.data.published) {
    const album = await getAlbumForEvent(event.id);
    // Publishing an empty album would give guests a CTA that opens nothing.
    if (!album?.cover && (album?.spreads.length ?? 0) === 0) {
      return NextResponse.json(
        { error: "Add a cover or at least one spread before publishing." },
        { status: 400 },
      );
    }
  }

  await db
    .update(schema.albums)
    .set({
      publishedAt: parsed.data.published ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.albums.id, albumId));

  return NextResponse.json({ album: await getAlbumForEvent(event.id) });
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { slug } = await params;
  const ctx = await getSessionWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const event = await getEventBySlug(ctx.workspace.id, slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  return NextResponse.json({ album: await getAlbumForEvent(event.id) });
}

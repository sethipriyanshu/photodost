import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { getEventBySlug } from "@/lib/events";
import { getSessionWorkspace } from "@/lib/session";
import { generateShareToken } from "@/lib/tokens";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

const patchSchema = z.object({
  // Cosine-distance threshold bounds. Lower = stricter (fewer, surer matches),
  // higher = looser (more matches, more false positives).
  matchThreshold: z.number().min(0.3).max(0.7).optional(),
  // Pause/resume the public guest link.
  shareRevoked: z.boolean().optional(),
  // Mint a fresh share token (invalidates the old QR/link).
  rotateShareToken: z.boolean().optional(),
  // Set/clear the cover photo (must be an asset in this event).
  coverAssetId: z.string().uuid().nullable().optional(),
});

/** Update event settings: match sensitivity, share link state, cover photo. */
export async function PATCH(req: Request, { params }: RouteContext) {
  const { slug } = await params;
  const ctx = await getSessionWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const event = await getEventBySlug(ctx.workspace.id, slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const data = parsed.data;

  const updates: Partial<typeof schema.events.$inferInsert> = { updatedAt: new Date() };
  if (data.matchThreshold !== undefined) updates.matchThreshold = data.matchThreshold;
  if (data.shareRevoked !== undefined) {
    updates.shareRevokedAt = data.shareRevoked ? new Date() : null;
  }
  if (data.rotateShareToken) updates.shareToken = generateShareToken();
  if (data.coverAssetId !== undefined) {
    if (data.coverAssetId === null) {
      updates.coverAssetId = null;
    } else {
      const [asset] = await db
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(and(eq(schema.assets.id, data.coverAssetId), eq(schema.assets.eventId, event.id)))
        .limit(1);
      if (!asset) {
        return NextResponse.json({ error: "Cover photo not in this event" }, { status: 400 });
      }
      updates.coverAssetId = data.coverAssetId;
    }
  }

  const [updated] = await db
    .update(schema.events)
    .set(updates)
    .where(eq(schema.events.id, event.id))
    .returning();

  return NextResponse.json({
    event: {
      slug: updated!.slug,
      shareToken: updated!.shareToken,
      shareRevoked: Boolean(updated!.shareRevokedAt),
      matchThreshold: updated!.matchThreshold,
      coverAssetId: updated!.coverAssetId,
    },
  });
}

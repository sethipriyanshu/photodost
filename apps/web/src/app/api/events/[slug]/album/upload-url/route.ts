import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureAlbum, nextSpreadPosition } from "@/lib/albums";
import { getEventBySlug } from "@/lib/events";
import { getSessionWorkspace } from "@/lib/session";
import { ALLOWED_UPLOAD_MIMES, extFromMime, keys, presignUpload } from "@/lib/s3";
import {
  checkQuota,
  quotaExceededResponse,
  subscriptionBlock,
  subscriptionLapsedResponse,
} from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Album spreads are exported at print resolution, so they run larger than event
 * photos. 40 MB per page, versus 25 MB for a shot.
 */
const MAX_BYTES = 40 * 1024 * 1024;

const bodySchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        mime: z.string().min(1).max(80),
        // min(1) rejects the 0-byte files that turn up in copied folders — they
        // would otherwise upload "successfully" as an unrenderable page.
        size: z.number().int().min(1).max(MAX_BYTES),
        width: z.number().int().positive().max(30000).optional(),
        height: z.number().int().positive().max(30000).optional(),
      }),
    )
    .min(1)
    .max(60),
  kind: z.enum(["cover", "spread", "back"]),
});

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * Presign uploads for album pages.
 *
 * Positions are assigned here, in the order the photographer selected the files
 * — there is no filename parsing, because album exports are named
 * inconsistently ("(2).jpg", "(141).jpg") and a lexical sort would put spread 12
 * before spread 2.
 */
export async function POST(req: Request, { params }: RouteContext) {
  const { slug } = await params;
  const ctx = await getSessionWorkspace();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const event = await getEventBySlug(ctx.workspace.id, slug);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const lapsed = subscriptionBlock(ctx.workspace);
  if (lapsed) return subscriptionLapsedResponse(lapsed);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  const { files, kind } = parsed.data;

  // Only one cover and one back cover exist; the unique index enforces it, but
  // rejecting here gives a usable message instead of a constraint violation.
  if (kind !== "spread" && files.length !== 1) {
    return NextResponse.json(
      { error: `Choose a single image for the ${kind === "cover" ? "front" : "back"} cover.` },
      { status: 400 },
    );
  }

  for (const f of files) {
    if (!ALLOWED_UPLOAD_MIMES.has(f.mime.toLowerCase())) {
      return NextResponse.json(
        { error: `${f.filename}: only JPEG and PNG are supported.` },
        { status: 400 },
      );
    }
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const { ok, usage } = await checkQuota(ctx.workspace.id, totalBytes);
  if (!ok) return quotaExceededResponse(usage, totalBytes);

  const albumId = await ensureAlbum(event.id);
  const firstPosition = kind === "spread" ? await nextSpreadPosition(albumId) : 0;

  const uploads = await Promise.all(
    files.map(async (f, index) => {
      const pageId = randomUUID();
      const key = keys.albumPage(ctx.workspace.id, event.id, pageId, extFromMime(f.mime));
      return {
        pageId,
        key,
        filename: f.filename,
        mime: f.mime,
        width: f.width ?? null,
        height: f.height ?? null,
        position: kind === "spread" ? firstPosition + index : 0,
        uploadUrl: await presignUpload({ key, contentType: f.mime }),
      };
    }),
  );

  return NextResponse.json({ albumId, kind, uploads });
}

import "server-only";
import { and, asc, desc, eq, max } from "drizzle-orm";
import { db, schema } from "./db";
import { publicUrlFor } from "./s3";

/**
 * Flipbook albums: a curated, designed album for an event.
 *
 * Distinct from the event's `assets`, which are individually face-matched and
 * searchable. Album pages are a fixed sequence — a front cover, a run of
 * double-page spreads, and a back cover — exported from album software and read
 * cover to cover.
 */

export type AlbumPageKind = (typeof schema.albumPageKind.enumValues)[number];

export interface AlbumPageRow {
  id: string;
  kind: AlbumPageKind;
  position: number;
  objectKey: string;
  bytes: number;
  width: number | null;
  height: number | null;
  url: string;
}

export interface AlbumSummary {
  id: string;
  eventId: string;
  publishedAt: Date | null;
  cover: AlbumPageRow | null;
  back: AlbumPageRow | null;
  spreads: AlbumPageRow[];
  totalBytes: number;
}

function toRow(r: {
  id: string;
  kind: AlbumPageKind;
  position: number;
  objectKey: string;
  bytes: number;
  width: number | null;
  height: number | null;
}): AlbumPageRow {
  return { ...r, url: publicUrlFor(r.objectKey) };
}

/** Every page of an event's album, already split by role and ordered. */
export async function getAlbumForEvent(eventId: string): Promise<AlbumSummary | null> {
  const [album] = await db
    .select()
    .from(schema.albums)
    .where(eq(schema.albums.eventId, eventId))
    .limit(1);
  if (!album) return null;

  const pages = await db
    .select({
      id: schema.albumPages.id,
      kind: schema.albumPages.kind,
      position: schema.albumPages.position,
      objectKey: schema.albumPages.objectKey,
      bytes: schema.albumPages.bytes,
      width: schema.albumPages.width,
      height: schema.albumPages.height,
    })
    .from(schema.albumPages)
    .where(eq(schema.albumPages.albumId, album.id))
    .orderBy(asc(schema.albumPages.position), asc(schema.albumPages.createdAt));

  const rows = pages.map(toRow);
  return {
    id: album.id,
    eventId: album.eventId,
    publishedAt: album.publishedAt,
    cover: rows.find((p) => p.kind === "cover") ?? null,
    back: rows.find((p) => p.kind === "back") ?? null,
    spreads: rows.filter((p) => p.kind === "spread"),
    totalBytes: rows.reduce((sum, p) => sum + Number(p.bytes), 0),
  };
}

/** Create the album row on demand, so uploading the first page just works. */
export async function ensureAlbum(eventId: string): Promise<string> {
  const existing = await db
    .select({ id: schema.albums.id })
    .from(schema.albums)
    .where(eq(schema.albums.eventId, eventId))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const [created] = await db
    .insert(schema.albums)
    .values({ eventId })
    .onConflictDoNothing({ target: schema.albums.eventId })
    .returning({ id: schema.albums.id });
  if (created) return created.id;

  // Lost a race with a concurrent upload; the other insert won.
  const [row] = await db
    .select({ id: schema.albums.id })
    .from(schema.albums)
    .where(eq(schema.albums.eventId, eventId))
    .limit(1);
  return row!.id;
}

/**
 * Next free spread position. Spreads run 1..N — 0 is reserved for the covers,
 * which are distinguished by `kind` (see the unique index on the table).
 */
export async function nextSpreadPosition(albumId: string): Promise<number> {
  const [row] = await db
    .select({ highest: max(schema.albumPages.position) })
    .from(schema.albumPages)
    .where(and(eq(schema.albumPages.albumId, albumId), eq(schema.albumPages.kind, "spread")));
  return (row?.highest ?? 0) + 1;
}

/**
 * The album a guest is allowed to see, resolved from the event's share token.
 *
 * Returns null unless the album is published and has at least a cover or one
 * spread — an empty or half-built album should show nothing rather than an
 * empty book. Revoked share tokens are refused here too, so the album can't
 * outlive the gallery it belongs to.
 */
export async function getPublishedAlbumByShareToken(token: string): Promise<{
  eventName: string;
  accentColor: string | null;
  album: AlbumSummary;
} | null> {
  const [event] = await db
    .select({
      id: schema.events.id,
      name: schema.events.name,
      shareRevokedAt: schema.events.shareRevokedAt,
      workspaceId: schema.events.workspaceId,
    })
    .from(schema.events)
    .where(eq(schema.events.shareToken, token))
    .limit(1);

  if (!event || event.shareRevokedAt) return null;

  const album = await getAlbumForEvent(event.id);
  if (!album?.publishedAt) return null;
  if (!album.cover && album.spreads.length === 0) return null;

  const [ws] = await db
    .select({ accentColor: schema.workspaces.accentColor })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, event.workspaceId))
    .limit(1);

  return { eventName: event.name, accentColor: ws?.accentColor ?? null, album };
}

/** Whether a guest CTA should be shown for this event. */
export async function hasPublishedAlbum(eventId: string): Promise<boolean> {
  const [row] = await db
    .select({ publishedAt: schema.albums.publishedAt, id: schema.albums.id })
    .from(schema.albums)
    .where(eq(schema.albums.eventId, eventId))
    .limit(1);
  if (!row?.publishedAt) return false;

  const [page] = await db
    .select({ id: schema.albumPages.id })
    .from(schema.albumPages)
    .where(eq(schema.albumPages.albumId, row.id))
    .orderBy(desc(schema.albumPages.createdAt))
    .limit(1);
  return Boolean(page);
}

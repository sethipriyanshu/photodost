import "server-only";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "./db";
import { displayUrls } from "./s3";

export type VariantKeys = { thumb?: string; preview?: string };

/**
 * Map of assetId → its derivative object keys (thumb/preview), for the given
 * assets. Used to render galleries from thumbnails instead of originals.
 */
export async function getVariantKeyMap(assetIds: string[]): Promise<Map<string, VariantKeys>> {
  const map = new Map<string, VariantKeys>();
  if (assetIds.length === 0) return map;
  const rows = await db
    .select({
      assetId: schema.assetVariants.assetId,
      variant: schema.assetVariants.variant,
      key: schema.assetVariants.key,
    })
    .from(schema.assetVariants)
    .where(inArray(schema.assetVariants.assetId, assetIds));
  for (const r of rows) {
    const entry = map.get(r.assetId) ?? {};
    if (r.variant === "thumb") entry.thumb = r.key;
    else if (r.variant === "preview") entry.preview = r.key;
    map.set(r.assetId, entry);
  }
  return map;
}

/**
 * Look up an event by slug *within a workspace*. A slug alone is never enough
 * to reach an event — the workspace scope is the authorization boundary.
 */
export async function getEventBySlug(workspaceId: string, slug: string) {
  const rows = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.workspaceId, workspaceId), eq(schema.events.slug, slug)))
    .limit(1);
  return rows[0] ?? null;
}

/** Public, unauthenticated lookup for the guest gallery. Token is the capability. */
export async function getEventByShareToken(token: string) {
  const rows = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.shareToken, token))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Map of eventId → cover thumbnail URL, for events that have a cover set.
 * Used to render cover art on the events list.
 */
export async function getEventCoverThumbs(
  events: { id: string; coverAssetId: string | null }[],
): Promise<Map<string, string>> {
  const coverIds = events.map((e) => e.coverAssetId).filter((x): x is string => Boolean(x));
  const result = new Map<string, string>();
  if (coverIds.length === 0) return result;

  const coverAssets = await db
    .select({ id: schema.assets.id, originalKey: schema.assets.originalKey })
    .from(schema.assets)
    .where(and(inArray(schema.assets.id, coverIds), isNull(schema.assets.deletedAt)));
  const variantMap = await getVariantKeyMap(coverAssets.map((a) => a.id));
  const byAsset = new Map(
    coverAssets.map((a) => [a.id, displayUrls(a.originalKey, variantMap.get(a.id)).thumbUrl]),
  );

  for (const e of events) {
    if (!e.coverAssetId) continue;
    const url = byAsset.get(e.coverAssetId);
    if (url) result.set(e.id, url);
  }
  return result;
}

/** Number of events in a workspace — the value the event quota is checked against. */
export async function countWorkspaceEvents(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.events)
    .where(eq(schema.events.workspaceId, workspaceId));
  return Number(row?.n ?? 0);
}

export async function listEvents(workspaceId: string) {
  return db
    .select()
    .from(schema.events)
    .where(eq(schema.events.workspaceId, workspaceId))
    .orderBy(desc(schema.events.createdAt))
    .limit(100);
}

export async function listEventAssets(eventId: string) {
  return db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.eventId, eventId), isNull(schema.assets.deletedAt)))
    .orderBy(desc(schema.assets.createdAt));
}

export async function countEventAssets(eventId: string): Promise<number> {
  const rows = await db
    .select({ count: schema.assets.id })
    .from(schema.assets)
    .where(and(eq(schema.assets.eventId, eventId), isNull(schema.assets.deletedAt)));
  return rows.length;
}

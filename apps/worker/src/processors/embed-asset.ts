import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, schema } from "../db.js";
import { logger } from "../logger.js";
import { embedImage } from "../ml.js";
import { downloadObject } from "../s3.js";
import { deriveAndStoreVariants } from "./derive-variants.js";

export interface EmbedAssetJobData {
  assetId: string;
  eventId: string;
  key: string;
  mime: string;
}

/**
 * Pull an image from S3, send it to the ML service, persist every face we
 * find as a row in face_embeddings, and flip the asset to `ready`.
 *
 * Idempotency: rows in face_embeddings are NOT keyed by asset_id only, so a
 * retried job would duplicate them. We avoid that by deleting any existing
 * embeddings for this asset at the start of the job.
 */
export async function processEmbedAsset(data: EmbedAssetJobData): Promise<{
  assetId: string;
  faceCount: number;
  tookMs: number;
}> {
  const { assetId, eventId, key, mime } = data;
  const start = Date.now();

  await db.update(schema.assets).set({ status: "processing" }).where(eq(schema.assets.id, assetId));

  let bytes: Uint8Array;
  try {
    bytes = await downloadObject(key);
  } catch (err) {
    logger.error({ assetId, key, err }, "S3 download failed");
    await db.update(schema.assets).set({ status: "failed" }).where(eq(schema.assets.id, assetId));
    throw err;
  }

  let embedded;
  try {
    embedded = await embedImage(bytes, "asset.jpg", mime || "image/jpeg");
  } catch (err) {
    logger.error({ assetId, err }, "ML /embed failed");
    await db.update(schema.assets).set({ status: "failed" }).where(eq(schema.assets.id, assetId));
    throw err;
  }

  // Clear out any previous attempt for this asset so retries are idempotent.
  await db.delete(schema.faceEmbeddings).where(eq(schema.faceEmbeddings.assetId, assetId));

  if (embedded.faces.length > 0) {
    await db.insert(schema.faceEmbeddings).values(
      embedded.faces.map((f) => ({
        eventId,
        assetId,
        bbox: f.bbox,
        embedding: f.embedding,
        quality: f.quality,
        detScore: f.det_score,
        modelVersion: embedded.model_version,
      })),
    );
  }

  // Generate the thumb/preview derivatives from the bytes we already have in
  // memory. Non-fatal: a resize failure shouldn't fail the whole asset (the
  // gallery falls back to the original), so we log and continue.
  let dims: { width: number | null; height: number | null } = { width: null, height: null };
  try {
    dims = await deriveAndStoreVariants({ assetId, originalKey: key, bytes });
  } catch (err) {
    logger.warn({ assetId, err }, "derivative generation failed (continuing)");
  }

  await db
    .update(schema.assets)
    .set({ status: "ready", width: dims.width, height: dims.height })
    .where(eq(schema.assets.id, assetId));

  const tookMs = Date.now() - start;
  logger.info({ assetId, eventId, faceCount: embedded.faces.length, tookMs }, "asset embedded");
  return { assetId, faceCount: embedded.faces.length, tookMs };
}

/**
 * Apply the HNSW vector index if it doesn't exist yet. Idempotent.
 */
export async function ensureHnswIndex(): Promise<void> {
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS face_embeddings_hnsw
        ON face_embeddings
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);`,
  );
}

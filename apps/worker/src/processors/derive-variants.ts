import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db, schema } from "../db.js";
import { uploadObject } from "../s3.js";

/**
 * Derived image sizes. Galleries render `thumb`; the guest lightbox renders
 * `preview`; the original is only fetched for full-resolution download. Serving
 * thumbnails instead of 8 MB originals is what keeps a 2,000-photo gallery
 * usable on a phone.
 *
 * Derivatives are platform overhead — they are NOT counted against the
 * workspace's storage quota (which only bills the originals the user uploaded),
 * so nothing here touches the storage ledger.
 */
const SPECS = [
  { variant: "thumb" as const, width: 480, quality: 70 },
  { variant: "preview" as const, width: 1600, quality: 80 },
];

/**
 * Derivative object key from the original's. Originals live at
 * `w/{ws}/events/{ev}/original/{assetId}.{ext}`; a derivative swaps the
 * `/original/` segment for `/thumb/` or `/preview/` and normalizes to `.jpg`.
 */
function variantKey(originalKey: string, variant: string): string {
  return originalKey.replace("/original/", `/${variant}/`).replace(/\.[^./]+$/, ".jpg");
}

/**
 * Generate + store the thumb/preview derivatives for an asset and return the
 * original's display dimensions (accounting for EXIF orientation) so the caller
 * can persist them on the asset row. Regenerates cleanly (drops any prior
 * variant rows) so retries are idempotent.
 */
export async function deriveAndStoreVariants(opts: {
  assetId: string;
  originalKey: string;
  bytes: Uint8Array;
}): Promise<{ width: number | null; height: number | null }> {
  const input = Buffer.from(opts.bytes);

  const meta = await sharp(input).metadata();
  // Orientation 5–8 means the stored pixels are rotated 90°, so display width
  // and height are swapped relative to the raw metadata.
  const swap = typeof meta.orientation === "number" && meta.orientation >= 5;
  const width = (swap ? meta.height : meta.width) ?? null;
  const height = (swap ? meta.width : meta.height) ?? null;

  await db.delete(schema.assetVariants).where(eq(schema.assetVariants.assetId, opts.assetId));

  for (const spec of SPECS) {
    const key = variantKey(opts.originalKey, spec.variant);
    const { data, info } = await sharp(input)
      .rotate() // bake EXIF orientation into the pixels
      .resize({ width: spec.width, withoutEnlargement: true })
      .jpeg({ quality: spec.quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    await uploadObject(key, data, "image/jpeg");
    await db.insert(schema.assetVariants).values({
      assetId: opts.assetId,
      variant: spec.variant,
      key,
      width: info.width,
      bytes: info.size,
    });
  }

  return { width, height };
}

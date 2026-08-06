import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

declare global {
  var __photodostS3: S3Client | undefined;
}

export const s3 =
  globalThis.__photodostS3 ??
  new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    // True for MinIO (local), false for Backblaze B2 / virtual-hosted endpoints.
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
    // AWS SDK v3 ≥ 3.729 sends `x-amz-checksum-crc32` on every PutObject by
    // default. AWS accepts it; S3-compatible stores (B2, older MinIO) may reject
    // it outright. `WHEN_REQUIRED` keeps checksums for the operations that
    // genuinely need them and drops them everywhere else. Presigned URLs are
    // unaffected either way — they sign only `host`.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

if (env.NODE_ENV !== "production") {
  globalThis.__photodostS3 = s3;
}

export const BUCKET = env.S3_BUCKET;

/**
 * Public URL the browser can use to GET this object directly (no presign).
 * Locally: http://localhost:9000/photodost-dev/<key>
 * Prod: https://cdn.photodost.com/<key>
 */
export function publicUrlFor(key: string): string {
  return `${env.S3_PUBLIC_URL.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

/**
 * Resolve the three URLs a photo is displayed with: `thumbUrl` for grids,
 * `previewUrl` for the lightbox, and `url` (the original) for full-resolution
 * download. Falls back to the original for any derivative that doesn't exist
 * yet (e.g. a just-uploaded photo the worker hasn't processed).
 */
export function displayUrls(
  originalKey: string,
  variants?: { thumb?: string; preview?: string },
): { url: string; thumbUrl: string; previewUrl: string } {
  const url = publicUrlFor(originalKey);
  return {
    url,
    thumbUrl: variants?.thumb ? publicUrlFor(variants.thumb) : url,
    previewUrl: variants?.preview ? publicUrlFor(variants.preview) : url,
  };
}

/**
 * Presigned PUT URL the browser uses to upload directly into MinIO/R2.
 * Caller must use the same `contentType` on the PUT request or signing fails.
 */
export async function presignUpload(opts: {
  key: string;
  contentType: string;
  expiresIn?: number;
}): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: opts.key,
    ContentType: opts.contentType,
  });
  return getSignedUrl(s3, cmd, { expiresIn: opts.expiresIn ?? 300 });
}

/**
 * Presigned GET URL for private content (we don't use it yet because the dev
 * bucket is public-read, but it's here for when we lock things down).
 */
export async function presignDownload(opts: { key: string; expiresIn?: number }): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: opts.key });
  return getSignedUrl(s3, cmd, { expiresIn: opts.expiresIn ?? 3600 });
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/**
 * Real byte size of an uploaded object, straight from storage. This is the
 * authoritative number we charge against a workspace's quota — we never trust
 * the client-declared size at finalize time. Returns null if the object isn't
 * there (upload never completed).
 */
export async function headObjectSize(key: string): Promise<number | null> {
  try {
    const out = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return typeof out.ContentLength === "number" ? out.ContentLength : null;
  } catch {
    return null;
  }
}

/**
 * Path layout convention. Centralised here so we change it in one place.
 * Everything is namespaced under `w/{workspaceId}/` so storage usage and
 * cleanup are trivially attributable to a tenant (and a workspace's whole
 * prefix can be wiped on account deletion).
 */
function ext(e: string): string {
  return e.startsWith(".") ? e : `.${e}`;
}
export const keys = {
  original: (workspaceId: string, eventId: string, assetId: string, e: string) =>
    `w/${workspaceId}/events/${eventId}/original/${assetId}${ext(e)}`,
  /**
   * Flipbook album pages. Kept under the event but in their own prefix so an
   * album can be wiped without touching the event's shot coverage, and so the
   * retention purge can tell the two apart.
   */
  albumPage: (workspaceId: string, eventId: string, pageId: string, e: string) =>
    `w/${workspaceId}/events/${eventId}/album/${pageId}${ext(e)}`,
};

// Only browser-displayable formats are accepted. Browsers (other than Safari)
// can't render HEIC, so we reject those at upload time rather than silently
// accept files that show as broken tiles in the dashboard.
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
};

export function extFromMime(mime: string): string {
  return MIME_TO_EXT[mime.toLowerCase()] ?? "bin";
}

export const ALLOWED_UPLOAD_MIMES = new Set(Object.keys(MIME_TO_EXT));

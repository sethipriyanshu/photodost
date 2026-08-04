import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "./env.js";

export const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  // Configurable, not hardcoded: MinIO needs path-style, while Backblaze B2 and
  // most CDN-fronted setups want virtual-hosted. This used to be pinned `true`,
  // which quietly made the worker unusable against anything but MinIO.
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
  // AWS SDK v3 ≥ 3.729 sends `x-amz-checksum-crc32` on every PutObject by
  // default. AWS accepts it; S3-compatible stores (B2, older MinIO) may reject
  // it outright. `WHEN_REQUIRED` keeps checksums for the operations that
  // genuinely need them and drops them everywhere else.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

export async function downloadObject(key: string): Promise<Uint8Array> {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  if (!res.Body) throw new Error(`S3 object empty: ${key}`);
  const bytes = await res.Body.transformToByteArray();
  return bytes;
}

/** Upload a derived object (thumbnail/preview) back into the bucket. */
export async function uploadObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Remove an object. Used by the retention purge; a missing key is not an error
 * (the purge must be safe to re-run after a partial failure).
 */
export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

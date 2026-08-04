import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

// Load env in priority order: closest to the worker first, then monorepo root.
// Existing process.env values are NOT overwritten (so production env wins).
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [resolve(here, "../.env"), resolve(here, "../../../.env")];

for (const path of candidates) {
  if (existsSync(path)) {
    loadEnv({ path });
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  DATABASE_URL: required("DATABASE_URL"),
  REDIS_URL: required("REDIS_URL"),
  ML_SERVICE_URL: process.env.ML_SERVICE_URL ?? "http://localhost:8000",
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  S3_REGION: process.env.S3_REGION ?? "us-east-1",
  S3_BUCKET: process.env.S3_BUCKET ?? "photodost-dev",
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? "minioadmin",
  S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? "minioadmin",
  // True for MinIO (local), false for Backblaze B2 / virtual-hosted endpoints.
  S3_FORCE_PATH_STYLE: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() === "true",

  // ---- Email (retention warnings) ----
  // Same SMTP target as the web app's magic links — Mailpit locally. With no
  // SMTP_HOST reachable the retention sweep logs the failure and does not purge,
  // so nobody's photos are deleted without the warning having been attempted.
  SMTP_HOST: process.env.SMTP_HOST ?? "localhost",
  SMTP_PORT: Number(process.env.SMTP_PORT ?? "1025"),
  SMTP_SECURE: (process.env.SMTP_SECURE ?? "false").toLowerCase() === "true",
  SMTP_USER: process.env.SMTP_USER ?? "",
  SMTP_PASS: process.env.SMTP_PASS ?? "",
  EMAIL_FROM: process.env.EMAIL_FROM ?? "Photo Dost <no-reply@photodost.app>",
  APP_URL: process.env.APP_URL ?? "http://localhost:3030",

  // ---- Billing (Cashfree) ----
  // The worker needs these only to issue the deferred CANCEL that emulates
  // cancel-at-period-end. When they're absent the sweep logs and does nothing,
  // so a worker deployed without billing config is not an error.
  BILLING_ENABLED: (process.env.BILLING_ENABLED ?? "false").toLowerCase() === "true",
  CASHFREE_APP_ID: process.env.CASHFREE_APP_ID ?? "",
  CASHFREE_SECRET_KEY: process.env.CASHFREE_SECRET_KEY ?? "",
  CASHFREE_MODE: process.env.CASHFREE_MODE ?? "sandbox",
} as const;

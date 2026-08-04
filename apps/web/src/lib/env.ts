function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",

  DATABASE_URL: required("DATABASE_URL"),

  APP_URL: process.env.APP_URL ?? "http://localhost:3030",

  // ---- Auth (Better Auth) ----
  BETTER_AUTH_SECRET: required("BETTER_AUTH_SECRET"),
  // The origin Better Auth signs callbacks against. Defaults to APP_URL.
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3030",
  // Google OAuth is optional locally; magic links work without it.
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "",

  // ---- Email (magic links via Mailpit locally) ----
  SMTP_HOST: process.env.SMTP_HOST ?? "localhost",
  SMTP_PORT: Number(process.env.SMTP_PORT ?? "1025"),
  SMTP_SECURE: optionalBool("SMTP_SECURE", false),
  SMTP_USER: process.env.SMTP_USER ?? "",
  SMTP_PASS: process.env.SMTP_PASS ?? "",
  EMAIL_FROM: process.env.EMAIL_FROM ?? "Photo Dost <no-reply@photodost.app>",

  S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  S3_REGION: process.env.S3_REGION ?? "us-east-1",
  S3_BUCKET: process.env.S3_BUCKET ?? "photodost-dev",
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? "minioadmin",
  S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? "minioadmin",
  S3_FORCE_PATH_STYLE: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() === "true",
  S3_PUBLIC_URL: process.env.S3_PUBLIC_URL ?? "http://localhost:9000/photodost-dev",

  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6380",
  ML_SERVICE_URL: process.env.ML_SERVICE_URL ?? "http://localhost:8000",
  // Shared secret for the ML service. Empty locally (it runs open); required
  // in production, where the ML service refuses to boot without one.
  ML_SERVICE_TOKEN: process.env.ML_SERVICE_TOKEN ?? "",

  // ---- Billing (Cashfree Subscriptions) ----
  // While false, every workspace runs on a generous Beta plan (usage is still
  // tracked, but nothing is capped) so the whole product is testable without a
  // payment gateway. Flip true only once the Cashfree credentials below are
  // filled in — see `billingConfigError()` in lib/billing-config.ts, which
  // refuses to let the app enforce quotas it has no upgrade path for.
  BILLING_ENABLED: optionalBool("BILLING_ENABLED", false),

  // Dashboard → Developers → API Keys. The secret also signs webhooks, so
  // there is no separate webhook secret to configure.
  CASHFREE_APP_ID: process.env.CASHFREE_APP_ID ?? "",
  CASHFREE_SECRET_KEY: process.env.CASHFREE_SECRET_KEY ?? "",
  // Selects the API host: sandbox.cashfree.com/pg vs api.cashfree.com/pg.
  // Cashfree does not infer this from the key, so it must be set explicitly.
  CASHFREE_MODE: process.env.CASHFREE_MODE ?? "sandbox",
} as const;

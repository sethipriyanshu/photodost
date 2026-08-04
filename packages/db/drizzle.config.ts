import { defineConfig } from "drizzle-kit";
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// pnpm runs this from `packages/db/`, so we explicitly load the monorepo
// root `.env` (and a local `.env` if you ever drop one here for overrides).
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [resolve(here, ".env"), resolve(here, "../../.env")];

for (const path of candidates) {
  if (existsSync(path)) {
    loadEnv({ path });
  }
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required to run drizzle-kit. " +
      "Did you `cp .env.example .env` at the repo root?",
  );
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: false,
  verbose: false,
});

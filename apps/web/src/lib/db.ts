import "server-only";
import { createDbClient } from "@photodost/db/client";
import * as schema from "@photodost/db/schema";
import { env } from "./env";

declare global {
  var __photodostDb: ReturnType<typeof createDbClient> | undefined;
}

const cached = globalThis.__photodostDb ?? createDbClient(env.DATABASE_URL);

if (env.NODE_ENV !== "production") {
  globalThis.__photodostDb = cached;
}

export const db = cached.db;
export { schema };

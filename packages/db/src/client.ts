import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDbClient>["db"];

/**
 * True for connection strings that point at a transaction-pooling proxy:
 * Neon's `-pooler` endpoint, or Supabase/PgBouncer on port 6543.
 */
function isTransactionPooled(connectionString: string): boolean {
  return /-pooler\./.test(connectionString) || /:6543(\/|\?|$)/.test(connectionString);
}

export function createDbClient(connectionString: string, opts?: { max?: number }) {
  const pooled = isTransactionPooled(connectionString);

  const client = postgres(connectionString, {
    max: opts?.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // postgres.js uses prepared statements by default, and PgBouncer in
    // transaction-pooling mode does not support them — each query can land on a
    // different backend connection, so the statement it prepared isn't there.
    // Symptom is a confusing `prepared statement "s1" already exists` under load
    // rather than a clean failure at connect time, so this is detected from the
    // host instead of left to configuration.
    prepare: !pooled,
  });

  const db = drizzle(client, { schema });
  return { db, client };
}

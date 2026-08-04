import { createDbClient } from "@photodost/db/client";
import * as schema from "@photodost/db/schema";
import { env } from "./env.js";

const { db } = createDbClient(env.DATABASE_URL);

export { db, schema };

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

// Reuse one connection pool across dev hot reloads
const sql = globalForDb.sql ?? postgres(process.env.DATABASE_URL ?? "postgres://localhost/huizen", { max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

export const db = drizzle(sql, { schema });
export { schema };

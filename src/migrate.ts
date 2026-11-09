import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "@/db";

await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

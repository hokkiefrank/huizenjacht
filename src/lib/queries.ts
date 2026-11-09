import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { HouseStatus } from "@/db/schema";

export async function listUsers() {
  return db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).orderBy(asc(schema.users.id));
}

export async function listHouses(status?: HouseStatus | "actief") {
  const where =
    status === "actief"
      ? sql`${schema.houses.status} <> 'afgevallen'`
      : status
        ? eq(schema.houses.status, status)
        : undefined;

  const houses = await db.select().from(schema.houses).where(where).orderBy(desc(schema.houses.createdAt));
  const ratings = await db.select().from(schema.ratings);
  const counts = await db
    .select({ houseId: schema.comments.houseId, n: sql<number>`count(*)::int` })
    .from(schema.comments)
    .groupBy(schema.comments.houseId);

  return houses.map((h) => ({
    ...h,
    ratings: Object.fromEntries(ratings.filter((r) => r.houseId === h.id).map((r) => [r.userId, r.value])) as Record<
      number,
      number
    >,
    commentCount: counts.find((c) => c.houseId === h.id)?.n ?? 0,
  }));
}

export async function getHouse(id: number) {
  const [house] = await db.select().from(schema.houses).where(eq(schema.houses.id, id));
  if (!house) return null;
  const ratings = await db.select().from(schema.ratings).where(eq(schema.ratings.houseId, id));
  const floorplans = await db
    .select()
    .from(schema.floorplans)
    .where(eq(schema.floorplans.houseId, id))
    .orderBy(asc(schema.floorplans.position));
  const comments = await db
    .select({
      id: schema.comments.id,
      kind: schema.comments.kind,
      body: schema.comments.body,
      createdAt: schema.comments.createdAt,
      userId: schema.comments.userId,
      userName: schema.users.name,
      floorplanId: schema.comments.floorplanId,
    })
    .from(schema.comments)
    .innerJoin(schema.users, eq(schema.users.id, schema.comments.userId))
    .where(eq(schema.comments.houseId, id))
    .orderBy(asc(schema.comments.createdAt));
  return {
    ...house,
    ratings: Object.fromEntries(ratings.map((r) => [r.userId, r.value])) as Record<number, number>,
    comments,
    floorplans,
  };
}

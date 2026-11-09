import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { fetchFloors, houseFieldsFromListing, type FundaListing } from "@/lib/funda";

/**
 * Store everything we got from Funda on a house: the listing itself, photos, and floor plans.
 * With `overwrite`, Funda's facts replace what's there (e.g. a lowered price); otherwise they only fill gaps.
 */
export async function saveFundaDetails(houseId: number, listing: FundaListing, { overwrite = false } = {}) {
  const [house] = await db.select().from(schema.houses).where(eq(schema.houses.id, houseId));
  if (!house) return;

  const fields = houseFieldsFromListing(listing);
  const updates: Partial<typeof schema.houses.$inferInsert> = {
    listing,
    photos: listing.photos,
    updatedAt: new Date(),
  };
  for (const [key, value] of Object.entries(fields) as [keyof typeof fields, string | number | undefined][]) {
    if (value === undefined) continue;
    if (overwrite || house[key] == null || house[key] === "") Object.assign(updates, { [key]: value });
  }
  await db.update(schema.houses).set(updates).where(eq(schema.houses.id, houseId));

  // Floor plans don't change once a listing is online; keep existing ones so comments stay attached
  const [existing] = await db
    .select({ id: schema.floorplans.id })
    .from(schema.floorplans)
    .where(eq(schema.floorplans.houseId, houseId))
    .limit(1);
  if (!existing && listing.floorplans.length > 0) {
    const floors = await fetchFloors(listing);
    if (floors.length > 0) {
      await db.insert(schema.floorplans).values(
        floors.map((f, position) => ({ houseId, name: f.name, position, rooms: f.rooms, svg: f.svg })),
      );
    }
  }

  await queueLayoutRun(houseId);
}

/** Let the Claude Code agent describe the floor plans (agent/worker.mjs), once per house. */
async function queueLayoutRun(houseId: number) {
  const [house] = await db.select({ layout: schema.houses.layout }).from(schema.houses).where(eq(schema.houses.id, houseId));
  const [floor] = await db.select({ id: schema.floorplans.id }).from(schema.floorplans).where(eq(schema.floorplans.houseId, houseId)).limit(1);
  if (!house || house.layout || !floor) return;
  const [pending] = await db
    .select({ id: schema.agentRuns.id })
    .from(schema.agentRuns)
    .where(
      and(
        eq(schema.agentRuns.kind, "layout"),
        eq(schema.agentRuns.houseId, houseId),
        inArray(schema.agentRuns.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  if (!pending) await db.insert(schema.agentRuns).values({ kind: "layout", houseId });
}

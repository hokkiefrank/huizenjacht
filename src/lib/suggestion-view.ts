import "server-only";
import { db, schema } from "@/db";
import type { SearchZone } from "@/db/schema";
import { effectiveScore, zoneOf, type ZonePlace } from "@/lib/zones";

type Suggestion = typeof schema.suggestions.$inferSelect;
export type ViewedSuggestion = Suggestion & { place: ZonePlace | null; shownScore: number | null; lowered: string[] };

export function loadZones() {
  return db.select().from(schema.searchZones).orderBy(schema.searchZones.id);
}

/** Adds where the house lies on our map and the score we show (Claude's, lowered only for sure things). */
export function viewSuggestion(s: Suggestion, zones: SearchZone[]): ViewedSuggestion {
  const place = zoneOf(s.lat, s.lng, zones);
  if (s.score == null) return { ...s, place, shownScore: null, lowered: [] };
  const { score, lowered } = effectiveScore(s.score, place, s.checks);
  return { ...s, place, shownScore: score, lowered };
}

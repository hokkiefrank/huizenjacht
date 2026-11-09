import type { ProfileCheck } from "@/db/schema";

// Kept free of imports with runtime code: agent/worker.mjs has a copy of zoneOf (keep them the same)

export type ZoneLike = { name: string; kind: "zoeken" | "niet"; polygon: [number, number][] };

/** Houses up to this far outside a search zone still count as "just outside": no penalty, only a label. */
export const NEAR_METERS = 2000;

export type ZonePlace =
  | { kind: "binnen"; zone: string }
  | { kind: "rand"; zone: string; meters: number }
  | { kind: "buiten"; meters: number }
  | { kind: "uitgesloten"; zone: string };

// Flat-earth metres around the point: fine at the scale of a few kilometres
function toMeters(lat0: number, [lat, lng]: [number, number]) {
  return { x: (lng * Math.PI * 6371000 * Math.cos((lat0 * Math.PI) / 180)) / 180, y: (lat * Math.PI * 6371000) / 180 };
}

function inside(polygon: [number, number][], lat: number, lng: number) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ay, ax] = polygon[i];
    const [by, bx] = polygon[j];
    if (ay > lat !== by > lat && lng < ((bx - ax) * (lat - ay)) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}

function distanceToEdge(polygon: [number, number][], lat: number, lng: number) {
  const p = toMeters(lat, [lat, lng]);
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = toMeters(lat, polygon[j]);
    const b = toMeters(lat, polygon[i]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** Where a house lies relative to our zones; null when we don't know where it is or haven't drawn anything. */
export function zoneOf(lat: number | null, lng: number | null, zones: ZoneLike[]): ZonePlace | null {
  if (lat == null || lng == null || zones.length === 0) return null;
  const excluded = zones.find((z) => z.kind === "niet" && inside(z.polygon, lat, lng));
  if (excluded) return { kind: "uitgesloten", zone: excluded.name };
  const search = zones.filter((z) => z.kind === "zoeken");
  if (search.length === 0) return null;
  const within = search.find((z) => inside(z.polygon, lat, lng));
  if (within) return { kind: "binnen", zone: within.name };
  const nearest = search
    .map((z) => ({ zone: z.name, meters: Math.round(distanceToEdge(z.polygon, lat, lng)) }))
    .sort((a, b) => a.meters - b.meters)[0];
  return nearest.meters <= NEAR_METERS ? { kind: "rand", ...nearest } : { kind: "buiten", meters: nearest.meters };
}

export function describeZone(place: ZonePlace) {
  const km = (m: number) => `${(m / 1000).toFixed(1).replace(".", ",")} km`;
  switch (place.kind) {
    case "binnen":
      return `In ${place.zone}`;
    case "rand":
      return `${km(place.meters)} buiten ${place.zone}`;
    case "buiten":
      return `${km(place.meters)} buiten jullie gebieden`;
    case "uitgesloten":
      return `In ${place.zone} (niet gewenst)`;
  }
}

/**
 * The score we show and sort by: Claude's, lowered only for things we know for sure. Unknown never counts
 * against a house, so a gem with a vague listing isn't buried.
 */
export function effectiveScore(score: number, place: ZonePlace | null, checks: ProfileCheck[] | null) {
  const reasons: string[] = [];
  let cap = 10;
  if (place?.kind === "uitgesloten") {
    cap = 3;
    reasons.push(`ligt in ${place.zone}`);
  } else if (place?.kind === "buiten") {
    cap = 5;
    reasons.push("ligt buiten jullie gebieden");
  }
  const failed = (checks ?? []).filter((c) => c.past === "nee" && c.zeker);
  if (failed.length > 0) {
    cap = Math.min(cap, failed.length > 1 ? 4 : 5);
    reasons.push(...failed.map((c) => c.toelichting || c.eis));
  }
  return { score: Math.min(score, cap), lowered: score > cap ? reasons : [] };
}

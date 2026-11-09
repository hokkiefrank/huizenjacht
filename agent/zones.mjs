// Copy of zoneOf/describeZone in src/lib/zones.ts (the agent image is built from this folder only): keep them the same.

export const NEAR_METERS = 2000;

function toMeters(lat0, [lat, lng]) {
  return { x: (lng * Math.PI * 6371000 * Math.cos((lat0 * Math.PI) / 180)) / 180, y: (lat * Math.PI * 6371000) / 180 };
}

function inside(polygon, lat, lng) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ay, ax] = polygon[i];
    const [by, bx] = polygon[j];
    if (ay > lat !== by > lat && lng < ((bx - ax) * (lat - ay)) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}

function distanceToEdge(polygon, lat, lng) {
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

export function zoneOf(lat, lng, zones) {
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

export function describeZone(place) {
  const km = (m) => `${(m / 1000).toFixed(1).replace(".", ",")} km`;
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

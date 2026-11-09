import "server-only";
import type { FloorplanRoom } from "@/db/schema";

// The subset of Floorplanner's project JSON (fmlpub.s3…/<projectId>.fml) that we use.
// Coordinates are in centimetres, y pointing down.
type Point = { x: number; y: number };
type Area = { name?: string; poly: Point[] };
type Wall = { a: Point; b: Point; thickness?: number; openings?: { t: number; width: number; type: string }[] };
type Label = { x: number; y: number; text?: string };
type Design = { id: number; areas?: Area[]; walls?: Wall[]; labels?: Label[]; items?: unknown[] };
export type FmlProject = { floors: { name: string; level: number; designs: Design[] }[] };

export type Floor = { name: string; designId: string; rooms: FloorplanRoom[]; svg: string };

function polygonArea(poly: Point[]) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2 / 10_000; // cm² → m²
}

function centroid(poly: Point[]): Point {
  // Area-weighted centroid, so labels land inside L-shaped rooms more often than the vertex average would
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-6) return poly[0];
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

const isNamed = (name: string | undefined): name is string => !!name && name.trim() !== "" && name !== "?";

function contains(poly: Point[], p: Point) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Some agents leave the rooms unnamed and put the names on the drawing as loose text labels
 * ("Woonkamer\nH=2.63m"). Give each unnamed room the label inside it, the smallest room when they overlap.
 */
function withLabelNames(design: Design): Design {
  const areas = (design.areas ?? []).filter((a) => a.poly?.length >= 3);
  const labels = (design.labels ?? [])
    .map((l) => ({ ...l, name: (l.text ?? "").split("\n")[0].trim() }))
    .filter((l) => /\p{L}{2}/u.test(l.name));
  if (labels.length === 0 || areas.every((a) => isNamed(a.name))) return design;
  const names = new Map<Area, string[]>();
  for (const l of labels) {
    const room = areas
      .filter((a) => !isNamed(a.name) && contains(a.poly, l))
      .sort((a, b) => polygonArea(a.poly) - polygonArea(b.poly))[0];
    if (!room) continue;
    const list = names.get(room) ?? [];
    if (!list.some((n) => n.toLowerCase() === l.name.toLowerCase())) list.push(l.name);
    names.set(room, list);
  }
  // An open-plan room often carries two labels ("Woonkamer", "Keuken"): show both, living room first
  const name = (list: string[]) =>
    list
      .sort((a, b) => Number(/woon/i.test(b)) - Number(/woon/i.test(a)))
      .map((n, i) => (i === 0 ? n : n.toLowerCase()))
      .join(", ")
      .replace(/, ([^,]*)$/, " en $1");
  return { ...design, areas: (design.areas ?? []).map((a) => (names.has(a) ? { ...a, name: name(names.get(a)!) } : a)) };
}

function roomColor(name: string) {
  const n = name.toLowerCase();
  if (/woon|zit|eet|keuken/.test(n)) return "#efdcc8";
  if (/slaap/.test(n)) return "#dbeafe";
  if (/bad|toilet|wc|douche/.test(n)) return "#d1fae5";
  if (/hal|overloop|gang|entree/.test(n)) return "#f4eee8";
  if (/garage|berging|schuur|zolder|bijkeuken|wasruimte|kast/.test(n)) return "#e4dbd2";
  return "#fbf8f5";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = (n: number) => Math.round(n * 10) / 10;

function renderSvg(design: Design) {
  const areas = (design.areas ?? []).filter((a) => a.poly?.length >= 3);
  const walls = design.walls ?? [];
  const points = [...walls.flatMap((w) => [w.a, w.b]), ...areas.flatMap((a) => a.poly)];
  if (points.length === 0) return null;
  const pad = 60;
  const minX = Math.min(...points.map((p) => p.x)) - pad;
  const minY = Math.min(...points.map((p) => p.y)) - pad;
  const width = Math.max(...points.map((p) => p.x)) + pad - minX;
  const height = Math.max(...points.map((p) => p.y)) + pad - minY;
  const font = Math.max(width, height) / 45;

  const parts: string[] = [];
  for (const a of areas) {
    const fill = isNamed(a.name) ? roomColor(a.name) : "#fbf8f5";
    parts.push(`<polygon points="${a.poly.map((p) => `${r1(p.x)},${r1(p.y)}`).join(" ")}" fill="${fill}"/>`);
  }
  for (const w of walls) {
    const t = Math.max(w.thickness ?? 10, 8);
    parts.push(`<line x1="${r1(w.a.x)}" y1="${r1(w.a.y)}" x2="${r1(w.b.x)}" y2="${r1(w.b.y)}" stroke="#44403c" stroke-width="${t}"/>`);
    // Doors as gaps in the wall, windows as a thin blue line
    const dx = w.b.x - w.a.x;
    const dy = w.b.y - w.a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    for (const o of w.openings ?? []) {
      const half = Math.min(o.width, len) / 2 / len;
      const s = Math.max(0, o.t - half);
      const e = Math.min(1, o.t + half);
      const x1 = r1(w.a.x + dx * s);
      const y1 = r1(w.a.y + dy * s);
      const x2 = r1(w.a.x + dx * e);
      const y2 = r1(w.a.y + dy * e);
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffffff" stroke-width="${t + 2}"/>`);
      if (o.type === "window") {
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#60a5fa" stroke-width="${Math.max(t / 4, 4)}"/>`);
      }
    }
  }
  for (const a of areas) {
    if (!isNamed(a.name)) continue;
    const area = polygonArea(a.poly);
    if (area < 1 || (/kast/i.test(a.name) && area < 2)) continue; // too small to label legibly
    const c = centroid(a.poly);
    parts.push(
      `<text x="${r1(c.x)}" y="${r1(c.y)}" text-anchor="middle" font-size="${r1(font)}" fill="#1c1917">` +
        `<tspan x="${r1(c.x)}" font-weight="600">${esc(a.name)}</tspan>` +
        `<tspan x="${r1(c.x)}" dy="${r1(font * 1.2)}" fill="#57534e">${area.toFixed(1).replace(".", ",")} m²</tspan></text>`,
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r1(minX)} ${r1(minY)} ${r1(width)} ${r1(height)}" ` +
    `font-family="Arial, Helvetica, sans-serif"><rect x="${r1(minX)}" y="${r1(minY)}" width="${r1(width)}" height="${r1(height)}" fill="#ffffff"/>` +
    parts.join("") +
    "</svg>"
  );
}

/**
 * Turn a Floorplanner project into one entry per floor that Funda shows.
 * Agents often publish the same floor twice (with and without the garden); those are merged.
 */
export function floorsFromProject(project: FmlProject, wanted: { name: string | null; designId: string | null }[]) {
  const floors: Floor[] = [];
  const seen = new Set<string>();
  for (const w of wanted) {
    const design = project.floors.flatMap((f) => f.designs.map((d) => ({ f, d }))).find(({ d }) => String(d.id) === w.designId);
    if (!design) continue;
    design.d = withLabelNames(design.d);
    const rooms = (design.d.areas ?? [])
      .filter((a) => isNamed(a.name) && a.poly?.length >= 3)
      .map((a) => ({ name: a.name!.trim(), area: r1(polygonArea(a.poly)) }))
      .filter((r) => r.area >= 0.5);
    const signature = rooms.map((r) => `${r.name}:${r.area}`).sort().join("|");
    if (signature && seen.has(signature)) continue;
    seen.add(signature);
    const svg = renderSvg(design.d);
    if (!svg) continue;
    floors.push({ name: w.name ?? design.f.name, designId: String(design.d.id), rooms, svg });
  }
  return floors;
}

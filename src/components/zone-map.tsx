"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState, useTransition } from "react";
import { createZone, deleteZone } from "@/app/actions";

export type MapZone = { id: number; name: string; kind: "zoeken" | "niet"; polygon: [number, number][] };
export type MapPoint = {
  lat: number;
  lng: number;
  title: string;
  subtitle: string;
  href: string;
  external: boolean;
  // null for a house on our board
  score: number | null;
};

// The middle of the Netherlands, until there's something to zoom to
const START: [number, number] = [52.15, 5.3];
const COLORS = { zoeken: "#5c3a24", niet: "#b91c1c", draft: "#2563eb" };

function pointColor(score: number | null) {
  if (score == null) return "#1c1917";
  if (score >= 6) return "#5c3a24";
  if (score >= 4) return "#a8917f";
  return "#d3c2b3";
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function ZoneMap({ zones, points }: { zones: MapZone[]; points: MapPoint[] }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const layers = useRef<Leaflet.LayerGroup | null>(null);
  const draftLayer = useRef<Leaflet.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"zoeken" | "niet">("zoeken");
  const [error, setError] = useState<string | null>(null);
  const [showWeak, setShowWeak] = useState(false);
  const [pending, startTransition] = useTransition();
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;

  // Leaflet touches window, so load it in the browser only
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled || !container.current || map.current) return;
      const leaflet = (mod.default ?? mod) as typeof Leaflet;
      L.current = leaflet;
      const m = leaflet.map(container.current, { zoomControl: true }).setView(START, 8);
      // PDOK's base map (Kadaster), free to use
      leaflet
        .tileLayer("https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: 'Kaart: <a href="https://www.pdok.nl" target="_blank" rel="noreferrer">PDOK / Kadaster</a>',
        })
        .addTo(m);
      layers.current = leaflet.layerGroup().addTo(m);
      draftLayer.current = leaflet.layerGroup().addTo(m);
      m.on("click", (e: Leaflet.LeafletMouseEvent) => {
        if (drawingRef.current) setDraft((d) => [...d, [e.latlng.lat, e.latlng.lng]]);
      });
      map.current = m;
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Zones and houses
  useEffect(() => {
    const leaflet = L.current;
    const m = map.current;
    if (!ready || !leaflet || !m || !layers.current) return;
    layers.current.clearLayers();
    for (const z of zones) {
      leaflet
        .polygon(z.polygon, {
          color: COLORS[z.kind],
          weight: 2,
          fillOpacity: z.kind === "niet" ? 0.2 : 0.08,
          dashArray: z.kind === "niet" ? "6 6" : undefined,
          interactive: !drawing,
        })
        .bindTooltip(esc(z.name))
        .addTo(layers.current);
    }
    const shown = points.filter((p) => p.score == null || showWeak || p.score >= 6);
    for (const p of shown) {
      const marker = leaflet.circleMarker([p.lat, p.lng], {
        radius: p.score == null ? 8 : 6,
        color: "#ffffff",
        weight: 1.5,
        fillColor: pointColor(p.score),
        fillOpacity: 0.95,
        interactive: !drawing,
      });
      const target = p.external ? ' target="_blank" rel="noreferrer"' : "";
      marker.bindPopup(
        `<strong>${esc(p.title)}</strong><br>${esc(p.subtitle)}<br><a href="${esc(p.href)}"${target}>${p.external ? "Advertentie ↗" : "Bekijk"}</a>`,
      );
      marker.addTo(layers.current);
    }
  }, [ready, zones, points, showWeak, drawing]);

  // Zoom to what we have, once
  const fitted = useRef(false);
  useEffect(() => {
    const leaflet = L.current;
    if (!ready || !leaflet || !map.current || fitted.current) return;
    const corners = [...zones.flatMap((z) => z.polygon), ...points.filter((p) => p.score == null || p.score >= 6).map((p) => [p.lat, p.lng] as [number, number])];
    if (corners.length > 1) map.current.fitBounds(leaflet.latLngBounds(corners), { padding: [20, 20], maxZoom: 14 });
    fitted.current = true;
  }, [ready, zones, points]);

  // The area being drawn
  useEffect(() => {
    const leaflet = L.current;
    if (!ready || !leaflet || !draftLayer.current) return;
    draftLayer.current.clearLayers();
    if (draft.length === 0) return;
    const style = { color: COLORS[kind === "niet" ? "niet" : "draft"], weight: 2 };
    (draft.length >= 3 ? leaflet.polygon(draft, { ...style, fillOpacity: 0.1 }) : leaflet.polyline(draft, style)).addTo(draftLayer.current);
    for (const corner of draft) leaflet.circleMarker(corner, { radius: 4, ...style, fillOpacity: 1 }).addTo(draftLayer.current);
  }, [ready, draft, kind]);

  function stopDrawing() {
    setDrawing(false);
    setDraft([]);
    setName("");
    setError(null);
  }

  function save() {
    startTransition(async () => {
      const result = await createZone({ name, kind, polygon: draft });
      if (result?.error) setError(result.error);
      else stopDrawing();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Leaflet adds its own classes to the map element, so React must never rewrite its className */}
      <div className={drawing ? "[&_.leaflet-container]:cursor-crosshair" : ""}>
        <div ref={container} className="z-0 h-[60vh] min-h-80 w-full overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-800" />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-full" style={{ background: pointColor(null) }} /> op jullie bord
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-full" style={{ background: pointColor(7) }} /> suggestie 6+
        </span>
        {showWeak && (
          <span className="flex items-center gap-1">
            <span className="inline-block size-3 rounded-full" style={{ background: pointColor(4) }} /> 4-5
            <span className="ml-1 inline-block size-3 rounded-full" style={{ background: pointColor(1) }} /> lager
          </span>
        )}
        <label className="flex items-center gap-1.5 text-xs font-normal">
          <input type="checkbox" className="size-3.5 p-0" checked={showWeak} onChange={(e) => setShowWeak(e.target.checked)} />
          ook lage scores tonen
        </label>
      </div>

      {drawing ? (
        <section className="card flex flex-col gap-3 p-5">
          <p className="text-sm">
            Klik op de kaart om de hoeken van het gebied te zetten ({draft.length} {draft.length === 1 ? "punt" : "punten"}).
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2 font-normal">
              <input type="radio" className="p-0" checked={kind === "zoeken"} onChange={() => setKind("zoeken")} /> Hier zoeken we
            </label>
            <label className="flex items-center gap-2 font-normal">
              <input type="radio" className="p-0" checked={kind === "niet"} onChange={() => setKind("niet")} /> Hier willen we niet wonen
            </label>
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Naam, bv. Utrecht-Oost binnen de ring" />
          <div className="flex flex-wrap gap-2">
            <button className="btn py-1.5 text-sm" disabled={pending || draft.length < 3} onClick={save}>
              Gebied opslaan
            </button>
            <button className="btn-ghost py-1.5 text-sm" disabled={draft.length === 0} onClick={() => setDraft((d) => d.slice(0, -1))}>
              Laatste punt weg
            </button>
            <button className="px-2 text-sm text-stone-500" onClick={stopDrawing}>
              Annuleren
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </section>
      ) : (
        <button className="btn self-start" onClick={() => setDrawing(true)}>
          Gebied tekenen
        </button>
      )}

      {zones.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {zones.map((z) => (
            <li key={z.id} className="flex items-center justify-between gap-3 rounded-lg bg-stone-100 px-3 py-2 dark:bg-stone-800">
              <span>
                <span className="mr-2 inline-block size-3 rounded-sm align-middle" style={{ background: COLORS[z.kind] }} />
                {z.name}
                <span className="text-stone-500"> · {z.kind === "zoeken" ? "zoeken" : "niet gewenst"}</span>
              </span>
              <button
                className="shrink-0 text-xs text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                disabled={pending}
                onClick={() => startTransition(() => deleteZone(z.id))}
              >
                verwijderen
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

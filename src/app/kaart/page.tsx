import { and, eq, isNotNull } from "drizzle-orm";
import { ZoneMap, type MapPoint } from "@/components/zone-map";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatPrice } from "@/lib/format";
import { loadZones, viewSuggestion } from "@/lib/suggestion-view";
import { describeZone, NEAR_METERS } from "@/lib/zones";

export const metadata = { title: "Kaart" };

export default async function MapPage() {
  await requireUser();
  const zones = await loadZones();
  const suggestions = (
    await db
      .select()
      .from(schema.suggestions)
      .where(and(eq(schema.suggestions.status, "nieuw"), isNotNull(schema.suggestions.score), isNotNull(schema.suggestions.lat)))
  ).map((s) => viewSuggestion(s, zones));
  const houses = await db.select().from(schema.houses);

  const points: MapPoint[] = [
    ...houses.flatMap((h) =>
      h.listing?.latitude && h.listing?.longitude
        ? [
            {
              lat: h.listing.latitude,
              lng: h.listing.longitude,
              title: h.address,
              subtitle: [h.city, formatPrice(h.price)].filter(Boolean).join(" · "),
              href: `/huis/${h.id}`,
              external: false,
              score: null,
            },
          ]
        : [],
    ),
    ...suggestions.map((s) => ({
      lat: s.lat!,
      lng: s.lng!,
      title: `${s.address} · ${s.shownScore}/10`,
      subtitle: [s.city, formatPrice(s.price), s.place && describeZone(s.place)].filter(Boolean).join(" · "),
      href: s.url,
      external: true,
      score: s.shownScore,
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold">Kaart</h1>
        <p className="text-sm text-stone-500">
          Teken waar jullie zoeken en waar jullie niet willen wonen. Huizen tot {NEAR_METERS / 1000} km buiten een zoekgebied
          tellen gewoon mee (met een labeltje), zodat jullie geen pareltje missen. Verder weg gaat de score naar hooguit 5, in
          een &ldquo;niet&rdquo;-gebied naar hooguit 3.
        </p>
      </div>
      <ZoneMap zones={zones.map(({ id, name, kind, polygon }) => ({ id, name, kind, polygon }))} points={points} />
    </div>
  );
}

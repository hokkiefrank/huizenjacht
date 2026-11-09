import Link from "next/link";
import { notFound } from "next/navigation";
import { FloorplanTabs } from "@/components/floorplan-tabs";
import {
  Comments,
  DeleteHouseButton,
  RatingButtons,
  RefreshFundaButton,
  StatusSelect,
} from "@/components/house-controls";
import { requireUser } from "@/lib/auth";
import { formatPrice, RATING_EMOJI } from "@/lib/format";
import { getHouse, listUsers } from "@/lib/queries";

export default async function HousePage({ params }: PageProps<"/huis/[id]">) {
  const user = await requireUser();
  const id = Number((await params).id);
  const [house, users] = await Promise.all([Number.isInteger(id) ? getHouse(id) : null, listUsers()]);
  if (!house) notFound();

  const listing = house.listing;
  const facts = [
    ["Vraagprijs", listing?.priceFormatted ?? formatPrice(house.price)],
    ["Woonoppervlak", house.livingArea && `${house.livingArea} m²`],
    ["Perceel", house.plotArea && `${house.plotArea} m²`],
    ["Slaapkamers", house.bedrooms],
    ["Kamers", listing?.rooms],
    ["Bouwjaar", house.yearBuilt],
    ["Energielabel", house.energyLabel],
    ["Type", listing?.houseType],
    ["Badkamers", listing?.bathrooms],
    ["Woonlagen", listing?.floors],
    ["Buurt", listing?.neighbourhood],
    ["Status op Funda", listing?.status],
  ].filter(([, v]) => v != null && v !== "");
  const partner = users.find((u) => u.id !== user.id);
  const isFunda = new URL(house.url).hostname.endsWith("funda.nl");
  const floorplanName = (fid: number | null) => house.floorplans.find((f) => f.id === fid)?.name ?? null;
  const photos = house.photos.length > 0 ? house.photos : house.imageUrl ? [house.imageUrl] : [];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/" className="text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
        ← Terug naar overzicht
      </Link>

      <div className="card overflow-hidden">
        {photos.length > 0 && (
          <div className="flex snap-x snap-mandatory overflow-x-auto">
            {photos.map((src, i) => (
              <a key={src} href={src} target="_blank" rel="noreferrer" className="w-full shrink-0 snap-start sm:w-1/2">
                <img
                  src={src}
                  alt={`Foto ${i + 1}`}
                  className="aspect-[3/2] w-full object-cover"
                  loading={i < 2 ? "eager" : "lazy"}
                />
              </a>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold leading-tight">{house.address}</h1>
              {(house.city || listing?.postcode) && (
                <p className="text-stone-500">{[listing?.postcode, house.city].filter(Boolean).join(" ")}</p>
              )}
              {photos.length > 1 && <p className="text-xs text-stone-400">{photos.length} foto&apos;s · veeg opzij</p>}
            </div>
            <StatusSelect houseId={house.id} value={house.status} />
          </div>

          {facts.length > 0 && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {facts.map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-xs text-stone-500">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {house.description && <p className="whitespace-pre-wrap text-stone-700 dark:text-stone-300">{house.description}</p>}
          {listing?.description && (
            <details className="text-sm text-stone-700 dark:text-stone-300">
              <summary className="cursor-pointer font-medium">Omschrijving van de makelaar</summary>
              <p className="mt-2 whitespace-pre-wrap">{listing.description}</p>
            </details>
          )}

          <div className="flex flex-wrap items-start gap-3 text-sm">
            <a href={house.url} target="_blank" rel="noreferrer" className="btn-ghost py-1.5">
              Bekijk op {isFunda ? "Funda" : house.source} ↗
            </a>
            <Link href={`/huis/${house.id}/bewerken`} className="btn-ghost py-1.5">
              Gegevens bewerken
            </Link>
            {isFunda && <RefreshFundaButton houseId={house.id} hasData={!!listing} />}
          </div>
        </div>
      </div>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="font-semibold">Wat vind jij?</h2>
        <RatingButtons houseId={house.id} value={house.ratings[user.id]} />
        {partner && (
          <p className="text-sm text-stone-500">
            {partner.name}:{" "}
            {house.ratings[partner.id] === undefined ? "nog niet beoordeeld" : RATING_EMOJI[house.ratings[partner.id]]}
          </p>
        )}
      </section>

      {house.floorplans.length > 0 && (
        <section className="card flex flex-col gap-4 p-5">
          <div>
            <h2 className="font-semibold">Indeling</h2>
            {house.layout ? (
              <>
                <p className="mt-1 text-stone-700 dark:text-stone-300">{house.layout.samenvatting}</p>
                {house.layout.opvallend.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-sm text-stone-600 dark:text-stone-400">
                    {house.layout.opvallend.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-stone-500">
                Claude beschrijft de indeling; dat duurt een paar minuten. Ververs de pagina straks.
              </p>
            )}
          </div>
          <FloorplanTabs
            houseId={house.id}
            userId={user.id}
            comments={house.comments}
            floors={house.floorplans.map((f, i) => {
              const floors = house.layout?.verdiepingen;
              const description = (floors?.find((v) => v.naam === f.name) ?? floors?.[i])?.beschrijving;
              return { id: f.id, name: f.name, svg: f.svg, description };
            })}
          />
        </section>
      )}

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="font-semibold">Plus- en minpunten</h2>
        <Comments
          houseId={house.id}
          comments={house.comments.map((c) => ({ ...c, floorplanName: floorplanName(c.floorplanId) }))}
          userId={user.id}
        />
      </section>

      <div className="flex justify-end">
        <DeleteHouseButton houseId={house.id} />
      </div>
    </div>
  );
}

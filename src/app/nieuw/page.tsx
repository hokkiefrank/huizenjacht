import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { addHouse } from "@/app/actions";
import { HouseForm } from "@/components/house-form";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { extractUrl, lookupListing, normalizeUrl } from "@/lib/listing";

/** Also the PWA share target: the phone's share sheet sends ?url=, ?text= and ?title=. */
export default async function NewHousePage({ searchParams }: PageProps<"/nieuw">) {
  await requireUser();
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const raw = extractUrl(first(params.url)) ?? extractUrl(first(params.text)) ?? extractUrl(first(params.title));

  if (!raw) {
    return (
      <div className="card mx-auto max-w-xl p-6">
        <h1 className="mb-1 text-xl font-semibold">Huis toevoegen</h1>
        <p className="mb-4 text-sm text-stone-500">Plak de link van Funda of een andere woningsite.</p>
        <form className="flex flex-col gap-3 sm:flex-row">
          <input
            name="url"
            type="url"
            required
            autoFocus
            placeholder="https://www.funda.nl/detail/koop/…"
            className="flex-1"
          />
          <button className="btn">Verder</button>
        </form>
        {params.url !== undefined && <p className="mt-3 text-sm text-red-600">Daar staat geen geldige link in.</p>}
      </div>
    );
  }

  let url: string;
  try {
    url = normalizeUrl(raw);
  } catch {
    redirect("/nieuw?url=");
  }
  const [existing] = await db.select({ id: schema.houses.id }).from(schema.houses).where(eq(schema.houses.url, url));
  if (existing) redirect(`/huis/${existing.id}`);

  const info = await lookupListing(url);
  return (
    <div className="card mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-xl font-semibold">Huis toevoegen</h1>
      <p className="mb-5 truncate text-sm text-stone-500">
        <Link href={url} target="_blank" className="underline">
          {url}
        </Link>
      </p>
      {info.funda && (
        <div className="mb-5 flex items-center gap-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {info.imageUrl && <img src={info.imageUrl} alt="" className="h-14 w-20 shrink-0 rounded object-cover" />}
          <span>
            Gegevens opgehaald van Funda. {info.funda.photos.length} foto&apos;s
            {info.funda.floorplans.length > 0 && ` en ${info.funda.floorplans.length} plattegronden`} worden meegenomen.
          </span>
        </div>
      )}
      {info.fundaError && (
        <p className="mb-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {info.fundaError} Vul de gegevens zelf in, of probeer het later opnieuw met &ldquo;Gegevens ophalen van Funda&rdquo; op
          de pagina van het huis.
        </p>
      )}
      <HouseForm action={addHouse} defaults={info} submitLabel="Toevoegen" />
    </div>
  );
}

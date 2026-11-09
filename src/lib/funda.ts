import "server-only";
import { floorsFromProject, type Floor, type FmlProject } from "@/lib/floorplan";

// Shape returned by funda-service/server.py
export type FundaListing = {
  url: string;
  address: string | null;
  postcode: string | null;
  city: string | null;
  neighbourhood: string | null;
  price: number | null;
  priceFormatted: string | null;
  livingArea: number | null;
  plotArea: number | null;
  volume: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: string | null;
  floors: string | null;
  yearBuilt: number | null;
  energyLabel: string | null;
  houseType: string | null;
  status: string | null;
  highlight: string | null;
  description: string | null;
  publicationDate: string | null;
  latitude: number | null;
  longitude: number | null;
  photos: string[];
  floorplans: { name: string | null; projectId: string | null; designId: string | null }[];
};

const SERVICE_URL = process.env.FUNDA_SERVICE_URL ?? "http://funda:8000";

export class FundaError extends Error {}

// The add form fetches a listing and saving it needs it again a minute later: don't ask Funda twice
const cache = new Map<string, { at: number; listing: FundaListing }>();
const CACHE_MS = 30 * 60 * 1000;

/** Fetch a listing through our internal pyfunda service. Throws FundaError when that isn't possible. */
export async function fetchFundaListing(url: string): Promise<FundaListing> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.listing;
  const listing = await requestListing(url);
  cache.set(url, { at: Date.now(), listing });
  return listing;
}

async function requestListing(url: string): Promise<FundaListing> {
  let res: Response;
  try {
    res = await fetch(`${SERVICE_URL}/listing?id=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new FundaError("De Funda-koppeling is niet bereikbaar.");
  }
  if (res.status === 404) throw new FundaError("Funda kent deze woning niet (meer).");
  if (!res.ok) {
    console.error("funda service", res.status, await res.text().catch(() => ""));
    throw new FundaError("Funda gaf geen gegevens terug. Mogelijk is er iets veranderd aan Funda.");
  }
  return res.json();
}

/** The columns of `houses` we fill from a listing. */
export function houseFieldsFromListing(listing: FundaListing) {
  return {
    address: listing.address ?? undefined,
    city: listing.city ?? undefined,
    price: listing.price ?? undefined,
    livingArea: listing.livingArea ?? undefined,
    plotArea: listing.plotArea ?? undefined,
    bedrooms: listing.bedrooms ?? undefined,
    yearBuilt: listing.yearBuilt ?? undefined,
    energyLabel: listing.energyLabel ?? undefined,
    imageUrl: listing.photos[0],
  };
}

/** Floor plans come from Floorplanner's public project files, not from Funda itself. */
export async function fetchFloors(listing: FundaListing): Promise<Floor[]> {
  const projectIds = [...new Set(listing.floorplans.map((f) => f.projectId).filter((id): id is string => !!id))];
  const floors: Floor[] = [];
  for (const projectId of projectIds) {
    if (!/^\d+$/.test(projectId)) continue;
    try {
      const res = await fetch(`https://fmlpub.s3-eu-west-1.amazonaws.com/${projectId}.fml`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const project = (await res.json()) as FmlProject;
      floors.push(...floorsFromProject(project, listing.floorplans.filter((f) => f.projectId === projectId)));
    } catch (error) {
      console.error("floorplan fetch failed", projectId, error);
    }
  }
  return floors;
}

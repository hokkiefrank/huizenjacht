import "server-only";
import * as cheerio from "cheerio";
import { fetchFundaListing, FundaError, houseFieldsFromListing, type FundaListing } from "@/lib/funda";

export type ListingInfo = {
  url: string;
  source: string;
  address?: string;
  city?: string;
  price?: number;
  imageUrl?: string;
  description?: string;
  livingArea?: number;
  plotArea?: number;
  bedrooms?: number;
  yearBuilt?: number;
  energyLabel?: string;
  funda?: FundaListing;
  // Set when the Funda details couldn't be fetched, so the form can say so
  fundaError?: string;
};

const PROPERTY_TYPES = ["huis", "appartement", "bouwgrond", "parkeergelegenheid", "woonboot"];

/** Pull the first http(s) URL out of shared text such as "Bekijk dit huis op Funda: https://…". */
export function extractUrl(text: string | null | undefined): string | null {
  const match = text?.match(/https?:\/\/[^\s<>"']+/);
  return match ? match[0].replace(/[).,]+$/, "") : null;
}

/** Funda's listing id: 7-9 digits somewhere in the path, in every URL format Funda has used. */
function fundaId(url: URL) {
  return url.pathname.match(/(?:^|[/-])(\d{7,9})(?:[/-]|$)/)?.[1];
}

export function normalizeUrl(raw: string): string {
  const url = new URL(raw.trim());
  url.hash = "";
  url.hostname = url.hostname.replace(/^m\./, "www.");
  if (url.hostname.endsWith("funda.nl")) {
    // One form per listing, whichever link was shared (app share links, old and new page URLs)
    const id = fundaId(url);
    if (id) return `https://www.funda.nl/detail/${id}`;
    url.search = "";
  }
  return url.toString();
}

function sourceFor(url: URL): string {
  const host = url.hostname.replace(/^www\./, "");
  if (host.endsWith("funda.nl")) return "funda";
  return host.split(".").slice(-2, -1)[0] ?? host;
}

// Dutch street names keep these lowercase unless they start the name: "Laan van Meerdervoort"
const LOWERCASE_WORDS = new Set(["van", "de", "der", "den", "het", "aan", "op", "in", "bij", "ter", "ten", "en"]);

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part, i) => {
      if (/^\d/.test(part)) return part.toUpperCase();
      if (i > 0 && LOWERCASE_WORDS.has(part)) return part;
      return part[0].toUpperCase() + part.slice(1);
    })
    .join(" ");
}

/**
 * Funda URLs contain the city and street, e.g.
 *   /detail/koop/utrecht/huis-kerkstraat-12-a/43123456/   (current format)
 *   /koop/utrecht/huis-43123456-kerkstraat-12-a/           (older format)
 */
export function parseFundaUrl(url: URL): Pick<ListingInfo, "address" | "city"> {
  const parts = url.pathname.split("/").filter(Boolean);
  const koop = parts.findIndex((p) => p === "koop" || p === "huur");
  if (koop === -1 || parts.length < koop + 3) return {};
  const city = titleCase(parts[koop + 1]);
  let slug = parts[koop + 2];
  const type = PROPERTY_TYPES.find((t) => slug.startsWith(`${t}-`));
  if (type) slug = slug.slice(type.length + 1);
  slug = slug.replace(/^\d{6,}-/, "");
  return { city, address: titleCase(slug) };
}

function parsePrice(text: string | undefined): number | undefined {
  const match = text?.match(/€\s*([\d.]{5,})/);
  return match ? Number(match[1].replace(/\./g, "")) : undefined;
}

/**
 * Best-effort listing details: Funda through our pyfunda service (falling back to
 * the URL), other sites through their Open Graph tags.
 */
export async function lookupListing(rawUrl: string): Promise<ListingInfo> {
  const url = new URL(normalizeUrl(rawUrl));
  const info: ListingInfo = { url: url.toString(), source: sourceFor(url) };
  if (info.source === "funda") {
    try {
      const funda = await fetchFundaListing(url.toString());
      return { ...info, ...houseFieldsFromListing(funda), description: funda.highlight ?? undefined, funda };
    } catch (error) {
      if (!(error instanceof FundaError)) throw error;
      // Fall back to what the link itself tells us (the slug of the original link has the address)
      return { ...info, ...parseFundaUrl(new URL(rawUrl)), fundaError: error.message };
    }
  }

  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; huizen-zoektocht/1.0)", "accept-language": "nl-NL,nl" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return info;
    const $ = cheerio.load(await res.text());
    const meta = (prop: string) =>
      $(`meta[property="${prop}"]`).attr("content") ?? $(`meta[name="${prop}"]`).attr("content");
    const title = meta("og:title") ?? $("title").text();
    info.address = title?.split(/[|–-]/)[0].trim() || undefined;
    info.imageUrl = meta("og:image");
    info.description = meta("og:description");
    info.price = parsePrice(`${title} ${info.description ?? ""}`);
  } catch {
    // Unreachable or blocked: the add form lets us fill in the rest by hand
  }
  return info;
}

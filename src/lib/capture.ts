import "server-only";
import { db, schema } from "@/db";

const bare = (raw: string) => {
  const url = new URL(raw);
  return `${url.hostname.replace(/^(www|m)\./, "")}${url.pathname.replace(/\/$/, "")}`;
};

/**
 * Which suggestion or house a page sent by the bookmarklet belongs to. The "Open op …" links on the suggestions
 * page carry #suggestie=<id>, which the browser keeps; otherwise we compare addresses without query or tracking bits.
 */
export async function findCaptureMatch(pageUrl: string): Promise<{ kind: "suggestion" | "house"; id: number; address: string } | null> {
  const id = Number(new URL(pageUrl).hash.match(/suggestie=(\d+)/)?.[1]);
  const suggestions = await db
    .select({ id: schema.suggestions.id, url: schema.suggestions.url, address: schema.suggestions.address, houseId: schema.suggestions.houseId })
    .from(schema.suggestions);
  const houses = await db.select({ id: schema.houses.id, url: schema.houses.url, address: schema.houses.address }).from(schema.houses);
  const page = bare(pageUrl);
  const suggestion = suggestions.find((s) => s.id === id) ?? suggestions.find((s) => bare(s.url) === page);
  if (suggestion?.houseId) return { kind: "house", id: suggestion.houseId, address: suggestion.address };
  if (suggestion) return { kind: "suggestion", id: suggestion.id, address: suggestion.address };
  const house = houses.find((h) => h.url && bare(h.url) === page);
  return house ? { kind: "house", id: house.id, address: house.address } : null;
}

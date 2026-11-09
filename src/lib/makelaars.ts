import type { makelaars } from "@/db/schema";

type Makelaar = typeof makelaars.$inferSelect;

/** Why a makelaar's listings url may be wrong, or null when it looks fine (or one of them said it is). */
export function makelaarProblem(m: Makelaar): string | null {
  if (m.status === "uit" || m.confirmedAt) return null;
  if (m.status === "geblokkeerd") return "de website laat ons de pagina niet ophalen";
  if (m.lastError) return `de pagina gaf een fout (${m.lastError})`;
  if (m.status === "leeg") return "er stonden geen huizen op de pagina";
  try {
    if (new URL(m.listingsUrl).pathname === "/") return "dit is de homepage, niet de pagina met hun aanbod";
  } catch {
    return "de link klopt niet";
  }
  if (m.unverified) return "Claude kon deze pagina niet openen en heeft de link afgeleid";
  return null;
}

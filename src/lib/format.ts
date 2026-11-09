import type { HouseStatus } from "@/db/schema";

export const STATUS_LABELS: Record<HouseStatus, string> = {
  interessant: "Interessant",
  bezichtiging: "Bezichtiging gepland",
  bezichtigd: "Bezichtigd",
  bod: "Bod gedaan",
  afgevallen: "Afgevallen",
};

export const RATING_EMOJI: Record<number, string> = { 1: "👍", 0: "🤷", [-1]: "👎" };

export function formatPrice(price: number | null | undefined) {
  if (price == null) return null;
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(price);
}

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(
    date,
  );
}

/** Both rated, and how they relate: shown as a badge on the board. */
export function agreement(ratings: Record<number, number>, userIds: number[]) {
  const values = userIds.map((id) => ratings[id]);
  if (values.length < 2 || values.some((v) => v === undefined)) return null;
  if (values.every((v) => v === 1)) return "Allebei enthousiast";
  if (values.every((v) => v === -1)) return "Allebei nee";
  if (values.includes(1) && values.includes(-1)) return "Oneens";
  return null;
}

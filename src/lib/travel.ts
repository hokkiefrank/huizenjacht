import type { TravelMode } from "@/db/schema";

export const TRAVEL_MODES: Record<TravelMode, { icon: string; label: string }> = {
  ov: { icon: "🚆", label: "met het OV" },
  auto: { icon: "🚗", label: "met de auto" },
  fiets: { icon: "🚲", label: "op de fiets" },
};

export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} u ${rest} min` : `${minutes / 60} uur`;
}

// Estimates are rough, so only treat a house as too far when it's clearly over (same margin as agent/worker.mjs)
const TRAVEL_MARGIN = 1.3;

export function isTooFar(times: { minutes: number | null; maxMinutes: number }[] | null) {
  return !!times?.some((t) => t.minutes != null && t.minutes > t.maxMinutes * TRAVEL_MARGIN);
}

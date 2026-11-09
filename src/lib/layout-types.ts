import { z } from "zod";

export const layoutSchema = z.object({
  samenvatting: z.string().describe("2-3 zinnen over de indeling van het hele huis, in gewone taal"),
  verdiepingen: z
    .array(z.object({ naam: z.string(), beschrijving: z.string().describe("1-3 zinnen: welke ruimtes, hoe ze liggen en bereikbaar zijn") }))
    .describe("Per verdieping, in de volgorde van de plattegronden"),
  opvallend: z
    .array(z.string())
    .describe("Korte punten die opvallen aan de indeling, positief of negatief, bv. 'badkamer alleen via slaapkamer bereikbaar'"),
});

export type Layout = z.infer<typeof layoutSchema>;

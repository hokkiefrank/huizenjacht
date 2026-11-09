import { z } from "zod";

export const PROFILE_SECTIONS = ["mustHaves", "voorkeuren", "dealbreakers"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** Built per request so `wie` can only be "samen" or one of our actual names. */
export function profileSchema(names: [string, ...string[]]) {
  const who = z.enum(["samen", ...names]);
  const item = z.object({
    tekst: z.string().describe("Korte, concrete uitspraak, bv. 'Tuin op het zuiden'"),
    wie: who.describe("Voor wie dit geldt: 'samen' als het voor allebei geldt"),
    zekerheid: z
      .enum(["sterk", "vermoeden"])
      .describe("'sterk' als het expliciet gezegd is of in meerdere huizen terugkomt, anders 'vermoeden'"),
    onderbouwing: z.string().describe("Waar dit uit blijkt: welke huizen, reacties of wensen"),
  });
  return z.object({
    samenvatting: z.string().describe("2-4 zinnen: wat voor huis zoeken jullie, in gewone taal"),
    mustHaves: z.array(item).describe("Eisen waar een huis echt aan moet voldoen"),
    voorkeuren: z.array(item).describe("Dingen die een huis aantrekkelijker maken, maar geen harde eis"),
    dealbreakers: z.array(item).describe("Dingen waardoor een huis direct afvalt"),
    oneens: z
      .array(
        z.object({
          onderwerp: z.string(),
          standpunten: z.array(z.object({ wie: who, standpunt: z.string() })),
        }),
      )
      .describe("Onderwerpen waar jullie (nog) verschillend over denken"),
    budget: z.object({
      samenvatting: z.string().describe("Wat de prijzen van huizen die jullie leuk vinden zeggen over het budget"),
      minPrijs: z.number().nullable(),
      maxPrijs: z.number().nullable(),
    }),
    zoekgebied: z.string().describe("Plaatsen en buurten waar jullie kijken of die je leuk lijkt te vinden"),
    openVragen: z.array(z.string()).describe("Vragen die jullie samen zouden moeten beantwoorden om beter te kunnen zoeken"),
  });
}

export type Profile = z.infer<ReturnType<typeof profileSchema>>;
export type ProfileItem = Profile[ProfileSection][number];

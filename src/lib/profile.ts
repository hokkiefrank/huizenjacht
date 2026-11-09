import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatPrice, RATING_EMOJI, STATUS_LABELS } from "@/lib/format";
import { profileSchema, type ProfileItem, type ProfileSection } from "@/lib/profile-types";

const MODEL = "claude-opus-5-5";
// Claude Opus 5.5 list prices in USD per million tokens, for the cost shown on the profile page
const PRICE_PER_MTOK = { input: 4, output: 20 };

export function estimateCostUsd(inputTokens: number | null, outputTokens: number | null) {
  if (inputTokens == null || outputTokens == null) return null;
  return (inputTokens * PRICE_PER_MTOK.input + outputTokens * PRICE_PER_MTOK.output) / 1_000_000;
}

const SYSTEM_PROMPT = `Je helpt een stel dat samen een koophuis in Nederland zoekt. Ze verzamelen huizen (meestal van Funda), geven elk huis een beoordeling (👍 / 🤷 / 👎) en schrijven plus- en minpunten en notities. Daarnaast heeft ieder van hen in eigen woorden opgeschreven wat ze zoeken.

Jouw taak: maak op basis daarvan een gedeeld voorkeursprofiel. Het profiel wordt later ook gebruikt om nieuwe huizen voor ze te zoeken en te beoordelen, dus het moet concreet en toetsbaar zijn ("minstens 3 slaapkamers", "geen benedenwoning") in plaats van vaag ("een fijn huis").

Hoe je het aanpakt:
- Combineer wat ze zeggen (hun wensen) met wat ze laten zien (welke huizen ze leuk of niet leuk vinden en waarom). Als die twee elkaar tegenspreken, benoem dat, bijvoorbeeld als open vraag.
- Geef bij elk punt aan voor wie het geldt. Gebruik "samen" als het voor allebei geldt, of als iemand in de wij-vorm schrijft ("we zoeken") en de ander het niet tegenspreekt.
- Neem concrete details letterlijk over, zoals voorkeurswijken of "liever aan de oostkant van het spoor": juist die zijn nodig om gericht te zoeken.
- Gebruik "sterk" alleen als iets expliciet gezegd is of in meerdere huizen terugkomt. Eén enkele opmerking is een "vermoeden".
- Noem in de onderbouwing concrete huizen (adres) of reacties, zodat ze kunnen nagaan waar een punt vandaan komt.
- Verschillen tussen hen beschrijf je neutraal, zonder te kiezen wie gelijk heeft.
- Leid het budget af uit de vraagprijzen van huizen die ze positief beoordelen en uit wat ze erover zeggen. Laat minPrijs of maxPrijs leeg als daar nog te weinig over bekend is.
- Correcties ("klopt niet") zijn leidend: neem een gecorrigeerd punt niet opnieuw op, tenzij er daarna duidelijk nieuw bewijs voor is.
- Zijn er nog maar weinig huizen of reacties, zeg dat dan eerlijk in de samenvatting en houd het profiel kort. Verzin geen voorkeuren die nergens uit blijken.
- Schrijf in het Nederlands, kort en in gewone taal. Spreek ze aan met "jullie" en gebruik hun namen.`;

/** Everything the profile is based on, as readable text. */
async function buildContext() {
  const users = await db
    .select({ id: schema.users.id, name: schema.users.name, wishes: schema.users.wishes })
    .from(schema.users)
    .orderBy(asc(schema.users.id));
  const houses = await db.select().from(schema.houses).orderBy(asc(schema.houses.createdAt));
  const ratings = await db.select().from(schema.ratings);
  const comments = await db
    .select()
    .from(schema.comments)
    .orderBy(asc(schema.comments.createdAt));
  const floorplans = await db.select({ id: schema.floorplans.id, name: schema.floorplans.name }).from(schema.floorplans);
  const corrections = await db
    .select()
    .from(schema.profileCorrections)
    .orderBy(asc(schema.profileCorrections.createdAt));
  const rejected = await db
    .select()
    .from(schema.suggestions)
    .where(eq(schema.suggestions.status, "afgewezen"))
    .orderBy(asc(schema.suggestions.updatedAt));
  const nameOf = (id: number) => users.find((u) => u.id === id)?.name ?? "Onbekend";

  const parts: string[] = [];
  parts.push("# Wensen in eigen woorden");
  for (const u of users) parts.push(`## ${u.name}\n${u.wishes.trim() || "(nog niets ingevuld)"}`);

  parts.push(`# Huizen (${houses.length})`);
  for (const h of houses) {
    const facts = [
      h.city,
      formatPrice(h.price),
      h.livingArea && `${h.livingArea} m² wonen`,
      h.plotArea && `${h.plotArea} m² perceel`,
      h.bedrooms && `${h.bedrooms} slaapkamers`,
      h.yearBuilt && `bouwjaar ${h.yearBuilt}`,
      h.energyLabel && `energielabel ${h.energyLabel}`,
    ].filter(Boolean);
    const given = users
      .map((u) => ({ u, r: ratings.find((r) => r.houseId === h.id && r.userId === u.id) }))
      .filter(({ r }) => r)
      .map(({ u, r }) => `${u.name} ${RATING_EMOJI[r!.value]}`);
    // Compact on purpose: input tokens are most of the cost
    const lines = [`## ${h.address}`, facts.join(" · ")];
    if (h.status !== "interessant") lines.push(`Status: ${STATUS_LABELS[h.status]}`);
    lines.push(`Beoordeling: ${given.length ? given.join(", ") : "nog geen"}`);
    if (h.listing?.houseType || h.listing?.highlight) {
      lines.push(`Funda: ${[h.listing.houseType, h.listing.highlight].filter(Boolean).join(" – ")}`);
    }
    if (h.description) lines.push(`Omschrijving: ${h.description}`);
    if (h.layout) lines.push(`Indeling: ${h.layout.samenvatting} ${h.layout.opvallend.join("; ")}`);
    for (const c of comments.filter((c) => c.houseId === h.id)) {
      const kind = c.kind === "plus" ? "pluspunt" : c.kind === "min" ? "minpunt" : "notitie";
      const floor = c.floorplanId && floorplans.find((f) => f.id === c.floorplanId)?.name;
      const label = floor ? `${kind} over de indeling van de ${floor.toLowerCase()}` : kind;
      lines.push(`- ${nameOf(c.userId)} (${label}): ${c.body}`);
    }
    parts.push(lines.join("\n"));
  }

  if (rejected.length > 0) {
    parts.push("# Afgewezen suggesties (huizen die Claude voorstelde en die ze niet interessant vonden)");
    for (const r of rejected) {
      const facts = [r.city, formatPrice(r.price), r.livingArea && `${r.livingArea} m²`].filter(Boolean).join(" · ");
      parts.push(`- ${r.address} (${facts}): ${r.rejectReason ?? "geen reden gegeven"}${r.rejectedBy ? ` (${nameOf(r.rejectedBy)})` : ""}`);
    }
  }

  const proposals = await db
    .select()
    .from(schema.profileProposals)
    .where(sql`${schema.profileProposals.status} <> 'nieuw'`)
    .orderBy(asc(schema.profileProposals.id));
  const accepted = proposals.filter((p) => p.status === "toegevoegd");
  const declined = proposals.filter((p) => p.status === "afgewezen");
  if (accepted.length > 0) {
    parts.push("# Aanpassingen die ze zelf bevestigd hebben (neem deze over)");
    for (const p of accepted) parts.push(`- ${p.section}: ${p.text} (${p.who}; bevestigd door ${p.decidedBy ? nameOf(p.decidedBy) : "?"})`);
  }
  if (declined.length > 0) {
    parts.push("# Voorgestelde aanpassingen die ze afwezen (niet opnemen)");
    for (const p of declined) parts.push(`- ${p.section}: ${p.text}`);
  }

  if (corrections.length > 0) {
    parts.push("# Correcties op eerdere profielen");
    for (const c of corrections) parts.push(`- ${nameOf(c.userId)}: ${c.text}`);
  }

  return { users, text: parts.join("\n\n") };
}

export class ProfileError extends Error {}

export async function generateProfile(createdBy: number) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ProfileError("Er is nog geen Claude API-sleutel ingesteld op de server.");
  }
  // Don't pay for a profile that would come out the same
  const latest = await getLatestProfile();
  if (latest && (await changesSince(latest.createdAt)) === 0) {
    throw new ProfileError("Er is niets veranderd sinds de laatste update.");
  }
  const { users, text } = await buildContext();
  const names = users.map((u) => u.name) as [string, ...string[]];

  const client = new Anthropic();
  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Summarising a few dozen houses doesn't need deep reasoning; medium keeps thinking tokens down
      output_config: { effort: "medium", format: betaZodOutputFormat(profileSchema(names)) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new ProfileError("De Claude API-sleutel klopt niet.");
    if (error instanceof Anthropic.RateLimitError) throw new ProfileError("Claude is even te druk, probeer het zo nog eens.");
    if (error instanceof Anthropic.APIError) throw new ProfileError(`Claude gaf een fout (${error.status}).`);
    throw error;
  }

  if (response.stop_reason === "refusal") throw new ProfileError("Claude kon dit profiel niet maken.");
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new ProfileError("Het profiel kwam niet volledig terug, probeer het nog eens.");
  }

  await db.insert(schema.profiles).values({
    content: response.parsed_output,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    createdBy,
  });
}

export async function getLatestProfile() {
  const [profile] = await db.select().from(schema.profiles).orderBy(desc(schema.profiles.id)).limit(1);
  return profile ?? null;
}

/** Number of new houses, ratings, comments and wish edits since the given moment: tells you the profile is out of date. */
export async function changesSince(date: Date) {
  // Raw SQL parameters aren't run through Drizzle's column mapping, so pass an ISO string
  const since = sql`${date.toISOString()}::timestamptz`;
  const [row] = await db.execute<{ n: number }>(sql`
    select
      (select count(*) from ${schema.houses} where ${schema.houses.createdAt} > ${since})
      + (select count(*) from ${schema.ratings} where ${schema.ratings.updatedAt} > ${since})
      + (select count(*) from ${schema.comments} where ${schema.comments.createdAt} > ${since})
      + (select count(*) from ${schema.users} where ${schema.users.wishesUpdatedAt} > ${since})
      + (select count(*) from ${schema.profileCorrections} where ${schema.profileCorrections.createdAt} > ${since})
      + (select count(*) from ${schema.suggestions} where ${schema.suggestions.status} = 'afgewezen' and ${schema.suggestions.updatedAt} > ${since})
      + (select count(*) from ${schema.profileProposals} where ${schema.profileProposals.decidedAt} > ${since})
      as n`);
  return Number(row?.n ?? 0);
}

/** Remove an item from the latest profile and remember the correction for next time. */
export async function rejectProfileItem(userId: number, section: ProfileSection | "oneens", index: number) {
  const profile = await getLatestProfile();
  if (!profile) return;
  const list: object[] = profile.content[section];
  const item = profile.content[section][index];
  if (!item) return;
  const description =
    "tekst" in item ? `"${item.tekst}" (${item.wie}) klopt niet` : `Onenigheid over "${item.onderwerp}" klopt niet`;
  const content = { ...profile.content, [section]: list.filter((_, i) => i !== index) };
  await db.update(schema.profiles).set({ content }).where(eq(schema.profiles.id, profile.id));
  await db.insert(schema.profileCorrections).values({ userId, text: description });
}

/**
 * Accept or decline a change Claude proposed (agent/worker.mjs). Accepted ones go straight into the latest
 * profile, so the next search uses them without waiting for a new profile; buildContext keeps them after that.
 */
export async function decideProposal(userId: number, id: number, accept: boolean) {
  const [proposal] = await db.select().from(schema.profileProposals).where(eq(schema.profileProposals.id, id));
  if (!proposal || proposal.status !== "nieuw") return;
  await db
    .update(schema.profileProposals)
    .set({ status: accept ? "toegevoegd" : "afgewezen", decidedBy: userId, decidedAt: new Date() })
    .where(eq(schema.profileProposals.id, id));
  if (!accept) return;
  const profile = await getLatestProfile();
  if (!profile) return;
  const content = { ...profile.content };
  if (proposal.section === "zoekgebied") {
    content.zoekgebied = [content.zoekgebied.trim(), proposal.text].filter(Boolean).join(" ");
  } else {
    // `wie` is validated against our names when Claude writes a profile; this one comes from the worker, which checks the same
    const who = proposal.who as ProfileItem["wie"];
    content[proposal.section] = [
      ...content[proposal.section],
      { tekst: proposal.text, wie: who, zekerheid: "sterk", onderbouwing: `Door jullie bevestigd. ${proposal.reason}` },
    ];
  }
  await db.update(schema.profiles).set({ content }).where(eq(schema.profiles.id, profile.id));
}

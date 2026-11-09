"use server";

import bcrypt from "bcryptjs";
import { and, eq, gt, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { houseStatus } from "@/db/schema";
import { createSession, destroySession, hashToken, requireUser } from "@/lib/auth";
import { fetchFundaListing, FundaError, houseFieldsFromListing } from "@/lib/funda";
import { saveFundaDetails } from "@/lib/house-import";
import { normalizeUrl } from "@/lib/listing";
import { decideProposal, generateProfile, ProfileError, rejectProfileItem } from "@/lib/profile";

export type FormState = { error?: string; email?: string } | undefined;

// ---------- Auth ----------

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "E-mail of wachtwoord klopt niet.", email };
  }
  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function acceptInvite(token: string, _: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 10) return { error: "Kies een wachtwoord van minstens 10 tekens." };
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.tokenHash, hashToken(token)), gt(schema.invites.expiresAt, new Date())));
  if (!invite) return { error: "Deze uitnodiging is verlopen of al gebruikt." };

  await db
    .update(schema.users)
    .set({ passwordHash: await bcrypt.hash(password, 12) })
    .where(eq(schema.users.id, invite.userId));
  await db.delete(schema.invites).where(eq(schema.invites.userId, invite.userId));
  await createSession(invite.userId);
  redirect("/");
}

// ---------- Houses ----------

const optionalInt = z.preprocess(
  (v) => (v === "" || v == null ? undefined : String(v).replace(/[^\d]/g, "")),
  z.coerce.number().int().nonnegative().optional(),
);
const optionalText = z.preprocess((v) => (v === "" || v == null ? undefined : String(v).trim()), z.string().optional());

const houseFields = z.object({
  address: z.string().trim().min(1, "Vul een adres in."),
  city: optionalText,
  price: optionalInt,
  livingArea: optionalInt,
  plotArea: optionalInt,
  bedrooms: optionalInt,
  yearBuilt: optionalInt,
  energyLabel: optionalText,
  imageUrl: optionalText.pipe(z.url().optional()),
  description: optionalText,
});

function parseHouse(formData: FormData) {
  return houseFields.safeParse(Object.fromEntries(formData));
}

export async function addHouse(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  let url: string;
  try {
    url = normalizeUrl(String(formData.get("url") ?? ""));
  } catch {
    return { error: "Dat is geen geldige link." };
  }
  const parsed = parseHouse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [existing] = await db.select({ id: schema.houses.id }).from(schema.houses).where(eq(schema.houses.url, url));
  if (existing) redirect(`/huis/${existing.id}`);

  const [house] = await db
    .insert(schema.houses)
    .values({ ...parsed.data, url, source: String(formData.get("source") ?? "anders"), addedBy: user.id })
    .returning({ id: schema.houses.id });
  await importFundaQuietly(house.id, url);
  redirect(`/huis/${house.id}`);
}

/** Photos, full listing and floor plans for a Funda house; the house is saved either way. */
async function importFundaQuietly(houseId: number, url: string) {
  if (!new URL(url).hostname.endsWith("funda.nl")) return;
  try {
    await saveFundaDetails(houseId, await fetchFundaListing(url));
  } catch (error) {
    if (!(error instanceof FundaError)) console.error("funda import failed", houseId, error);
  }
}

export async function refreshFromFunda(houseId: number): Promise<FormState> {
  await requireUser();
  const [house] = await db.select({ url: schema.houses.url }).from(schema.houses).where(eq(schema.houses.id, houseId));
  if (!house) return { error: "Huis niet gevonden." };
  try {
    await saveFundaDetails(houseId, await fetchFundaListing(normalizeUrl(house.url)), { overwrite: true });
  } catch (error) {
    if (error instanceof FundaError) return { error: error.message };
    throw error;
  }
  refresh();
  return {};
}

export async function updateHouse(houseId: number, _: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseHouse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db
    .update(schema.houses)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(schema.houses.id, houseId));
  redirect(`/huis/${houseId}`);
}

export async function deleteHouse(houseId: number) {
  await requireUser();
  await db.delete(schema.houses).where(eq(schema.houses.id, houseId));
  redirect("/");
}

export async function setStatus(houseId: number, status: string) {
  await requireUser();
  const value = z.enum(houseStatus.enumValues).parse(status);
  await db.update(schema.houses).set({ status: value, updatedAt: new Date() }).where(eq(schema.houses.id, houseId));
  refresh();
}

export async function rate(houseId: number, value: number) {
  const user = await requireUser();
  const v = z.union([z.literal(1), z.literal(0), z.literal(-1)]).parse(value);
  await db
    .insert(schema.ratings)
    .values({ houseId, userId: user.id, value: v })
    .onConflictDoUpdate({
      target: [schema.ratings.houseId, schema.ratings.userId],
      set: { value: v, updatedAt: new Date() },
    });
  refresh();
}

export async function clearRating(houseId: number) {
  const user = await requireUser();
  await db
    .delete(schema.ratings)
    .where(and(eq(schema.ratings.houseId, houseId), eq(schema.ratings.userId, user.id)));
  refresh();
}

// ---------- Comments ----------

export async function addComment(houseId: number, kind: string, body: string, floorplanId?: number) {
  const user = await requireUser();
  const k = z.enum(schema.commentKind.enumValues).parse(kind);
  const text = body.trim();
  if (!text) return;
  await db.insert(schema.comments).values({
    houseId,
    userId: user.id,
    kind: k,
    body: text.slice(0, 2000),
    floorplanId: floorplanId === undefined ? null : z.number().int().parse(floorplanId),
  });
  refresh();
}

export async function deleteComment(commentId: number) {
  const user = await requireUser();
  // Only your own comments
  await db
    .delete(schema.comments)
    .where(and(eq(schema.comments.id, commentId), eq(schema.comments.userId, user.id)));
  refresh();
}

// ---------- Preference profile ----------

export async function saveWishes(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const wishes = String(formData.get("wishes") ?? "").slice(0, 5000);
  await db
    .update(schema.users)
    .set({ wishes, wishesUpdatedAt: new Date() })
    .where(eq(schema.users.id, user.id));
  refresh();
  return {};
}

export async function regenerateProfile(): Promise<FormState> {
  const user = await requireUser();
  try {
    await generateProfile(user.id);
  } catch (error) {
    if (error instanceof ProfileError) return { error: error.message };
    console.error("Profile generation failed", error);
    return { error: "Er ging iets mis bij het maken van het profiel." };
  }
  refresh();
  return {};
}

export async function rejectItem(section: string, index: number) {
  const user = await requireUser();
  const s = z.enum(["mustHaves", "voorkeuren", "dealbreakers", "oneens"]).parse(section);
  await rejectProfileItem(user.id, s, z.number().int().nonnegative().parse(index));
  refresh();
}

// ---------- Suggestions ----------

const MANUAL_RUNS_PER_DAY = 10;

export async function requestSearch(): Promise<FormState> {
  const user = await requireUser();
  const [{ active, today }] = await db.execute<{ active: number; today: number }>(sql`
    select
      count(*) filter (where ${schema.agentRuns.status} in ('queued', 'running'))::int as active,
      count(*) filter (where ${schema.agentRuns.requestedBy} is not null
        and ${schema.agentRuns.createdAt} > now() - interval '24 hours')::int as today
    from ${schema.agentRuns}
    where ${schema.agentRuns.kind} = 'suggestions'`);
  if (active > 0) return { error: "Er loopt al een zoektocht." };
  // Runs use the Claude Pro allowance, so keep manual runs limited
  if (today >= MANUAL_RUNS_PER_DAY) return { error: `Maximaal ${MANUAL_RUNS_PER_DAY} keer per dag handmatig zoeken.` };
  const [profile] = await db.select({ id: schema.profiles.id }).from(schema.profiles).limit(1);
  if (!profile) return { error: "Maak eerst een profiel, daar zoekt de agent mee." };
  await db.insert(schema.agentRuns).values({ requestedBy: user.id });
  refresh();
  return {};
}

export async function acceptSuggestion(id: number) {
  const user = await requireUser();
  const [s] = await db.select().from(schema.suggestions).where(eq(schema.suggestions.id, id));
  if (!s) return;
  const [existing] = await db.select({ id: schema.houses.id }).from(schema.houses).where(eq(schema.houses.url, s.url));
  const houseId =
    existing?.id ??
    (
      await db
        .insert(schema.houses)
        .values({
          url: s.url,
          source: s.source,
          address: s.address,
          city: s.city,
          price: s.price,
          livingArea: s.livingArea,
          bedrooms: s.bedrooms,
          imageUrl: s.imageUrl,
          description: `Suggestie van Claude: ${s.reason}`,
          addedBy: user.id,
        })
        .returning({ id: schema.houses.id })
    )[0].id;
  await db
    .update(schema.suggestions)
    .set({ status: "toegevoegd", houseId, updatedAt: new Date() })
    .where(eq(schema.suggestions.id, id));
  if (!existing) await importFundaQuietly(houseId, s.url);
  redirect(`/huis/${houseId}`);
}

/** Someone pasted the advertisement text of a house Claude couldn't find: rate it again with that. */
export async function saveSuggestionDetails(id: number, _: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const details = String(formData.get("details") ?? "").trim().slice(0, 8000);
  if (details.length < 30) return { error: "Plak de tekst van de advertentie (kenmerken en omschrijving)" };
  const [s] = await db.select({ listing: schema.suggestions.listing }).from(schema.suggestions).where(eq(schema.suggestions.id, id));
  if (!s) return { error: "Suggestie niet gevonden." };
  await db
    .update(schema.suggestions)
    .set({
      listing: { ...(s.listing ?? {}), description: details } as typeof s.listing,
      needsDetails: false,
      // The rate lane picks it up again
      score: null,
      reason: "",
      updatedAt: new Date(),
    })
    .where(eq(schema.suggestions.id, id));
  refresh();
  return {};
}

const bareUrl = (raw: string) => {
  const url = new URL(raw);
  url.search = "";
  url.hash = "";
  return url.toString();
};

/** A page from the "Stuur naar …" bookmarklet, confirmed by a logged-in user (see /ontvang/[token]). */
export async function applyCapture(token: string, suggestionId: number | null): Promise<FormState> {
  const user = await requireUser();
  const [capture] = await db.select().from(schema.pageCaptures).where(eq(schema.pageCaptures.token, token));
  if (!capture || capture.usedAt) return { error: "Deze pagina is al verwerkt of verlopen." };
  await db.update(schema.pageCaptures).set({ usedAt: new Date() }).where(eq(schema.pageCaptures.token, token));

  if (suggestionId) {
    const [s] = await db.select().from(schema.suggestions).where(eq(schema.suggestions.id, suggestionId));
    if (!s) return { error: "Suggestie niet gevonden." };
    await db
      .update(schema.suggestions)
      .set({
        // A login link from an alert mail gets replaced by the page itself (without query, where logins sit)
        ...(s.listing?.loginLink && { url: bareUrl(capture.url) }),
        listing: { ...(s.listing ?? {}), description: capture.text.slice(0, 8000), loginLink: false } as typeof s.listing,
        imageUrl: s.imageUrl ?? capture.imageUrl,
        needsDetails: false,
        // The rate lane picks it up again
        score: null,
        reason: "",
        updatedAt: new Date(),
      })
      .where(eq(schema.suggestions.id, suggestionId));
  } else {
    // New house: the agent worker reads it like an alert mail (address, price, …) and then rates it
    const [me] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, user.id));
    await db.insert(schema.inboundEmails).values({
      kind: "pagina",
      fromAddress: new URL(capture.url).hostname.replace(/^www\./, ""),
      toAddress: me?.email.toLowerCase() ?? "",
      subject: capture.title,
      text: `Adres van deze pagina: ${capture.url}\n${capture.imageUrl ? `Foto: ${capture.imageUrl}\n` : ""}\n${capture.text}`,
    });
  }
  redirect("/suggesties");
}

export async function dismissDetailsRequest(id: number) {
  await requireUser();
  await db.update(schema.suggestions).set({ needsDetails: false }).where(eq(schema.suggestions.id, id));
  refresh();
}

export async function fetchSuggestionFromFunda(id: number): Promise<FormState> {
  await requireUser();
  const [s] = await db.select({ url: schema.suggestions.url }).from(schema.suggestions).where(eq(schema.suggestions.id, id));
  if (!s) return { error: "Suggestie niet gevonden." };
  let listing;
  try {
    listing = await fetchFundaListing(normalizeUrl(s.url));
  } catch (error) {
    if (error instanceof FundaError) return { error: error.message };
    throw error;
  }
  const f = houseFieldsFromListing(listing);
  const available = !listing.status || /^beschikbaar$/i.test(listing.status.trim());
  await db
    .update(schema.suggestions)
    .set({
      listing,
      // Sold or under offer: off the list, without counting as "not interesting"
      ...(!available && { status: "niet_beschikbaar" as const }),
      address: f.address,
      city: f.city,
      price: f.price,
      livingArea: f.livingArea,
      bedrooms: f.bedrooms,
      imageUrl: f.imageUrl,
      updatedAt: new Date(),
    })
    .where(eq(schema.suggestions.id, id));
  refresh();
  return {};
}

export async function rejectSuggestion(id: number, reason: string) {
  const user = await requireUser();
  await db
    .update(schema.suggestions)
    .set({ status: "afgewezen", rejectReason: reason.trim().slice(0, 500) || null, rejectedBy: user.id, updatedAt: new Date() })
    .where(eq(schema.suggestions.id, id));
  refresh();
}

// ---------- Where to search ----------

const travelLimitSchema = z.object({
  label: z.string().trim().min(1, "Geef de plek een naam, bv. Werk Alex.").max(100),
  address: z.string().trim().min(2, "Vul een adres of plaats in.").max(200),
  mode: z.enum(schema.travelMode.enumValues),
  maxMinutes: z.coerce.number().int().min(5, "Minimaal 5 minuten.").max(300, "Maximaal 5 uur."),
});

export async function addTravelLimit(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = travelLimitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db.insert(schema.travelLimits).values({ ...parsed.data, createdBy: user.id });
  refresh();
  return {};
}

export async function deleteTravelLimit(id: number) {
  await requireUser();
  await db.delete(schema.travelLimits).where(eq(schema.travelLimits.id, id));
  refresh();
}

const makelaarSchema = z.object({
  name: z.string().trim().min(1, "Geef de makelaar een naam").max(200),
  listingsUrl: z.url({ protocol: /^https?$/, error: "Plak de link naar hun aanbodpagina" }),
  places: z.string().trim().max(300).default(""),
});

export async function addMakelaar(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = makelaarSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const url = new URL(parsed.data.listingsUrl);
  url.hash = "";
  const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");
  const known = await db.select({ name: schema.makelaars.name, url: schema.makelaars.listingsUrl }).from(schema.makelaars);
  const existing = known.find((m) => host(m.url) === host(url.toString()));
  if (existing) return { error: `${existing.name} staat al op de lijst` };
  await db.insert(schema.makelaars).values({ ...parsed.data, listingsUrl: url.toString(), addedBy: user.id });
  refresh();
  return {};
}

/** A better listings url for a makelaar Claude couldn't check; read again at the next search. */
export async function updateMakelaarUrl(id: number, _: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const parsed = makelaarSchema.shape.listingsUrl.safeParse(formData.get("listingsUrl"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const url = new URL(parsed.data);
  url.hash = "";
  const [taken] = await db
    .select({ id: schema.makelaars.id, name: schema.makelaars.name })
    .from(schema.makelaars)
    .where(eq(schema.makelaars.listingsUrl, url.toString()));
  if (taken && taken.id !== id) return { error: `Die link staat al bij ${taken.name}` };
  await db
    .update(schema.makelaars)
    .set({ listingsUrl: url.toString(), status: "actief", unverified: false, confirmedAt: null, lastHash: null, lastError: null, lastCount: null })
    .where(eq(schema.makelaars.id, id));
  refresh();
  return {};
}

/** The url is fine as it is (e.g. they really have nothing for sale right now). */
export async function confirmMakelaar(id: number) {
  await requireUser();
  await db.update(schema.makelaars).set({ unverified: false, confirmedAt: new Date() }).where(eq(schema.makelaars.id, id));
  refresh();
}

/** Switched off instead of deleted, so Claude doesn't put it back on the list. */
export async function setMakelaarActive(id: number, active: boolean) {
  await requireUser();
  await db
    .update(schema.makelaars)
    // Back on: check it at the next search, as if new
    .set(active ? { status: "actief", lastHash: null, lastError: null } : { status: "uit" })
    .where(eq(schema.makelaars.id, id));
  refresh();
}

export async function saveSearchInstructions(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const instructions = String(formData.get("instructions") ?? "").slice(0, 5000);
  await db
    .insert(schema.searchSettings)
    .values({ id: 1, instructions, updatedBy: user.id })
    .onConflictDoUpdate({
      target: schema.searchSettings.id,
      set: { instructions, updatedBy: user.id, updatedAt: new Date() },
    });
  refresh();
  return {};
}

export async function saveFundaSearch(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const raw = String(formData.get("url") ?? "").trim();
  let url = "";
  if (raw) {
    try {
      const parsed = new URL(raw);
      parsed.hostname = parsed.hostname.replace(/^m\./, "www.");
      if (parsed.hostname !== "www.funda.nl" || !parsed.pathname.startsWith("/zoeken/")) throw new Error();
      url = parsed.toString();
    } catch {
      return { error: "Plak de link van een zoekopdracht op funda.nl (begint met funda.nl/zoeken/)." };
    }
  }
  await db
    .insert(schema.searchSettings)
    .values({ id: 1, fundaSearchUrl: url, updatedBy: user.id })
    .onConflictDoUpdate({ target: schema.searchSettings.id, set: { fundaSearchUrl: url, updatedBy: user.id, updatedAt: new Date() } });
  refresh();
  return {};
}

export async function decideSearchIdea(id: number, status: "toegevoegd" | "afgewezen") {
  const user = await requireUser();
  await db
    .update(schema.searchIdeas)
    .set({ status: z.enum(["toegevoegd", "afgewezen"]).parse(status), decidedBy: user.id, updatedAt: new Date() })
    .where(eq(schema.searchIdeas.id, id));
  refresh();
}

// ---------- Map zones ----------

const zoneSchema = z.object({
  name: z.string().trim().min(1, "Geef het gebied een naam").max(100),
  kind: z.enum(["zoeken", "niet"]),
  polygon: z
    .array(z.tuple([z.number().min(50).max(54), z.number().min(3).max(8)]))
    .min(3, "Klik minstens drie punten op de kaart")
    .max(200),
});

export async function createZone(input: z.input<typeof zoneSchema>): Promise<FormState> {
  const user = await requireUser();
  const parsed = zoneSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db.insert(schema.searchZones).values({ ...parsed.data, createdBy: user.id });
  refresh();
  return {};
}

export async function deleteZone(id: number) {
  await requireUser();
  await db.delete(schema.searchZones).where(eq(schema.searchZones.id, z.number().int().parse(id)));
  refresh();
}

// ---------- Profile proposals ----------

export async function decideProfileProposal(id: number, accept: boolean) {
  const user = await requireUser();
  await decideProposal(user.id, z.number().int().parse(id), z.boolean().parse(accept));
  refresh();
}

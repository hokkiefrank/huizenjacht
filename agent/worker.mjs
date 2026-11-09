// Claude Code agent on the Claude Pro subscription. Picks up queued runs from the database:
// - suggestions: search Dutch housing sites for listings that fit our profile (only WebSearch/WebFetch)
// - layout: describe one house's floor plans from images we render (only Read, on those images)
// - rate: score the houses that came in through our saved Funda search (no tools at all)
// Not Claude: the inbox lane reads Funda search alerts (stored by mail/server.mjs) and fetches those listings,
// and the daily run fetches the listings pages of estate agents (makelaars) from this server; Claude only reads them.
// Claude Code never gets a shell, the database or other secrets.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import sharp from "sharp";
import { describeZone, NEAR_METERS, zoneOf } from "./zones.mjs";

// `to: fromCamel` maps camelCase keys in sql() inserts to snake_case columns
const sql = postgres(process.env.DATABASE_URL, { transform: { column: { to: postgres.fromCamel } } });
const POLL_MS = 30_000;
const RUN_TIMEOUT_MS = 25 * 60_000;
const DAILY_HOUR = 7; // Europe/Amsterdam
const MAX_SUGGESTIONS = 8;
const FUNDA_SERVICE_URL = process.env.FUNDA_SERVICE_URL ?? "http://funda:8000";

// Same labels as src/lib/travel.ts
const TRAVEL_MODES = { ov: "met het OV (deur tot deur, gewone werkdag)", auto: "met de auto (gemiddeld verkeer)", fiets: "op de fiets" };
// Estimates are rough, so only drop a house that's clearly over a limit (same in src/lib/travel.ts)
const TRAVEL_MARGIN = 1.3;

// Same shape as ProfileCheck in src/db/schema.ts
const CHECKS_SCHEMA = {
  type: "array",
  description: "Eén regel per must-have en per dealbreaker uit hun profiel, in de volgorde van het profiel",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["eis", "past", "zeker", "toelichting"],
    properties: {
      eis: { type: "string", description: "De eis, kort (2-5 woorden), bv. 'Parkeren op eigen terrein'" },
      past: {
        type: "string",
        enum: ["ja", "nee", "onbekend"],
        description: "'nee' als het huis de must-have mist of de dealbreaker heeft; 'onbekend' als de gegevens het niet zeggen",
      },
      zeker: {
        type: "boolean",
        description: "Alleen true als de advertentie het letterlijk zegt (bv. 'parkeren op de openbare weg'). Afgeleid of aangenomen is false.",
      },
      toelichting: { type: "string", description: "Een paar woorden, bv. 'parkeren op straat (advertentie)'" },
    },
  },
};

const CHECKS_INSTRUCTIONS =
  "Vul 'kenmerken' in: per must-have en dealbreaker of het huis eraan voldoet. Wees eerlijk over wat je niet weet: zet 'onbekend' als de gegevens het niet zeggen, en 'zeker' alleen als de advertentie het letterlijk zegt. Een 'nee' die zeker is drukt de score; een aanname mag dat niet, want dan missen ze misschien een pareltje.";

const SUGGESTIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions", "notities"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url", "bron", "adres", "plaats", "beschikbaarheid", "vraagprijs", "woonoppervlak", "slaapkamers", "fotoUrl", "reistijden", "score", "waarom", "twijfels", "kenmerken"],
        properties: {
          url: { type: "string", description: "Link naar de advertentie zelf" },
          bron: { type: "string", description: "Website, bv. 'jaap', 'huislijn', 'pararius', of de naam van de makelaar" },
          adres: { type: "string", description: "Straat en huisnummer" },
          plaats: { type: "string" },
          beschikbaarheid: {
            type: "string",
            enum: ["beschikbaar", "onder bod", "onder optie", "verkocht onder voorbehoud", "verkocht", "onbekend"],
            description: "Zoals in de advertentie staat; 'onbekend' als je de advertentie niet kon openen",
          },
          vraagprijs: { type: ["integer", "null"] },
          woonoppervlak: { type: ["integer", "null"], description: "m²" },
          slaapkamers: { type: ["integer", "null"] },
          fotoUrl: { type: ["string", "null"], description: "Directe link naar een foto, alleen als je die zeker weet" },
          reistijden: {
            type: "array",
            description: "Eén schatting per reistijdeis, in dezelfde volgorde; leeg als er geen eisen zijn",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["eis", "minuten"],
              properties: {
                eis: { type: "integer", description: "Het nummer van de eis" },
                minuten: { type: ["integer", "null"], description: "Geschatte reistijd in minuten; null als je het echt niet kunt schatten" },
              },
            },
          },
          score: { type: "integer", description: "1-10: hoe goed past dit huis bij het profiel" },
          waarom: { type: "string", description: "1-3 zinnen: waarom dit huis bij hen past, verwijzend naar het profiel" },
          twijfels: { type: "string", description: "Wat mogelijk niet past of nog onbekend is; leeg als er niets is" },
          kenmerken: CHECKS_SCHEMA,
        },
      },
    },
    notities: { type: "string", description: "Kort: waar je gezocht hebt en wat opviel, bv. weinig aanbod in een gebied" },
    makelaars: {
      type: "array",
      description: "Makelaars in en rond het zoekgebied die nog niet op de lijst staan, met de pagina van hun koopaanbod; leeg als je er geen nieuwe vond",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["naam", "aanbodUrl", "plaatsen", "geopend"],
        properties: {
          naam: { type: "string" },
          aanbodUrl: { type: "string", description: "De pagina op hun eigen website met al hun koophuizen (een overzicht, geen los huis)" },
          plaatsen: { type: "string", description: "Waar ze vooral werken, bv. 'Zeist, Bunnik'" },
          geopend: { type: "boolean", description: "true als je deze aanbodpagina zelf hebt geopend en er huizen op zag; false als de url afgeleid is" },
        },
      },
    },
    zoekideeen: {
      type: "array",
      description: "Hooguit 3 aanpassingen van hun Funda-zoekopdracht die de moeite waard zijn; leeg als je niets goeds weet",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["titel", "waarom", "fundaUrl"],
        properties: {
          titel: { type: "string", description: "Kort, bv. 'Krimpen aan den IJssel toevoegen' of 'Ook vanaf 90 m²'" },
          waarom: { type: "string", description: "1-2 zinnen, verwijzend naar profiel, reistijden of wat je bij het zoeken zag" },
          fundaUrl: { type: "string", description: "De volledige aangepaste zoek-url op funda.nl" },
        },
      },
    },
  },
};

const RATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["beoordelingen"],
  properties: {
    beoordelingen: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "score", "waarom", "twijfels", "reistijden", "kenmerken"],
        properties: {
          id: { type: "integer", description: "Het nummer van het huis" },
          score: { type: "integer", description: "1-10: hoe goed past dit huis bij het profiel" },
          waarom: { type: "string", description: "1-3 zinnen: wat bij hen past (of juist niet), verwijzend naar het profiel" },
          twijfels: { type: "string", description: "Wat mogelijk niet past of nog onbekend is; leeg als er niets is" },
          reistijden: SUGGESTIONS_SCHEMA.properties.suggestions.items.properties.reistijden,
          kenmerken: CHECKS_SCHEMA,
        },
      },
    },
  },
};

// What we can read from a Pararius or Huislijn alert mail; their pages themselves block us
const ALERT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["huizen"],
  properties: {
    huizen: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url", "adres", "plaats", "postcode", "type", "vraagprijs", "woonoppervlak", "perceel", "kamers", "slaapkamers", "fotoUrl", "omschrijving"],
        properties: {
          url: { type: "string", description: "Link naar de advertentie van dit huis, precies zoals in de e-mail" },
          adres: { type: "string", description: "Straat en huisnummer" },
          plaats: { type: ["string", "null"] },
          postcode: { type: ["string", "null"] },
          type: { type: ["string", "null"], description: "Bv. 'tussenwoning', 'twee-onder-een-kap', 'appartement'" },
          vraagprijs: { type: ["integer", "null"] },
          woonoppervlak: { type: ["integer", "null"], description: "m²" },
          perceel: { type: ["integer", "null"], description: "m²" },
          kamers: { type: ["integer", "null"] },
          slaapkamers: { type: ["integer", "null"] },
          fotoUrl: { type: ["string", "null"], description: "Link naar de foto van dit huis uit de e-mail, als die er is" },
          omschrijving: { type: ["string", "null"], description: "Wat de e-mail verder over dit huis zegt, letterlijk overgenomen" },
        },
      },
    },
  },
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function normalizeUrl(raw) {
  const url = new URL(raw.trim());
  url.hash = "";
  url.hostname = url.hostname.replace(/^m\./, "www.");
  for (const key of [...url.searchParams.keys()]) if (/^utm_/.test(key)) url.searchParams.delete(key);
  if (url.hostname.endsWith("funda.nl")) {
    // Same form as the app (src/lib/listing.ts), so duplicates are recognised
    const id = url.pathname.match(/(?:^|[/-])(\d{7,9})(?:[/-]|$)/)?.[1];
    if (id) return `https://www.funda.nl/detail/${id}`;
    url.search = "";
  }
  return url.toString();
}

const toInt = (v) => (Number.isFinite(v) ? Math.round(v) : null);
const text = (v, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// Same shape as src/lib/layout-types.ts
const LAYOUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["samenvatting", "verdiepingen", "opvallend"],
  properties: {
    samenvatting: { type: "string", description: "2-3 zinnen over de indeling van het hele huis, in gewone taal" },
    verdiepingen: {
      type: "array",
      description: "Per verdieping, in de volgorde van de plattegronden",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["naam", "beschrijving"],
        properties: {
          naam: { type: "string" },
          beschrijving: { type: "string", description: "1-3 zinnen: welke ruimtes, hoe ze liggen en bereikbaar zijn" },
        },
      },
    },
    opvallend: {
      type: "array",
      items: { type: "string" },
      description: "Korte punten die opvallen aan de indeling, positief of negatief, bv. 'badkamer alleen via slaapkamer bereikbaar'",
    },
  },
};

// ---------- Scheduling ----------

async function queueDailyRun() {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Amsterdam" }).format(new Date()),
  );
  if (hour < DAILY_HOUR) return;
  const [{ hasProfile }] = await sql`select exists(select 1 from profiles) as "hasProfile"`;
  if (!hasProfile) return;
  await sql`
    insert into agent_runs (status)
    select 'queued'
    where not exists (
      select 1 from agent_runs
      where kind = 'suggestions' and requested_by is null
        and (created_at at time zone 'Europe/Amsterdam')::date = (now() at time zone 'Europe/Amsterdam')::date
    )`;
}

async function claimRun(kind) {
  const [run] = await sql`
    update agent_runs set status = 'running', started_at = now()
    where id = (
      select id from agent_runs where status = 'queued' and kind = ${kind} order by id limit 1 for update skip locked
    )
    returning id, house_id as "houseId"`;
  return run;
}

// ---------- Prompt ----------

async function loadSearchArea() {
  const limits = await sql`select label, address, mode, max_minutes as "maxMinutes" from travel_limits order by label, id`;
  const [settings] = await sql`select instructions, funda_search_url as "fundaSearchUrl" from search_settings where id = 1`;
  const zones = await sql`select name, kind, polygon from search_zones order by id`;
  return { limits, zones, instructions: settings?.instructions?.trim() ?? "", fundaSearchUrl: settings?.fundaSearchUrl?.trim() ?? "" };
}

/** Our map areas, described so Claude knows roughly where they are (the exact check happens in zones.mjs). */
function zonesSection(zones) {
  if (zones.length === 0) return [];
  const where = (z) => {
    const lats = z.polygon.map((p) => p[0]);
    const lngs = z.polygon.map((p) => p[1]);
    const mid = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];
    const km = Math.max((Math.max(...lats) - Math.min(...lats)) * 111, (Math.max(...lngs) - Math.min(...lngs)) * 69);
    return `rond ${mid[0].toFixed(4)}, ${mid[1].toFixed(4)}, zo'n ${km.toFixed(1).replace(".", ",")} km breed`;
  };
  const search = zones.filter((z) => z.kind === "zoeken");
  const not = zones.filter((z) => z.kind === "niet");
  return [
    "## Gebieden op hun kaart",
    ...(search.length
      ? [
          `Hier zoeken ze. Kijk ook net daarbuiten (tot zo'n ${NEAR_METERS / 1000} km): zulke huizen krijgen geen aftrek, ze willen geen pareltje missen.`,
          ...search.map((z) => `- ${z.name} (${where(z)})`),
        ]
      : []),
    ...(not.length ? ["Hier willen ze niet wonen; huizen daar krijgen hooguit een 3:", ...not.map((z) => `- ${z.name} (${where(z)})`)] : []),
    "",
  ];
}

const cleanChecks = (list) => {
  const checks = (Array.isArray(list) ? list : [])
    .slice(0, 15)
    .map((c) => ({
      eis: text(c?.eis, 80),
      past: ["ja", "nee", "onbekend"].includes(c?.past) ? c.past : "onbekend",
      zeker: c?.zeker === true,
      toelichting: text(c?.toelichting, 160) ?? "",
    }))
    .filter((c) => c.eis);
  return checks.length ? checks : null;
};

// ---------- Locations ----------

const PDOK_URL = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";
const fold = (v) => (v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Coordinates of an address through PDOK (the government's address search); null unless street and place match. */
async function geocode(address, city) {
  if (!address || !city) return null;
  const url = `${PDOK_URL}?${new URLSearchParams({ q: `${address} ${city}`, fq: "type:adres", rows: "1", fl: "weergavenaam,centroide_ll" })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`PDOK ${res.status}`);
  const doc = (await res.json())?.response?.docs?.[0];
  const point = doc?.centroide_ll?.match(/POINT\(([\d.]+) ([\d.]+)\)/);
  if (!point) return null;
  // "Dorpsstraat 1, 1234AB Ergenshuizen": the street and the place must be in there, or it's another house
  const found = fold(doc.weergavenaam);
  const street = fold(address).replace(/\s*\d.*$/, "");
  if (!street || !found.includes(street) || !found.includes(fold(city))) return null;
  return { lat: Number(point[2]), lng: Number(point[1]) };
}

/** Give open suggestions coordinates, from the listing when it has them. Tried once per house. */
async function locateSuggestions(limit = 150) {
  const rows = await sql`
    select id, address, city, listing from suggestions
    where status = 'nieuw' and geocoded_at is null order by id desc limit ${limit}`;
  let located = 0;
  for (const s of rows) {
    let spot = null;
    if (Number.isFinite(s.listing?.latitude) && Number.isFinite(s.listing?.longitude)) {
      spot = { lat: s.listing.latitude, lng: s.listing.longitude };
    } else {
      try {
        spot = await geocode(s.address, s.city);
      } catch (error) {
        log(`geocode ${s.id} failed`, error.message);
        break; // PDOK is down or unhappy: try the rest next time
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    await sql`update suggestions set lat = ${spot?.lat ?? null}, lng = ${spot?.lng ?? null}, geocoded_at = now() where id = ${s.id}`;
    if (spot) located++;
  }
  if (rows.length) log(`located ${located} of ${rows.length} suggestions`);
}

function travelSection(limits) {
  if (!limits.length) return [];
  return [
    "## Reistijden (harde eisen)",
    "Een huis moet aan álle eisen hieronder voldoen. Schat per huis de reistijd per eis, uitgaande van het adres van het huis: met de auto bij gemiddeld verkeer, met het OV deur tot deur inclusief lopen/fietsen naar de halte en overstappen op een gewone werkdag.",
    ...limits.map((l, i) => `${i + 1}. Hooguit ${l.maxMinutes} minuten ${TRAVEL_MODES[l.mode]} naar ${l.label} (${l.address})`),
    "",
  ];
}

async function profileSection() {
  const [profile] = await sql`select content from profiles order by id desc limit 1`;
  if (!profile) throw new Error("Er is nog geen profiel. Maak eerst een profiel op de profielpagina.");
  const users = await sql`select name, wishes from users order by id`;
  return {
    users,
    lines: [
      "## Hun profiel",
      JSON.stringify(profile.content, null, 1),
      "",
      "## Wensen in eigen woorden",
      ...users.map((u) => `${u.name}: ${u.wishes.trim() || "(niet ingevuld)"}`),
      "",
    ],
  };
}

async function makelaarsSection() {
  const known = await sql`select name, listings_url, places, status from makelaars order by name`;
  const active = known.filter((m) => m.status === "actief").length;
  return [
    `## Makelaars (${known.length} op de lijst)`,
    "Van de makelaars hieronder halen we zelf elke dag de aanbodpagina op en lezen we alle huizen uit: hun aanbod hoef je dus niet te doorzoeken.",
    `Breid de lijst uit in 'makelaars': zoek makelaars die huizen verkopen in en rond het zoekgebied (ook in buurplaatsen die binnen de reistijden vallen) en geef de url van de pagina op hun eigen website waar al hun koophuizen staan. Liever die pagina dan de homepage; een url met filters of sortering op nieuwste is prima. Probeer de pagina te openen (WebFetch) om te zien of het de goede is, maar ook als dat niet lukt mag je hem geven als je zeker weet dat het de aanbodpagina is. Geen makelaars die al op de lijst staan (ook niet onder een andere url) of die 'uit' staan. ${active < 20 ? "De lijst is nog kort: besteed daar deze keer het grootste deel van je zoekwerk aan, zo'n 10 tot 20 nieuwe makelaars." : "Een paar nieuwe per keer is genoeg."}`,
    ...(known.length ? known.map((m) => `- ${m.name} (${m.places || "?"}) [${m.status}] ${m.listings_url}`) : ["(nog geen makelaars)"]),
    "",
  ];
}

async function searchIdeasSection(fundaSearchUrl) {
  if (!fundaSearchUrl) return [];
  const ideas = await sql`select title, url, status from search_ideas order by id`;
  return [
    "## Hun Funda-zoekopdracht",
    `Ze hebben deze zoekopdracht op Funda bewaard en krijgen nieuwe huizen daaruit al per e-mail binnen (die worden apart beoordeeld): ${fundaSearchUrl}`,
    "Zoek daarom op Funda niet naar huizen die binnen die zoekopdracht vallen; dat aanbod hebben ze al.",
    "",
    "Stel daarnaast in 'zoekideeen' hooguit 3 aanpassingen van die zoekopdracht voor die de moeite waard zijn: vooral plaatsen die binnen de reistijden en het profiel passen maar nog niet in selected_area staan (gebruik Funda's schrijfwijze: kleine letters met streepjes, bv. 'krimpen-aan-den-ijssel'), of een filter dat goede huizen onnodig uitsluit. Geef voor elk idee de volledige aangepaste url, met verder dezelfde filters. Alleen ideeën met een concrete reden; geen ideeën die ze al gezien hebben:",
    ...(ideas.length ? ideas.map((i) => `- ${i.title} [${i.status}] ${i.url}`) : ["(nog geen eerdere ideeën)"]),
    "",
  ];
}

async function buildPrompt({ limits, zones, instructions, fundaSearchUrl }) {
  const { users, lines: profileLines } = await profileSection();
  const houses = await sql`
    select h.address, h.city, h.price, h.url,
      coalesce(string_agg(u.name || ' ' || case r.value when 1 then '👍' when 0 then '🤷' else '👎' end, ', '), 'nog geen') as ratings
    from houses h
    left join ratings r on r.house_id = h.id
    left join users u on u.id = r.user_id
    group by h.id order by h.created_at`;
  const previous = await sql`select url, address, city, status, reject_reason from suggestions order by created_at`;

  const today = new Intl.DateTimeFormat("nl-NL", { dateStyle: "long", timeZone: "Europe/Amsterdam" }).format(new Date());
  const lines = [
    `Vandaag is het ${today}. Je helpt ${users.map((u) => u.name).join(" en ")} een koophuis te vinden in Nederland.`,
    "",
    "## Opdracht",
    `Zoek op het internet naar huizen die nu te koop staan en goed passen bij hun profiel hieronder. Geef maximaal ${MAX_SUGGESTIONS} suggesties, de beste eerst. Kwaliteit gaat voor aantal: nul suggesties is prima als er niets goeds is.`,
    "",
    "Werkwijze:",
    "- Funda, Pararius en Huislijn komen al binnen via hun e-mailmeldingen, en Funda, Pararius, Huislijn en Jaap blokkeren het openen van pagina's: probeer die sites niet te openen. Zoek in plaats daarvan naar makelaars in en rond het zoekgebied (zie 'Makelaars' hieronder) en naar nieuwbouwprojecten. Daar staan ook huizen die niet op Funda staan, en juist die zijn waardevol.",
    "- Open de advertentie (WebFetch) om te controleren dat het huis echt nog beschikbaar is. Sla huizen over die 'verkocht', 'verkocht onder voorbehoud', 'onder bod' of 'onder optie' zijn: die willen ze niet zien. Kun je de advertentie niet openen maar lijkt het huis op grond van wat je wel weet te passen, geef het dan toch, met beschikbaarheid 'onbekend', de beste link naar de advertentie die je hebt, en in 'twijfels' wat je niet kon controleren. Een van hen opent de advertentie dan zelf en daarna wordt het huis opnieuw beoordeeld. Noem zulke huizen dus niet alleen in 'notities'.",
    "- Blijf binnen het budget (hooguit zo'n 5% erboven), tenzij een huis op alle andere punten uitzonderlijk goed past.",
    "- Het zoekgebied uit het profiel is een vertrekpunt, geen harde grens. Kijk ook in plaatsen die er vlak naast liggen maar formeel een andere plaats, gemeente of provincie zijn (een buurdorp, een kern net over de gemeentegrens, een wijk aan de rand van de stad): die zijn net zo goed als ze verder passen. Zeg in 'twijfels' als een huis buiten het genoemde zoekgebied ligt.",
    "- Sla huizen over die ze al kennen: alles in de lijsten 'Huizen op hun bord' en 'Eerdere suggesties' hieronder, ook als het op een andere website staat. Leer van de redenen waarom ze eerdere suggesties hebben afgewezen.",
    "- De url moet de advertentie van dat ene huis zijn, geen zoekresultatenpagina of overzicht. Heb je alleen een zoekresultaat, zoek dan de advertentie bij de makelaar of een andere site.",
    "- Neem gegevens (prijs, m², slaapkamers) over zoals ze in de advertentie staan; laat een veld leeg (null) als je het niet zeker weet. Verzin niets.",
    "- Werk efficiënt: ongeveer 15 tot 30 zoekopdrachten en alleen de pagina's openen die er echt toe doen. Vul geen formulieren in en log nergens in.",
    "- Schrijf 'waarom' en 'twijfels' in het Nederlands, kort en concreet, en verwijs naar punten uit het profiel.",
    `- ${CHECKS_INSTRUCTIONS}`,
    "",
    ...(limits.length
      ? [
          ...travelSection(limits),
          "Gebruik de reistijden om te bepalen waar je zoekt: bedenk eerst welke steden, dorpen en wijken binnen alle reistijden vallen (ook kleinere plaatsen en plaatsen buiten het zoekgebied uit het profiel) en zoek daar. Zoek een verbinding op als je twijfelt. Sla huizen over die duidelijk niet voldoen.",
          "",
        ]
      : []),
    ...(instructions ? ["## Extra instructies van hen", instructions, ""] : []),
    ...zonesSection(zones),
    ...(await makelaarsSection()),
    ...(await searchIdeasSection(fundaSearchUrl)),
    ...profileLines,
    `## Huizen op hun bord (${houses.length})`,
    ...houses.map((h) => `- ${h.address}, ${h.city ?? "?"}${h.price ? `, € ${h.price}` : ""} (${h.ratings}) ${h.url}`),
    "",
    `## Eerdere suggesties (${previous.length})`,
    ...previous.map(
      (s) =>
        `- ${s.address}, ${s.city ?? "?"} [${s.status}${s.reject_reason ? `: "${s.reject_reason}"` : ""}] ${s.url}`,
    ),
  ];
  return lines.join("\n");
}

// ---------- Claude Code ----------

/** Run Claude Code headless with only the given tools; resolves with its schema-validated output. */
function runClaude(prompt, { schema, tools, cwd = process.env.AGENT_WORKDIR ?? "/work", timeoutMs = RUN_TIMEOUT_MS }) {
  const args = [
    "-p",
    "--output-format", "json",
    "--json-schema", JSON.stringify(schema),
    // Removes shell/code tools and ignores settings files; only the tools listed here exist
    "--restricted",
    "--tools", tools.join(","),
    "--allowedTools", tools.join(","),
    "--permission-prompts", "none",
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd,
      // Only what Claude Code needs; in particular no DATABASE_URL and no API key
      // (an ANTHROPIC_API_KEY would take precedence over the subscription token)
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        // macOS keeps the Claude login in the keychain, which needs USER (local testing)
        ...(process.env.USER && { USER: process.env.USER }),
        ...(process.env.CLAUDE_CODE_OAUTH_TOKEN && { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN }),
        DISABLE_UPDATES: "1",
        DISABLE_AUTOUPDATER: "1",
        DISABLE_TELEMETRY: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Claude deed er te lang over en is gestopt."));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        return reject(new Error(`Claude Code gaf geen geldige uitvoer (exit ${code}): ${(stderr || stdout).slice(0, 500)}`));
      }
      if (result.is_error || !result.structured_output) {
        return reject(new Error(`Claude Code: ${String(result.result ?? result.subtype ?? "onbekende fout").slice(0, 500)}`));
      }
      log(`claude finished: ${result.num_turns ?? "?"} turns, ${Math.round((result.duration_ms ?? 0) / 1000)}s`);
      resolve(result.structured_output);
    });
    child.stdin.end(prompt);
  });
}

// ---------- Funda checks ----------

// Funda's own status text, e.g. "Beschikbaar", "Onder bod", "Verkocht onder voorbehoud"
const isAvailable = (status) => !status || /^beschikbaar$/i.test(status.trim());
const isFundaUrl = (url) => new URL(url).hostname.endsWith("funda.nl");

/** Ask our pyfunda service (funda-service/) for a listing; null when that isn't possible. */
async function fundaListing(url) {
  try {
    const res = await fetch(`${FUNDA_SERVICE_URL}/listing?id=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(20_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Suggestions that were still for sale when found may be sold by now: take those off the list. */
async function recheckFundaSuggestions() {
  const open = await sql`select id, url from suggestions where status = 'nieuw' and url like 'https://www.funda.nl/%'`;
  let removed = 0;
  for (const s of open) {
    const listing = await fundaListing(s.url);
    if (!listing) continue;
    const status = isAvailable(listing.status) ? "nieuw" : "niet_beschikbaar";
    if (status !== "nieuw") removed++;
    await sql`
      update suggestions set
        listing = ${sql.json(listing)},
        status = ${status},
        address = coalesce(${listing.address}, address),
        city = coalesce(${listing.city}, city),
        price = coalesce(${listing.price}, price),
        living_area = coalesce(${listing.livingArea}, living_area),
        bedrooms = coalesce(${listing.bedrooms}, bedrooms),
        image_url = coalesce(${listing.photos?.[0] ?? null}, image_url),
        updated_at = now()
      where id = ${s.id}`;
  }
  if (open.length) log(`rechecked ${open.length} Funda suggestions, ${removed} no longer available`);
}

// ---------- Saving ----------

/** The agent's estimates matched to our limits. */
function travelTimes(s, limits) {
  return limits.map((l, i) => {
    const estimate = (s.reistijden ?? []).find((r) => r.eis === i + 1);
    return { label: l.label, mode: l.mode, minutes: toInt(estimate?.minuten), maxMinutes: l.maxMinutes };
  });
}

// Same rule as the suggestions page (src/lib/travel.ts)
const tooFar = (times) => times.some((t) => t.minutes != null && t.minutes > t.maxMinutes * TRAVEL_MARGIN);

/**
 * Who gets asked to open an ad Claude couldn't: whoever pressed "Nu zoeken", otherwise whoever
 * forwards the alert mails (they handle those requests already).
 */
async function detailsUser(runId) {
  const [row] = await sql`
    select coalesce(
      (select requested_by from agent_runs where id = ${runId}),
      (select received_by from suggestions where received_by is not null group by received_by order by count(*) desc limit 1)
    ) as id`;
  return row?.id ?? null;
}

async function saveSuggestions(runId, output, limits) {
  const known = await sql`
    select url, lower(address) || '|' || lower(coalesce(city, '')) as key from houses
    union all
    select url, lower(address) || '|' || lower(coalesce(city, '')) from suggestions`;
  const urls = new Set(known.map((k) => k.url));
  const keys = new Set(known.map((k) => k.key));
  let saved = 0;

  for (const s of output.suggestions ?? []) {
    let url;
    try {
      url = normalizeUrl(s.url);
      if (!/^https?:$/.test(new URL(url).protocol)) continue;
    } catch {
      continue;
    }
    // Search result pages are useless as a link to one house
    if (/\/(zoeken|search|zoek)(\/|$|\?)/i.test(new URL(url).pathname)) continue;
    const address = text(s.adres, 200);
    if (!address) continue;
    const key = `${address.toLowerCase()}|${(text(s.plaats, 100) ?? "").toLowerCase()}`;
    if (urls.has(url) || keys.has(key)) continue;

    // Only houses that are still available. Funda links we check ourselves; for other sites
    // we go by what the agent read in the advertisement.
    let listing = null;
    if (isFundaUrl(url)) {
      listing = await fundaListing(url);
      if (listing && !isAvailable(listing.status)) {
        log(`skipped ${address}: ${listing.status} on Funda`);
        continue;
      }
    } else if (s.beschikbaarheid !== "beschikbaar" && s.beschikbaarheid !== "onbekend") {
      log(`skipped ${address}: ${s.beschikbaarheid}`);
      continue;
    }
    // Claude couldn't open the ad: one of them opens it and sends the page with the bookmarklet (/ontvang)
    const needsDetails = !listing && s.beschikbaarheid === "onbekend";

    const times = travelTimes(s, limits);
    if (tooFar(times)) {
      log(`skipped ${address}: too far`, JSON.stringify(s.reistijden));
      continue;
    }

    let imageUrl = text(s.fotoUrl, 1000);
    try {
      if (imageUrl && new URL(imageUrl).protocol !== "https:") imageUrl = null;
    } catch {
      imageUrl = null;
    }
    const rows = await sql`
      insert into suggestions ${sql({
        runId,
        url,
        source: text(s.bron, 100) ?? new URL(url).hostname,
        // Funda's data beats what the agent pieced together from search results
        address: listing?.address ?? address,
        city: listing?.city ?? text(s.plaats, 100),
        price: listing?.price ?? toInt(s.vraagprijs),
        livingArea: listing?.livingArea ?? toInt(s.woonoppervlak),
        bedrooms: listing?.bedrooms ?? toInt(s.slaapkamers),
        imageUrl: listing?.photos?.[0] ?? imageUrl,
        score: Math.min(10, Math.max(1, toInt(s.score) ?? 5)),
        reason: text(s.waarom) ?? "",
        concerns: text(s.twijfels),
        listing: listing && sql.json(listing),
        travelTimes: times.length ? sql.json(times) : null,
        needsDetails,
        receivedBy: needsDetails ? await detailsUser(runId) : null,
        checks: cleanChecks(s.kenmerken) && sql.json(cleanChecks(s.kenmerken)),
      }, "runId", "url", "source", "address", "city", "price", "livingArea", "bedrooms", "imageUrl", "score", "reason", "concerns", "listing", "travelTimes", "needsDetails", "receivedBy", "checks")}
      on conflict (url) do nothing
      returning id`;
    if (rows.length) {
      saved++;
      urls.add(url);
      keys.add(key);
    }
  }
  return saved;
}

async function saveSearchIdeas(runId, ideas) {
  const known = new Set((await sql`select url from search_ideas`).map((i) => i.url));
  let saved = 0;
  for (const idea of (ideas ?? []).slice(0, 3)) {
    let url;
    try {
      url = new URL(idea.fundaUrl.trim());
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.hostname !== "www.funda.nl" || !url.pathname.startsWith("/zoeken/")) continue;
    const title = text(idea.titel, 200);
    if (!title || known.has(url.toString())) continue;
    await sql`insert into search_ideas ${sql({ runId, title, reason: text(idea.waarom, 1000) ?? "", url: url.toString() })}`;
    known.add(url.toString());
    saved++;
  }
  return saved;
}

// ---------- Inbox: Funda search alerts ----------

/** Listing ids in a Funda alert. Links may be URL-encoded inside tracking links, so decode first. */
function fundaIdsFromMail(mail) {
  let body = `${mail.text}\n${mail.html}`.replace(/&amp;/g, "&");
  for (let i = 0; i < 2; i++) {
    try {
      body = decodeURIComponent(body);
    } catch {
      body = body.replace(/%2F/gi, "/").replace(/%3A/gi, ":");
    }
  }
  const ids = new Set();
  // e.g. funda.nl/detail/koop/rotterdam/huis-straat-12/43123456/ or the older funda.nl/koop/rotterdam/huis-43123456-straat-12/
  for (const m of body.matchAll(/funda\.nl\/(?:detail\/)?koop\/[^\s"'<>]*?(?:[/-])(\d{7,9})(?=[/?#"'<>\s-]|$)/g)) ids.add(m[1]);
  return [...ids].slice(0, 50);
}

/** A page as plain text. With `links`, link and image addresses stay in, so Claude can tell which link belongs to which house. */
function htmlAsText(html, { links = true } = {}) {
  return html
    .replace(/<(style|script|head|noscript|svg)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, links ? "$&" : "")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      if (!links) return " ";
      const src = tag.match(/\b(?:data-src|data-lazy-src|src)="([^"]+)"/i)?.[1];
      return src && !src.startsWith("data:") ? ` [foto: ${src}] ` : " ";
    })
    .replace(/<a\b[^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, links ? " $2 [link: $1] " : " $2 ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/td|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&euro;/g, "€")
    .replace(/&sup2;/g, "²")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

const mailAsText = (mail) => (mail.html ? htmlAsText(mail.html) : (mail.text ?? "")).slice(0, 60_000);

const SITE_NAMES = { pararius: "Pararius", huislijn: "Huislijn" };
const SITE_HOSTS = { pararius: "pararius.nl", huislijn: "huislijn.nl" };

/**
 * Alert links go through the mailer's click tracking (url2220.pararius.nl/ls/click?…), and Pararius' links log you
 * in automatically. Follow only the tracking hops (never the site itself) to the listing, and drop the query, where
 * the login sits. Null when that doesn't work (Pararius' tracking domain blocks us too); the caller then keeps the
 * tracking link but marks it, so only the person whose mail it was gets to see it.
 */
async function listingUrlFromAlert(raw, site) {
  let url = new URL(raw);
  const onSite = (u) => u.hostname === SITE_HOSTS[site] || u.hostname === `www.${SITE_HOSTS[site]}`;
  for (let hop = 0; hop < 4 && !onSite(url); hop++) {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "manual", headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
      const location = res.headers.get("location");
      if (!location) return null;
      url = new URL(location, url);
    } catch {
      return null;
    }
  }
  if (!onSite(url)) return null;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * A Pararius or Huislijn alert: Claude reads the houses from the mail (we can't open their pages).
 * Also a page someone sent with the "Stuur naar …" bookmarklet (kind "pagina"), stored the same way by the app.
 */
async function processAlertMail(mail) {
  const site = mail.kind;
  const isPage = site === "pagina";
  const prompt = [
    isPage
      ? "Hieronder staat de tekst van een webpagina met de advertentie van één koophuis, die iemand vanuit de browser naar ons heeft gestuurd. Haal dat ene huis eruit (geen 'vergelijkbare woningen' of andere huizen op de pagina), met als url het adres van de pagina. Neem gegevens precies over zoals ze op de pagina staan en laat een veld leeg (null) als het er niet staat; verzin niets. Staat er geen koophuis op de pagina, geef dan een lege lijst."
      : `Hieronder staat een e-mailmelding van ${SITE_NAMES[site]} met nieuwe koophuizen uit een bewaarde zoekopdracht, doorgestuurd via Gmail. Haal elk huis eruit dat te koop wordt aangeboden. Neem gegevens precies over zoals ze in de e-mail staan en laat een veld leeg (null) als het er niet in staat; verzin niets. Sla advertenties, tips en huizen die verkocht of verhuurd zijn over. Geen huizen? Geef dan een lege lijst.`,
    "",
    `Onderwerp: ${mail.subject ?? ""}`,
    "",
    mailAsText(mail),
  ].join("\n");
  const output = await runClaude(prompt, { schema: ALERT_SCHEMA, tools: [], timeoutMs: 5 * 60_000 });
  const [recipient] = mail.to_address ? await sql`select id from users where lower(email) = ${mail.to_address}` : [];

  const known = await sql`
    select url, lower(address) || '|' || lower(coalesce(city, '')) as key from houses
    union all
    select url, lower(address) || '|' || lower(coalesce(city, '')) from suggestions`;
  const urls = new Set(known.map((k) => k.url));
  const keys = new Set(known.map((k) => k.key));
  let found = 0;
  for (const h of (output.huizen ?? []).slice(0, isPage ? 1 : 50)) {
    let url;
    let loginLink = false;
    try {
      url = normalizeUrl(h.url);
      if (new URL(url).protocol !== "https:") continue;
      if (!isPage) {
        const resolved = await listingUrlFromAlert(url, site);
        // Huislijn links point straight at the listing; a Pararius tracking link may log you in
        loginLink = !resolved && site === "pararius";
        url = resolved ?? url;
      }
    } catch {
      continue;
    }
    const address = text(h.adres, 200);
    if (!address) continue;
    const key = `${address.toLowerCase()}|${(text(h.plaats, 100) ?? "").toLowerCase()}`;
    if (isPage && keys.has(key)) {
      // A page about a suggestion we already have (e.g. the makelaar's page of a Huislijn house): add what it says
      const updated = await sql`
        update suggestions set
          listing = coalesce(listing, '{}'::jsonb) || ${sql.json({ description: text(mail.text, 8000) })},
          needs_details = false, score = null, reason = '', updated_at = now()
        where status = 'nieuw' and lower(address) || '|' || lower(coalesce(city, '')) = ${key}
        returning id`;
      found += updated.length;
      continue;
    }
    if (urls.has(url) || keys.has(key)) continue;
    let imageUrl = text(h.fotoUrl, 1000);
    try {
      if (imageUrl && new URL(imageUrl).protocol !== "https:") imageUrl = null;
    } catch {
      imageUrl = null;
    }
    // Same field names as a Funda listing, so describeListing works for both
    const listing = {
      address,
      city: text(h.plaats, 100),
      postcode: text(h.postcode, 20),
      houseType: text(h.type, 100),
      price: toInt(h.vraagprijs),
      livingArea: toInt(h.woonoppervlak),
      plotArea: toInt(h.perceel),
      rooms: toInt(h.kamers),
      bedrooms: toInt(h.slaapkamers),
      // From a page we have the whole advertisement; the rating can use all of it
      description: isPage ? text(mail.text, 8000) : text(h.omschrijving),
      ...(loginLink && { loginLink: true }),
    };
    const rows = await sql`
      insert into suggestions ${sql({
        url,
        source: isPage ? mail.from_address : site,
        address,
        city: listing.city,
        price: listing.price,
        livingArea: listing.livingArea,
        bedrooms: listing.bedrooms,
        imageUrl,
        reason: "",
        listing: sql.json(listing),
        receivedBy: recipient?.id ?? null,
      }, "url", "source", "address", "city", "price", "livingArea", "bedrooms", "imageUrl", "reason", "listing", "receivedBy")}
      on conflict (url) do nothing
      returning id`;
    if (rows.length) {
      found++;
      urls.add(url);
      keys.add(key);
    }
  }
  log(`inbox: ${site} mail ${mail.id}, ${output.huizen?.length ?? 0} houses, ${found} new`);
  return { found, error: output.huizen?.length ? null : "Geen huizen gevonden in deze e-mail" };
}

async function processInbox() {
  const mails = await sql`select id, kind, from_address, to_address, subject, text, html from inbound_emails where processed_at is null order by id limit 10`;
  for (const mail of mails) {
    let found = 0;
    let error = null;
    if (mail.kind === "funda") {
      const ids = fundaIdsFromMail(mail);
      if (ids.length === 0) error = "Geen huizen gevonden in deze e-mail";
      for (const id of ids) {
        const url = `https://www.funda.nl/detail/${id}`;
        const [known] = await sql`select 1 from houses where url = ${url} union all select 1 from suggestions where url = ${url} limit 1`;
        if (known) continue;
        const listing = await fundaListing(url);
        if (!listing) {
          log(`inbox: could not fetch ${url}`);
          continue;
        }
        if (!isAvailable(listing.status)) continue;
        const rows = await sql`
          insert into suggestions ${sql({
            url,
            source: "funda",
            address: text(listing.address, 200) ?? `Funda ${id}`,
            city: listing.city,
            price: toInt(listing.price),
            livingArea: toInt(listing.livingArea),
            bedrooms: toInt(listing.bedrooms),
            imageUrl: listing.photos?.[0] ?? null,
            reason: "",
            listing: sql.json(listing),
          }, "url", "source", "address", "city", "price", "livingArea", "bedrooms", "imageUrl", "reason", "listing")}
          on conflict (url) do nothing
          returning id`;
        found += rows.length;
      }
      log(`inbox: mail ${mail.id}, ${ids.length} listings, ${found} new`);
    } else if (mail.kind === "pararius" || mail.kind === "huislijn" || mail.kind === "pagina") {
      try {
        ({ found, error } = await processAlertMail(mail));
      } catch (e) {
        // Leave it for the next tick, e.g. when the Claude usage limit is reached
        log(`inbox: mail ${mail.id} failed`, e);
        continue;
      }
    }
    await sql`update inbound_emails set processed_at = now(), found = ${found}, error = ${error} where id = ${mail.id}`;
  }

  // Alerts can come in several mails at once ("direct"): rate in one batch once it's been quiet for a bit
  await sql`
    insert into agent_runs (kind)
    select 'rate'
    where exists (select 1 from suggestions where status = 'nieuw' and score is null)
      and not exists (select 1 from suggestions where status = 'nieuw' and score is null and created_at > now() - interval '3 minutes')
      and not exists (select 1 from agent_runs where kind = 'rate' and status in ('queued', 'running'))`;
}

// ---------- Rating ----------

const RATE_BATCH = 25;

function describeListing(n, s, zones = []) {
  const l = s.listing ?? {};
  const facts = [
    l.houseType,
    l.price && `€ ${l.price}`,
    l.livingArea && `${l.livingArea} m² wonen`,
    l.plotArea && `${l.plotArea} m² perceel`,
    l.rooms && `${l.rooms} kamers`,
    l.bedrooms && `${l.bedrooms} slaapkamers`,
    l.yearBuilt && `bouwjaar ${l.yearBuilt}`,
    l.energyLabel && `energielabel ${l.energyLabel}`,
  ].filter(Boolean);
  const where = [s.address, l.postcode, l.neighbourhood, s.city].filter(Boolean).join(", ");
  const lat = s.lat ?? l.latitude;
  const lng = s.lng ?? l.longitude;
  const coords = lat && lng ? ` (${lat.toFixed(4)}, ${lng.toFixed(4)})` : "";
  const place = zoneOf(lat ?? null, lng ?? null, zones);
  return [
    `### Huis ${n}: ${where}${coords} (via ${s.source})`,
    facts.join(" · "),
    place && `Ligging t.o.v. hun kaart: ${describeZone(place)}`,
    l.highlight && `Kort: ${l.highlight}`,
    l.description && `Omschrijving: ${l.description.replace(/\s+/g, " ").slice(0, 4000)}`,
    "",
  ].filter(Boolean);
}

// Alert mails (Huislijn especially) give little more than address and price; Claude looks the house up elsewhere
const DETAILS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["huizen"],
  properties: {
    huizen: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "gevonden", "url", "beschikbaarheid", "type", "woonoppervlak", "perceel", "kamers", "slaapkamers", "bouwjaar", "energielabel", "fotoUrl", "samenvatting"],
        properties: {
          id: { type: "integer", description: "Het nummer van het huis" },
          gevonden: { type: "boolean", description: "Heb je de advertentie van precies dit huis gevonden en kunnen lezen?" },
          url: { type: ["string", "null"], description: "De pagina waar je de gegevens vond" },
          beschikbaarheid: { type: "string", enum: ["beschikbaar", "onder bod", "onder optie", "verkocht onder voorbehoud", "verkocht", "onbekend"] },
          type: { type: ["string", "null"], description: "Bv. 'twee-onder-een-kapwoning', 'hoekwoning', 'appartement'" },
          woonoppervlak: { type: ["integer", "null"] },
          perceel: { type: ["integer", "null"] },
          kamers: { type: ["integer", "null"] },
          slaapkamers: { type: ["integer", "null"] },
          bouwjaar: { type: ["integer", "null"] },
          energielabel: { type: ["string", "null"] },
          fotoUrl: { type: ["string", "null"], description: "Directe link naar een foto van dit huis, alleen als je die zeker weet" },
          samenvatting: { type: ["string", "null"], description: "In je eigen woorden, hooguit 800 tekens: indeling, staat, tuin, parkeren, ligging en wat opvalt" },
        },
      },
    },
  },
};

const UNAVAILABLE = new Set(["onder bod", "onder optie", "verkocht onder voorbehoud", "verkocht"]);

/** New listings often aren't in search engines on day one: one more try a day later for the ones still waiting on us. */
async function retryDetails() {
  const waiting = await sql`
    select id, url, address, city, source, listing from suggestions
    where status = 'nieuw' and needs_details and created_at < now() - interval '20 hours' limit 25`;
  await lookUpDetails(waiting, { retry: true });
}

/** Look up houses we know little about; the ones Claude can't find are flagged for whoever got the alert. */
async function lookUpDetails(items, { retry = false } = {}) {
  // An alert's one-liner ("106 m² · 5 kamers") isn't an advertisement yet
  const thin = (l) => (l.description ?? "").length < 300;
  const sparse = items.filter((s) => s.listing && thin(s.listing) && (retry ? !s.listing.lookedUpAgain : !s.listing.lookedUp));
  if (!sparse.length) return;
  const prompt = [
    `Van de ${sparse.length} koophuizen hieronder weten we alleen wat in een e-mailmelding stond. Zoek per huis de advertentie op internet (WebSearch) en lees die (WebFetch), bij voorkeur op de website van de makelaar: Funda, Pararius, Huislijn en Jaap blokkeren het openen van pagina's, maar hun zoekresultaten mogen je wel op weg helpen naar de makelaar. Neem gegevens over zoals ze in de advertentie staan; laat een veld leeg (null) als je het niet zeker weet en verzin niets. Zet 'gevonden' alleen op true als je zeker weet dat het om precies dit huis gaat. Werk efficiënt: hooguit een paar zoekopdrachten per huis.`,
    "",
    "Staat er geen huisnummer bij, gebruik dan de postcode en de andere kenmerken om het huis te vinden.",
    "",
    ...sparse.map((s, i) => {
      const l = s.listing;
      const facts = [l.postcode, l.price && `vraagprijs € ${l.price}`, l.livingArea && `${l.livingArea} m²`, l.rooms && `${l.rooms} kamers`, l.houseType]
        .filter(Boolean)
        .join(", ");
      // Never hand Claude a link that logs in to someone's account
      return `${i + 1}. ${s.address}, ${s.city ?? "?"}${facts ? ` (${facts})` : ""}; melding van ${s.source}${l.loginLink ? "" : `: ${s.url}`}`;
    }),
  ].join("\n");
  let output;
  try {
    output = await runClaude(prompt, { schema: DETAILS_SCHEMA, tools: ["WebSearch", "WebFetch"], timeoutMs: 15 * 60_000 });
  } catch (error) {
    // Rate them on what we have; next time it's tried again
    log("details lookup failed", error.message);
    return;
  }
  for (const [i, s] of sparse.entries()) {
    const d = output.huizen?.find((h) => toInt(h.id) === i + 1);
    const found = !!d?.gevonden;
    let imageUrl = found ? text(d.fotoUrl, 1000) : null;
    try {
      if (imageUrl && new URL(imageUrl).protocol !== "https:") imageUrl = null;
    } catch {
      imageUrl = null;
    }
    const fill = (key, value) => (s.listing[key] == null && value != null ? { [key]: value } : {});
    s.listing = {
      ...s.listing,
      lookedUp: true,
      ...(retry && { lookedUpAgain: true }),
      ...(found && {
        ...fill("houseType", text(d.type, 100)),
        ...fill("livingArea", toInt(d.woonoppervlak)),
        ...fill("plotArea", toInt(d.perceel)),
        ...fill("rooms", toInt(d.kamers)),
        ...fill("bedrooms", toInt(d.slaapkamers)),
        ...fill("yearBuilt", toInt(d.bouwjaar)),
        ...fill("energyLabel", text(d.energielabel, 10)),
        description: [s.listing.description, text(d.samenvatting, 1500)].filter(Boolean).join("\n\n"),
        detailsUrl: text(d.url, 1000),
      }),
    };
    const unavailable = found && UNAVAILABLE.has(d.beschikbaarheid);
    await sql`
      update suggestions set
        listing = ${sql.json(s.listing)},
        living_area = coalesce(living_area, ${s.listing.livingArea ?? null}),
        bedrooms = coalesce(bedrooms, ${s.listing.bedrooms ?? null}),
        image_url = coalesce(image_url, ${imageUrl}),
        needs_details = ${!found},
        status = ${unavailable ? "niet_beschikbaar" : sql`status`},
        -- Found on the second try: rate again with the new facts
        score = ${retry && found ? null : sql`score`},
        updated_at = now()
      where id = ${s.id}`;
    if (unavailable) s.unavailable = true;
  }
  log(`details lookup: ${output.huizen?.filter((h) => h.gevonden).length ?? 0} of ${sparse.length} found`);
}

async function processRateRun(runId) {
  log(`rate run ${runId}: started`);
  try {
    const area = await loadSearchArea();
    await locateSuggestions().catch((error) => log(`rate run ${runId}: locating failed`, error));
    let items = await sql`
      select id, url, address, city, source, listing, lat, lng from suggestions
      where status = 'nieuw' and score is null order by id limit ${RATE_BATCH}`;
    await lookUpDetails(items);
    items = items.filter((s) => !s.unavailable);
    if (items.length === 0) {
      await sql`update agent_runs set status = 'done', found = 0, finished_at = now() where id = ${runId}`;
      return;
    }
    const { lines: profileLines } = await profileSection();
    const rejected = await sql`
      select address, city, reject_reason from suggestions where status = 'afgewezen' and reject_reason is not null
      order by updated_at desc limit 30`;
    const prompt = [
      `Hieronder staan ${items.length} huizen die net nieuw te koop staan binnen de bewaarde zoekopdrachten (Funda, Pararius of Huislijn) of op de website van een makelaar in hun zoekgebied staan, van een stel dat een koophuis zoekt. Beoordeel elk huis op hoe goed het bij hun profiel past, alleen op basis van de gegevens hier (je hebt geen internet nodig). Van sommige huizen is weinig bekend: noem in de twijfels wat er ontbreekt en wees dan voorzichtig met een hoge score. Wees kritisch: de filters van de zoekopdrachten zijn ruim, het profiel is preciezer. Gebruik de hele schaal; een 8 of hoger alleen als het echt goed past.`,
      "Schrijf 'waarom' en 'twijfels' kort en concreet in het Nederlands. Geef elk huis precies één beoordeling, met het nummer van het huis als id.",
      CHECKS_INSTRUCTIONS,
      "Staat bij een huis de ligging t.o.v. hun kaart: 'In ...' en tot 2 km erbuiten is prima; verder buiten hun gebieden of in een gebied dat ze niet willen weegt zwaar mee.",
      "",
      ...travelSection(area.limits),
      ...zonesSection(area.zones),
      ...(area.instructions ? ["## Extra instructies van hen", area.instructions, ""] : []),
      ...profileLines,
      ...(rejected.length
        ? ["## Eerder afgewezen, met reden", ...rejected.map((r) => `- ${r.address}, ${r.city ?? "?"}: "${r.reject_reason}"`), ""]
        : []),
      "## De huizen",
      ...items.flatMap((s, i) => describeListing(i + 1, s, area.zones)),
    ].join("\n");

    const output = await runClaude(prompt, { schema: RATE_SCHEMA, tools: [], timeoutMs: 10 * 60_000 });
    let rated = 0;
    for (const r of output.beoordelingen ?? []) {
      const item = items[toInt(r.id) - 1];
      if (!item) continue;
      const times = travelTimes(r, area.limits);
      await sql`
        update suggestions set
          score = ${Math.min(10, Math.max(1, toInt(r.score) ?? 5))},
          reason = ${text(r.waarom) ?? ""},
          concerns = ${text(r.twijfels)},
          travel_times = ${times.length ? sql.json(times) : null},
          checks = ${cleanChecks(r.kenmerken) && sql.json(cleanChecks(r.kenmerken))},
          run_id = ${runId},
          updated_at = now()
        where id = ${item.id} and score is null`;
      rated++;
    }
    await sql`update agent_runs set status = 'done', found = ${rated}, finished_at = now() where id = ${runId}`;
    log(`rate run ${runId}: rated ${rated} of ${items.length}`);
  } catch (error) {
    log(`rate run ${runId}: failed`, error);
    await sql`
      update agent_runs set status = 'failed', error = ${String(error.message ?? error).slice(0, 1000)}, finished_at = now()
      where id = ${runId}`;
  }
}

// ---------- Layout ----------

const LAYOUT_PROMPT = `Je krijgt de plattegronden van één huis dat een stel overweegt te kopen, als afbeeldingen in deze map, met per verdieping een lijst van ruimtes en hun oppervlakte. Bekijk elke afbeelding (Read) en beschrijf de indeling kort en concreet in het Nederlands, zodat ze huizen kunnen vergelijken en later kunnen zeggen wat ze wel en niet fijn vinden aan een indeling.

- Beschrijf hoe de ruimtes ten opzichte van elkaar liggen en hoe je ze bereikt (via hal, overloop, door een andere kamer).
- Benoem dingen die voor wonen uitmaken: open of dichte keuken (als dat te zien is), doorloopkamers, ligging van badkamer en toilet, bergruimte, hoe bruikbaar een zolder lijkt.
- De plattegronden zijn getekend uit makelaarsgegevens: dikke donkere lijnen = muren, een wit gat in een muur = deur of doorgang, blauw = raam. Verzin niets wat je niet kunt zien; noem iets onzeker als het onduidelijk is.
- Gebruik voor elke verdieping precies de naam uit de lijst hieronder.`;

async function processLayoutRun(runId, houseId) {
  log(`layout run ${runId} (house ${houseId}): started`);
  const dir = await mkdtemp(path.join(tmpdir(), "layout-"));
  try {
    const floors = await sql`select name, rooms, svg from floorplans where house_id = ${houseId} order by position`;
    if (floors.length === 0) throw new Error("Dit huis heeft geen plattegronden.");
    const lines = [LAYOUT_PROMPT, ""];
    for (const [i, f] of floors.entries()) {
      const file = `verdieping-${i + 1}.png`;
      // ~1000px is enough to read the room labels
      await writeFile(
        path.join(dir, file),
        await sharp(Buffer.from(f.svg)).resize({ width: 1000, height: 1000, fit: "inside" }).png().toBuffer(),
      );
      const rooms = f.rooms.map((r) => `${r.name} ${r.area} m²`).join(", ") || "geen namen";
      lines.push(`- ${f.name}: ${file} (ruimtes: ${rooms})`);
    }
    const layout = await runClaude(lines.join("\n"), { schema: LAYOUT_SCHEMA, tools: ["Read"], cwd: dir, timeoutMs: 10 * 60_000 });
    await sql`update houses set layout = ${sql.json(layout)} where id = ${houseId}`;
    await sql`update agent_runs set status = 'done', finished_at = now() where id = ${runId}`;
    log(`layout run ${runId}: done`);
  } catch (error) {
    log(`layout run ${runId}: failed`, error);
    await sql`
      update agent_runs set status = 'failed', error = ${String(error.message ?? error).slice(0, 1000)}, finished_at = now()
      where id = ${runId}`;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------- Makelaars ----------

// Identify ourselves honestly, with a link to the app, so a makelaar knows who's visiting (APP_NAME/APP_URL from .env)
const BOT_NAME = (process.env.APP_NAME ?? "").replace(/[^A-Za-z0-9-]/g, "") || "Huizenjacht";
const USER_AGENT = `${BOT_NAME}/1.0 (+${process.env.APP_URL ?? "http://localhost:3000"}; persoonlijke huizenzoektocht, 1x per dag)`;
const MAX_DETAIL_PAGES = 60; // per run; the rest waits for the next day
const robotsCache = new Map();
let lastFetchAt = 0;

/** robots.txt rule as a regex: `*` is a wildcard, a trailing `$` anchors. */
function robotsPattern(rule) {
  const anchored = rule.endsWith("$");
  const body = (anchored ? rule.slice(0, -1) : rule).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** robots.txt check for our user agent (or *): the longest matching rule wins, Allow on a tie. */
async function allowedByRobots(url) {
  const { origin, pathname, search } = new URL(url);
  if (!robotsCache.has(origin)) {
    const rules = [];
    try {
      const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        let applies = false;
        let inAgents = false; // consecutive User-agent lines form one group
        for (const raw of (await res.text()).split("\n")) {
          const [, key, value] = raw.replace(/#.*/, "").trim().match(/^([\w-]+)\s*:\s*(.*)$/) ?? [];
          if (!key) continue;
          if (/^user-agent$/i.test(key)) {
            const match = value === "*" || value.toLowerCase().includes(BOT_NAME.toLowerCase());
            applies = inAgents ? applies || match : match;
            inAgents = true;
            continue;
          }
          inAgents = false;
          if (applies && /^(dis)?allow$/i.test(key) && value) rules.push({ allow: /^allow$/i.test(key), length: value.length, pattern: robotsPattern(value) });
        }
      }
    } catch {
      // No robots.txt (or it doesn't load): allowed
    }
    robotsCache.set(origin, rules);
  }
  const target = pathname + search;
  const matching = robotsCache.get(origin).filter((r) => r.pattern.test(target));
  if (!matching.length) return true;
  const best = matching.reduce((a, b) => (b.length > a.length || (b.length === a.length && b.allow) ? b : a));
  return best.allow;
}

/** Fetch a page from this server, politely: robots.txt, an honest user agent, one request at a time. */
async function fetchPage(url) {
  if (!(await allowedByRobots(url))) return { error: "robots.txt staat het niet toe", blocked: true };
  const wait = lastFetchAt + 1500 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html", "accept-language": "nl-NL,nl;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const html = await res.text();
    // Only real bot walls; plenty of sites have a reCAPTCHA on their contact form
    if ([401, 403, 429].includes(res.status) || /<title>(Just a moment|Attention Required)|cf-chl-/i.test(html.slice(0, 5000))) {
      return { error: `Geblokkeerd (${res.status})`, blocked: true };
    }
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { html, url: res.url || url };
  } catch (e) {
    return { error: e.name === "TimeoutError" ? "Duurde te lang" : String(e.message ?? e).slice(0, 200) };
  }
}

const PAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["paginas"],
  properties: {
    paginas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pagina", "huizen"],
        properties: {
          pagina: { type: "integer", description: "Het nummer van de pagina" },
          huizen: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["url", "adres", "plaats", "inDeBuurt", "status", "type", "vraagprijs", "woonoppervlak", "fotoUrl"],
              properties: {
                url: { type: "string", description: "Link naar de pagina van dit huis, precies zoals op de pagina (mag relatief zijn)" },
                adres: { type: "string", description: "Straat en huisnummer" },
                plaats: { type: ["string", "null"] },
                inDeBuurt: { type: "boolean", description: "Ligt de plaats in of vlak bij het zoekgebied (zie boven)?" },
                status: { type: "string", enum: ["te koop", "onder bod", "onder optie", "verkocht onder voorbehoud", "verkocht", "onbekend"] },
                type: { type: ["string", "null"], description: "Bv. 'twee-onder-een-kapwoning', 'appartement', 'bouwgrond'" },
                vraagprijs: { type: ["integer", "null"] },
                woonoppervlak: { type: ["integer", "null"], description: "m²" },
                fotoUrl: { type: ["string", "null"], description: "Link naar de foto van dit huis, mag relatief zijn" },
              },
            },
          },
        },
      },
    },
  },
};

/** Places in our Funda search plus the places we travel to; makelaar pages can cover the whole country. */
function searchPlaces(area) {
  let selected = [];
  try {
    selected = (new URL(area.fundaSearchUrl).searchParams.get("selected_area") ?? "").split(",").filter(Boolean).map((p) => p.replace(/-/g, " "));
  } catch {
    // no Funda search saved
  }
  return { selected, destinations: area.limits.map((l) => `${l.label} (${l.address})`) };
}

// "CAPELLE AAN DEN IJSSEL" -> "Capelle aan den IJssel"; leaves normal spelling alone
const tidyPlace = (place) =>
  place && place === place.toUpperCase()
    ? place
        .toLowerCase()
        .replace(/(^|[\s-])(\p{L})/gu, (m) => m.toUpperCase())
        .replace(/(?<=\s)(Aan|Den|De|Het|Op|In|Bij|Onder|En)(?=\s)/g, (w) => w.toLowerCase())
        .replace(/\bIj/g, "IJ")
    : place;

/** The hard filters of our Funda search, so we only rate houses that would also have come through Funda. */
function searchFilters(fundaSearchUrl) {
  let params;
  try {
    params = new URL(fundaSearchUrl).searchParams;
  } catch {
    return { maxPrice: null, minArea: null, housesOnly: false, noMidTerrace: false };
  }
  const [, maxPrice] = (params.get("price") ?? "").split("-").map((v) => (v ? Number(v) : null));
  const [minArea] = (params.get("floor_area") ?? "").split("-").map((v) => (v ? Number(v) : null));
  return {
    // Deliberately loose: Claude's rating is the real filter, this only drops what's clearly out of reach
    maxPrice: maxPrice ? maxPrice * 1.15 : null,
    minArea: minArea ? minArea * 0.75 : null,
    housesOnly: (params.get("object_type") ?? "").split(",").every((t) => t === "house"),
    // Funda's house types are chosen one by one; a mid-terrace house isn't in our list
    noMidTerrace: !!params.get("object_type_house_orientation") && !/(^|,)(terraced|row|mid_terrace)(,|$)/.test(params.get("object_type_house_orientation")),
  };
}

const NOT_A_HOUSE = /appartement|bovenwoning|benedenwoning|portiek|flat|penthouse|maisonnette|studio|bouwgrond|kavel|garage(box)?$|parkeerplaats|bedrijf|winkel|kantoor/i;

function passesFilters(h, f) {
  if (!h.inDeBuurt) return false;
  if (h.status !== "te koop" && h.status !== "onbekend") return false;
  if (h.vraagprijs != null && f.maxPrice && h.vraagprijs > f.maxPrice) return false;
  if (h.woonoppervlak != null && f.minArea && h.woonoppervlak < f.minArea) return false;
  if (f.housesOnly && h.type && NOT_A_HOUSE.test(h.type)) return false;
  if (f.noMidTerrace && h.type && /tussenwoning|tussenhuis/i.test(h.type)) return false;
  return true;
}

async function saveMakelaars(list) {
  const known = await sql`select listings_url from makelaars`;
  const hosts = new Set(known.map((m) => new URL(m.listings_url).hostname.replace(/^www\./, "")));
  let added = 0;
  for (const m of (list ?? []).slice(0, 25)) {
    let url;
    try {
      url = new URL(m.aanbodUrl.trim());
    } catch {
      continue;
    }
    url.hash = "";
    const host = url.hostname.replace(/^www\./, "");
    // The big portals block us and come in by mail already
    if (!/^https?:$/.test(url.protocol) || /(^|\.)(funda|pararius|huislijn|jaap|huizenzoeker)\.nl$/.test(host) || hosts.has(host)) continue;
    const name = text(m.naam, 200);
    if (!name) continue;
    const rows = await sql`
      insert into makelaars ${sql(
        { name, listingsUrl: url.toString(), places: text(m.plaatsen, 300) ?? "", unverified: m.geopend !== true },
        "name", "listingsUrl", "places", "unverified",
      )}
      on conflict (listings_url) do nothing returning id`;
    if (rows.length) {
      hosts.add(host);
      added++;
    }
  }
  return added;
}

const absolute = (raw, base) => {
  try {
    const url = new URL(raw, base);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
};

/** Read every active makelaar's listings page (changed ones only) and add new houses that fit our search. */
async function crawlMakelaars(runId, area) {
  const makelaars = await sql`
    select id, name, listings_url, last_hash from makelaars
    where status = 'actief'
      or (status in ('leeg', 'geblokkeerd') and (last_checked_at is null or last_checked_at < now() - interval '7 days'))
    order by last_checked_at nulls first, id`;
  if (!makelaars.length) return { checked: 0, found: 0 };

  // 1. Fetch the pages (our server, not Claude)
  const pages = [];
  for (const m of makelaars) {
    const page = await fetchPage(m.listings_url);
    if (page.error) {
      await sql`
        update makelaars set last_checked_at = now(), last_error = ${page.error},
          status = ${page.blocked ? "geblokkeerd" : sql`status`}
        where id = ${m.id}`;
      continue;
    }
    const body = htmlAsText(page.html).slice(0, 40_000);
    const hash = createHash("sha256").update(body).digest("hex");
    if (hash === m.last_hash) {
      await sql`update makelaars set last_checked_at = now(), last_error = null where id = ${m.id}`;
      continue;
    }
    pages.push({ makelaar: m, url: page.url, body, hash });
  }
  log(`makelaars: ${makelaars.length} checked, ${pages.length} changed`);

  // 2. Claude reads the houses from the changed pages, a few pages per call
  const filters = searchFilters(area.fundaSearchUrl);
  const places = searchPlaces(area);
  const whereLines = [
    "Zoekgebied: " + (places.selected.length ? places.selected.join(", ") : "(geen plaatsen opgegeven)") + ", plus plaatsen die daar vlak naast liggen (een buurdorp of kern net over de gemeentegrens, binnen zo'n 10 tot 15 km).",
    ...(places.destinations.length ? [`Ze willen ook binnen redelijke reistijd zitten van: ${places.destinations.join("; ")}.`] : []),
    "Zet 'inDeBuurt' op true voor huizen in het zoekgebied of in zo'n buurplaats, anders op false. Twijfel je, kies dan true.",
  ];
  const candidates = [];
  const complete = new Map(); // page -> all its candidates handled, so the hash can be saved
  for (let i = 0; i < pages.length; ) {
    const batch = [];
    let size = 0;
    while (i < pages.length && (batch.length === 0 || size + pages[i].body.length < 120_000) && batch.length < 8) {
      size += pages[i].body.length;
      batch.push(pages[i++]);
    }
    const prompt = [
      "Hieronder staan aanbodpagina's van makelaars, als tekst. Haal van elke pagina alle huizen eruit die te koop worden aangeboden, ook verkochte (met de juiste status), maar geen huurwoningen. Neem gegevens precies over zoals ze op de pagina staan en laat een veld leeg (null) als het er niet staat; verzin niets. Een pagina zonder huizen (bv. een gewone homepage, of het aanbod laadt niet) krijgt een lege lijst.",
      "",
      ...whereLines,
      "",
      ...batch.flatMap((p, n) => [`### Pagina ${n + 1}: ${p.makelaar.name} (${p.url})`, p.body, ""]),
    ].join("\n");
    let output;
    try {
      output = await runClaude(prompt, { schema: PAGE_SCHEMA, tools: [], timeoutMs: 10 * 60_000 });
    } catch (error) {
      log("makelaars: reading pages failed", error.message);
      continue;
    }
    for (const [n, p] of batch.entries()) {
      const houses = output.paginas?.find((r) => r.pagina === n + 1)?.huizen ?? [];
      await sql`
        update makelaars set last_checked_at = now(), last_count = ${houses.length}, last_error = null,
          status = ${houses.length ? "actief" : "leeg"},
          unverified = ${houses.length ? false : sql`unverified`}
        where id = ${p.makelaar.id}`;
      complete.set(p, true);
      for (const h of houses) {
        if (!passesFilters(h, filters)) continue;
        const url = absolute(h.url, p.url);
        if (!url || url === p.url) continue;
        candidates.push({ ...h, url: normalizeUrl(url), fotoUrl: h.fotoUrl && absolute(h.fotoUrl, p.url), page: p });
      }
    }
  }

  // 3. New ones: fetch the house's own page for the full description, then queue for rating
  const known = await sql`
    select url, lower(address) || '|' || lower(coalesce(city, '')) as key from houses
    union all
    select url, lower(address) || '|' || lower(coalesce(city, '')) from suggestions`;
  const urls = new Set(known.map((k) => k.url));
  const keys = new Set(known.map((k) => k.key));
  let found = 0;
  let details = 0;
  for (const h of candidates) {
    const address = text(h.adres, 200);
    if (!address) continue;
    const city = tidyPlace(text(h.plaats, 100));
    const key = `${address.toLowerCase()}|${(city ?? "").toLowerCase()}`;
    if (urls.has(h.url) || keys.has(key)) continue;
    if (details >= MAX_DETAIL_PAGES) {
      complete.set(h.page, false); // look at this page again tomorrow
      continue;
    }
    details++;
    const page = await fetchPage(h.url);
    const description = page.html ? htmlAsText(page.html, { links: false }).slice(0, 8000) : null;
    const listing = {
      address,
      city,
      houseType: text(h.type, 100),
      price: toInt(h.vraagprijs),
      livingArea: toInt(h.woonoppervlak),
      description,
    };
    const rows = await sql`
      insert into suggestions ${sql({
        runId,
        url: h.url,
        source: h.page.makelaar.name,
        address,
        city: listing.city,
        price: listing.price,
        livingArea: listing.livingArea,
        imageUrl: h.fotoUrl?.startsWith("https:") ? h.fotoUrl : null,
        reason: "",
        listing: sql.json(listing),
      }, "runId", "url", "source", "address", "city", "price", "livingArea", "imageUrl", "reason", "listing")}
      on conflict (url) do nothing
      returning id`;
    if (rows.length) {
      found++;
      urls.add(h.url);
      keys.add(key);
    }
  }
  for (const [p, done] of complete) if (done) await sql`update makelaars set last_hash = ${p.hash} where id = ${p.makelaar.id}`;
  log(`makelaars: ${candidates.length} candidates, ${found} new`);
  return { checked: makelaars.length, found };
}

// ---------- Main loop ----------

// ---------- Profile proposals ----------

const PROPOSALS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["voorstellen"],
  properties: {
    voorstellen: {
      type: "array",
      description: "Hooguit 5 aanpassingen van hun profiel; leeg als er niets nieuws uit blijkt",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sectie", "tekst", "wie", "onderbouwing"],
        properties: {
          sectie: { type: "string", enum: ["mustHaves", "voorkeuren", "dealbreakers", "zoekgebied"] },
          tekst: { type: "string", description: "Kort en toetsbaar, zoals de punten in het profiel, bv. 'Niet in Nieuwegein of IJsselstein'" },
          wie: { type: "string", description: "'samen' of de naam van wie het geldt" },
          onderbouwing: { type: "string", description: "1-2 zinnen: uit welke afwijzingen of reacties dit blijkt (noem adressen)" },
        },
      },
    },
  },
};

const MIN_NEW_REJECTIONS = 3;

/** After a few new rejections, let Claude propose profile changes; one of them accepts or declines each on the profile page. */
async function proposeProfileChanges() {
  await sql`insert into search_settings (id) values (1) on conflict do nothing`;
  const [settings] = await sql`select proposals_at from search_settings where id = 1`;
  const since = settings.proposals_at ?? new Date(0);
  const [{ n }] = await sql`
    select count(*)::int as n from suggestions
    where status = 'afgewezen' and reject_reason is not null and updated_at > ${since}`;
  if (n < MIN_NEW_REJECTIONS) return 0;

  const { users, lines: profileLines } = await profileSection();
  const rejected = await sql`
    select s.address, s.city, s.price, s.reject_reason, s.updated_at > ${since} as recent, u.name
    from suggestions s left join users u on u.id = s.rejected_by
    where s.status = 'afgewezen' and s.reject_reason is not null order by s.updated_at`;
  const comments = await sql`
    select h.address, u.name, c.kind, c.body from comments c join houses h on h.id = c.house_id join users u on u.id = c.user_id
    order by c.created_at desc limit 40`;
  const earlier = await sql`select section, text, status from profile_proposals order by id`;
  const prompt = [
    `Je helpt ${users.map((u) => u.name).join(" en ")} een koophuis te vinden. Hieronder staan hun profiel, de huizen die ze afwezen met hun reden, en hun reacties op huizen.`,
    "Stel aanpassingen van het profiel voor die uit die afwijzingen en reacties blijken maar nog niet (of te vaag) in het profiel staan. Een beter profiel geeft betere suggesties. Let vooral op wat vaker terugkomt, op plaatsen en wijken die ze niet willen (sectie 'zoekgebied' of 'dealbreakers'), en op eisen die strenger of juist ruimer blijken dan in het profiel staat.",
    "Regels: alleen wat echt uit hun woorden blijkt, niets verzinnen. Niet opnieuw voorstellen wat ze al afwezen, tenzij er duidelijk nieuw bewijs is. Geen dubbele punten met het profiel. Hooguit 5 voorstellen, de belangrijkste eerst; nul is prima. Schrijf in het Nederlands.",
    "",
    ...profileLines,
    "## Afgewezen huizen (* = nieuw sinds de vorige voorstellen)",
    ...rejected.map((r) => `- ${r.recent ? "* " : ""}${r.address}, ${r.city ?? "?"}${r.price ? `, € ${r.price}` : ""}: "${r.reject_reason}"${r.name ? ` (${r.name})` : ""}`),
    "",
    ...(comments.length ? ["## Reacties op huizen op hun bord", ...comments.map((c) => `- ${c.address}, ${c.name} (${c.kind}): ${c.body}`), ""] : []),
    ...(earlier.length ? ["## Eerdere voorstellen", ...earlier.map((e) => `- [${e.status}] ${e.section}: ${e.text}`), ""] : []),
  ].join("\n");

  const output = await runClaude(prompt, { schema: PROPOSALS_SCHEMA, tools: [], timeoutMs: 10 * 60_000 });
  const names = new Set(["samen", ...users.map((u) => u.name)]);
  const known = new Set(earlier.map((e) => e.text.trim().toLowerCase()));
  let added = 0;
  for (const v of (output.voorstellen ?? []).slice(0, 5)) {
    const proposal = text(v.tekst, 300);
    if (!proposal || known.has(proposal.toLowerCase()) || !PROPOSALS_SCHEMA.properties.voorstellen.items.properties.sectie.enum.includes(v.sectie)) continue;
    await sql`
      insert into profile_proposals ${sql(
        { section: v.sectie, text: proposal, who: names.has(v.wie) ? v.wie : "samen", reason: text(v.onderbouwing, 1000) ?? "" },
        "section", "text", "who", "reason",
      )}`;
    known.add(proposal.toLowerCase());
    added++;
  }
  await sql`update search_settings set proposals_at = now() where id = 1`;
  return added;
}

async function processRun(runId) {
  log(`run ${runId}: started`);
  let found = 0;
  const notes = [];
  let failure = null;
  const area = await loadSearchArea();
  try {
    await recheckFundaSuggestions();
    const prompt = await buildPrompt(area);
    const output = await runClaude(prompt, { schema: SUGGESTIONS_SCHEMA, tools: ["WebSearch", "WebFetch"] });
    found += await saveSuggestions(runId, output, area.limits);
    if (area.fundaSearchUrl) await saveSearchIdeas(runId, output.zoekideeen);
    const added = await saveMakelaars(output.makelaars);
    if (text(output.notities)) notes.push(text(output.notities));
    if (added) notes.push(`${added} nieuwe makelaars op de lijst gezet.`);
  } catch (error) {
    log(`run ${runId}: search failed`, error);
    failure = error;
  }
  await retryDetails().catch((error) => log(`run ${runId}: details retry failed`, error));
  await locateSuggestions().catch((error) => log(`run ${runId}: locating failed`, error));
  // Also when Claude's search failed: this part mostly runs on our own server
  try {
    const crawl = await crawlMakelaars(runId, area);
    found += crawl.found;
    if (crawl.checked) notes.push(`Makelaars: ${crawl.checked} aanbodpagina's bekeken, ${crawl.found} nieuwe huizen die in de zoekopdracht passen.`);
  } catch (error) {
    log(`run ${runId}: makelaars failed`, error);
    failure ??= error;
  }
  try {
    const proposed = await proposeProfileChanges();
    if (proposed) notes.push(`${proposed} voorstel${proposed === 1 ? "" : "len"} om jullie profiel aan te passen (zie Profiel).`);
  } catch (error) {
    log(`run ${runId}: profile proposals failed`, error);
  }
  if (failure && found === 0) {
    await sql`
      update agent_runs set status = 'failed', error = ${String(failure.message ?? failure).slice(0, 1000)}, finished_at = now()
      where id = ${runId}`;
    return;
  }
  await sql`
    update agent_runs set status = 'done', found = ${found}, notes = ${notes.join("\n\n") || null}, finished_at = now()
    where id = ${runId}`;
  log(`run ${runId}: done, ${found} new suggestions`);
}

async function tickSuggestions() {
  await queueDailyRun();
  const run = await claimRun("suggestions");
  if (run) await processRun(run.id);
}

async function tickRate() {
  await processInbox();
  const run = await claimRun("rate");
  if (run) await processRateRun(run.id);
}

async function tickLayout() {
  const run = await claimRun("layout");
  if (run) await processLayoutRun(run.id, run.houseId);
}

if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) log("warning: CLAUDE_CODE_OAUTH_TOKEN is not set; runs will fail");
// A run that was in progress when we stopped will never finish
await sql`update agent_runs set status = 'failed', error = 'Onderbroken door een herstart', finished_at = now() where status = 'running'`
  .catch((e) => log("startup cleanup skipped:", e.message));
log("agent worker started");
await recheckFundaSuggestions().catch((e) => log("recheck skipped:", e.message));

// Separate lanes, so describing a floor plan or rating alert houses doesn't wait behind a 15-minute search
async function loop(name, tick) {
  for (;;) {
    try {
      await tick();
    } catch (error) {
      // e.g. the app hasn't run its migrations yet
      log(`${name} tick failed:`, error.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

await Promise.all([loop("suggestions", tickSuggestions), loop("layout", tickLayout), loop("rate", tickRate)]);

import { and, desc, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import Link from "next/link";
import { APP_NAME } from "@/lib/app-name";
import { makelaarProblem } from "@/lib/makelaars";
import {
  AutoRefresh,
  DetailsRequest,
  FetchFundaButton,
  FundaSearchForm,
  MakelaarCheck,
  Makelaars,
  SearchAreaPanel,
  SearchButton,
  SearchIdeaActions,
  SearchInstructions,
  SuggestionActions,
  SuggestionFilters,
  TravelLimits,
} from "@/components/suggestion-controls";
import { db, schema } from "@/db";
import type { TravelTime } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDate, formatPrice } from "@/lib/format";
import { loadZones, viewSuggestion, type ViewedSuggestion } from "@/lib/suggestion-view";
import { formatMinutes, isTooFar, TRAVEL_MODES } from "@/lib/travel";
import { describeZone } from "@/lib/zones";

// Below this, a house goes into "Minder passend" instead of the main list
const GOOD_SCORE = 6;

function RunStatus({ run }: { run: typeof schema.agentRuns.$inferSelect | undefined }) {
  if (!run) return <>Nog niet gezocht. Claude zoekt elke ochtend automatisch, of druk op &ldquo;Nu zoeken&rdquo;.</>;
  if (run.status === "queued") return <>Zoektocht staat klaar en begint zo…</>;
  if (run.status === "running") return <>Claude zoekt sinds {formatDate(run.startedAt!)}. Dit duurt meestal 5 tot 15 minuten.</>;
  if (run.status === "failed")
    return (
      <span className="text-red-600">
        Laatste zoektocht ({formatDate(run.createdAt)}) mislukte: {run.error}
      </span>
    );
  return (
    <>
      Laatst gezocht {formatDate(run.finishedAt!)} · {run.found} nieuw{run.found === 1 ? "e suggestie" : "e suggesties"}
      {run.notes && (
        <details className="mt-1">
          <summary className="cursor-pointer">Wat heeft Claude gedaan?</summary>
          <span className="block italic">{run.notes}</span>
        </details>
      )}
    </>
  );
}

function TravelTimes({ times }: { times: TravelTime[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5 text-xs" title="Geschatte reistijd door Claude">
      {times.map((t) => {
        const over = t.minutes != null && t.minutes > t.maxMinutes;
        return (
          <li
            key={`${t.label}-${t.mode}`}
            className={`rounded-full px-2 py-0.5 ${over ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" : "bg-stone-100 dark:bg-stone-800"}`}
          >
            {TRAVEL_MODES[t.mode].icon} {t.label}: {t.minutes == null ? "onbekend" : `± ${formatMinutes(t.minutes)}`}
            {over && ` (max ${formatMinutes(t.maxMinutes)})`}
          </li>
        );
      })}
    </ul>
  );
}

type Suggestion = typeof schema.suggestions.$inferSelect;

function ZoneLabel({ place }: { place: NonNullable<ViewedSuggestion["place"]> }) {
  const tone =
    place.kind === "uitgesloten" || place.kind === "buiten"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
      : "bg-stone-100 dark:bg-stone-800";
  return <span className={`rounded-full px-2 py-0.5 ${tone}`}>📍 {describeZone(place)}</span>;
}

const CHECK_ICON = { ja: "✅", nee: "❌", onbekend: "❔" } as const;

function Checks({ checks }: { checks: NonNullable<Suggestion["checks"]> }) {
  return (
    <ul className="flex flex-wrap gap-1.5 text-xs">
      {checks.map((c, i) => (
        <li
          key={i}
          title={c.toelichting}
          className={`rounded-full px-2 py-0.5 ${
            c.past === "nee" && c.zeker
              ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
              : c.past === "ja"
                ? "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
                : "bg-stone-100 dark:bg-stone-800"
          }`}
        >
          {CHECK_ICON[c.past]} {c.eis}
          {c.past === "nee" && !c.zeker && " (vermoedelijk)"}
        </li>
      ))}
    </ul>
  );
}

/** The link to the advertisement, or null when it's someone else's Pararius login link (see SuggestionListingExtras). */
function viewerLink(s: Suggestion, viewerId: number) {
  const link = s.listing?.loginLink && s.receivedBy !== viewerId ? null : `${s.url.split("#")[0]}#suggestie=${s.id}`;
  return link;
}

function SuggestionCard({ s, link, receiver }: { s: ViewedSuggestion; link: string | null; receiver?: string }) {
  const isFunda = new URL(s.url).hostname.endsWith("funda.nl");
  return (
    <li className="card flex flex-col overflow-hidden">
      {s.imageUrl &&
        (link ? (
          <a href={link} target="_blank" rel="noreferrer" title={`Bekijk op ${s.source}`}>
            <img src={s.imageUrl} alt="" className="aspect-[2/1] w-full object-cover" loading="lazy" />
          </a>
        ) : (
          <img src={s.imageUrl} alt="" className="aspect-[2/1] w-full object-cover" loading="lazy" />
        ))}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold leading-tight">{s.address}</p>
            <p className="text-sm text-stone-500">
              {[s.city, formatPrice(s.price), s.livingArea && `${s.livingArea} m²`, s.bedrooms && `${s.bedrooms} slpk`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <span
            className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-sm font-semibold text-white dark:bg-accent-night"
            title="Hoe goed past dit huis bij jullie profiel"
          >
            {s.shownScore}/10
          </span>
        </div>
        {s.lowered.length > 0 && (
          <p className="text-xs text-stone-500">
            Claude gaf een {s.score}, lager gezet omdat: {s.lowered.join("; ")}.
          </p>
        )}
        {(s.place || (s.travelTimes && s.travelTimes.length > 0)) && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {s.place && <ZoneLabel place={s.place} />}
            {s.travelTimes && s.travelTimes.length > 0 && <TravelTimes times={s.travelTimes} />}
          </div>
        )}
        {s.checks && s.checks.length > 0 && <Checks checks={s.checks} />}
        <p className="text-sm">{s.reason}</p>
        {s.concerns && <p className="text-sm text-stone-500">⚠️ {s.concerns}</p>}
        {s.listing?.status && <p className="text-sm font-medium">Status op Funda: {s.listing.status}</p>}
        {isFunda && !s.listing && <FetchFundaButton id={s.id} />}
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" className="text-sm underline">
            Bekijk op {s.source} ↗
          </a>
        ) : (
          <p className="text-sm text-stone-500">De link staat in de mail van {receiver ?? "degene die de melding kreeg"} (hij logt in op diens {s.source}).</p>
        )}
        <div className="mt-auto pt-1">
          <SuggestionActions id={s.id} />
        </div>
      </div>
    </li>
  );
}

const SORTS: Record<string, (a: ViewedSuggestion, b: ViewedSuggestion) => number> = {
  nieuw: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  "prijs-op": (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  "prijs-af": (a, b) => (b.price ?? -1) - (a.price ?? -1),
  m2: (a, b) => (b.livingArea ?? -1) - (a.livingArea ?? -1),
};
const byScore = (a: ViewedSuggestion, b: ViewedSuggestion) =>
  (b.shownScore ?? 0) - (a.shownScore ?? 0) || b.createdAt.getTime() - a.createdAt.getTime();

export default async function SuggestionsPage({ searchParams }: PageProps<"/suggesties">) {
  const user = await requireUser();
  const params = await searchParams;
  const param = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const [lastRun] = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.kind, "suggestions"))
    .orderBy(desc(schema.agentRuns.id))
    .limit(1);
  const rated = await db
    .select()
    .from(schema.suggestions)
    .where(and(eq(schema.suggestions.status, "nieuw"), isNotNull(schema.suggestions.score)))
    .orderBy(desc(schema.suggestions.score), desc(schema.suggestions.createdAt));
  const zones = await loadZones();
  const viewed = rated.map((s) => viewSuggestion(s, zones));
  const cities = [...Map.groupBy(viewed, (s) => s.city ?? "Onbekend")]
    .map(([name, list]) => ({ name, count: list.length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const shown = viewed
    .filter((s) => !param("plaats") || (s.city ?? "Onbekend") === param("plaats"))
    .filter((s) =>
      param("ligging") === "binnen"
        ? s.place?.kind === "binnen" || s.place?.kind === "rand"
        : param("ligging") === "buiten"
          ? s.place?.kind === "buiten" || s.place?.kind === "uitgesloten"
          : true,
    )
    .filter((s) => param("eisen") !== "geen-nee" || !s.checks?.some((c) => c.past === "nee" && c.zeker))
    .sort(SORTS[param("sort")] ?? byScore);
  const filtered = shown.length !== viewed.length;
  const good = shown.filter((s) => s.shownScore! >= GOOD_SCORE && !isTooFar(s.travelTimes));
  const weaker = shown.filter((s) => !good.includes(s));
  const unrated = await db.$count(schema.suggestions, and(eq(schema.suggestions.status, "nieuw"), isNull(schema.suggestions.score)));
  const ideas = await db.select().from(schema.searchIdeas).where(eq(schema.searchIdeas.status, "nieuw")).orderBy(desc(schema.searchIdeas.id));
  const limits = await db.select().from(schema.travelLimits).orderBy(schema.travelLimits.label, schema.travelLimits.id);
  const [settings] = await db.select().from(schema.searchSettings);
  // Switched-off ones at the bottom
  const makelaars = (await db.select().from(schema.makelaars).orderBy(schema.makelaars.name)).sort(
    (a, b) => Number(a.status === "uit") - Number(b.status === "uit"),
  );
  const makelaarChecks = makelaars.flatMap((m) => {
    const problem = makelaarProblem(m);
    return problem ? [{ ...m, problem }] : [];
  });
  const names = new Map((await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)).map((u) => [u.id, u.name]));
  // Houses Claude couldn't look up, for whoever got the alert in their mailbox
  const detailRequests = await db
    .select()
    .from(schema.suggestions)
    .where(
      and(
        eq(schema.suggestions.status, "nieuw"),
        eq(schema.suggestions.needsDetails, true),
        or(eq(schema.suggestions.receivedBy, user.id), isNull(schema.suggestions.receivedBy)),
      ),
    )
    .orderBy(desc(schema.suggestions.id));
  const busy = lastRun?.status === "queued" || lastRun?.status === "running";
  const removed = await db.$count(
    schema.suggestions,
    and(
      eq(schema.suggestions.status, "niet_beschikbaar"),
      gt(schema.suggestions.updatedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    ),
  );

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={busy || unrated > 0} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold">Suggesties</h1>
          <div className="text-sm text-stone-500">
            <RunStatus run={lastRun} />
            {unrated > 0 && (
              <p className="mt-1">
                🔎 {unrated} {unrated === 1 ? "nieuw huis" : "nieuwe huizen"} uit jullie zoekopdrachten {unrated === 1 ? "wordt" : "worden"} beoordeeld…
              </p>
            )}
            {removed > 0 && (
              <p className="mt-1">
                {removed} suggestie{removed === 1 ? "" : "s"} deze week weggehaald omdat ze verkocht of onder bod zijn.
              </p>
            )}
          </div>
        </div>
        <SearchButton busy={busy} />
      </div>

      {detailRequests.length > 0 && (
        <section className="card flex flex-col gap-4 border-amber-300 p-5 dark:border-amber-700">
          <div>
            <h2 className="font-semibold">🔔 Wil je {detailRequests.length === 1 ? "dit huis" : "deze huizen"} even openen?</h2>
            <p className="text-sm text-stone-500">
              Claude kon de advertentie niet openen, dus het weet nog niet alles (bv. of het huis nog te koop is, slaapkamers,
              parkeren). Open de link en tik op
              de bladwijzer <Link href="/ontvang" className="underline">Stuur naar {APP_NAME}</Link>, of plak de kenmerken en
              omschrijving hieronder. Daarna wordt het huis opnieuw beoordeeld.
            </p>
          </div>
          <ul className="flex flex-col gap-4">
            {detailRequests.map((s) => (
              <li key={s.id} className="flex flex-col gap-2">
                <p className="text-sm">
                  <strong>{s.address}</strong>
                  {[s.city, formatPrice(s.price), s.score != null && `nu ${s.score}/10`].filter(Boolean).map((v) => ` · ${v}`)}{" "}
                  {/* #suggestie=<id> survives on that site's page, so the bookmarklet knows which suggestion it is */}
                  {viewerLink(s, user.id) && (
                    <a href={viewerLink(s, user.id)!} target="_blank" rel="noreferrer" className="underline">
                      Open op {s.source} ↗
                    </a>
                  )}
                </p>
                <DetailsRequest id={s.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {makelaarChecks.length > 0 && (
        <section className="card flex flex-col gap-4 border-amber-300 p-5 dark:border-amber-700">
          <div>
            <h2 className="font-semibold">🔗 Klopt de link van {makelaarChecks.length === 1 ? "deze makelaar" : "deze makelaars"}?</h2>
            <p className="text-sm text-stone-500">
              De app leest elke dag de pagina waar een makelaar al zijn koophuizen laat zien, maar hier is niet zeker dat het
              de goede pagina is. Zoek op hun website de pagina met het koopaanbod en plak die link hier.
            </p>
          </div>
          <ul className="flex flex-col gap-5">
            {makelaarChecks.map((m) => (
              <li key={m.id}>
                <MakelaarCheck id={m.id} name={m.name} listingsUrl={m.listingsUrl} places={m.places} problem={m.problem} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <SearchAreaPanel
        initiallyOpen={limits.length === 0 && !settings?.instructions && !settings?.fundaSearchUrl}
        summary={
          <>
            Waar zoeken?{" "}
            <span className="font-normal text-stone-500">
              {[
                limits.length > 0 ? `${limits.length} reistijdeis${limits.length === 1 ? "" : "en"}` : "nog geen reistijden",
                settings?.fundaSearchUrl && "Funda-zoekopdracht",
                makelaars.length > 0 && `${makelaars.filter((m) => m.status !== "uit").length} makelaars`,
                settings?.instructions && "eigen instructies",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </>
        }
      >
        <div className="mt-4 flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Reistijden</h2>
            <p className="text-sm text-stone-500">
              Claude zoekt alleen huizen die aan alle reistijden voldoen, ook in plaatsen die niet in jullie zoekgebied staan maar
              er dichtbij liggen. Auto is met gemiddeld verkeer, OV deur tot deur op een gewone werkdag.
            </p>
            <TravelLimits limits={limits} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Funda-zoekopdracht</h2>
            <p className="text-sm text-stone-500">
              Nieuwe huizen uit jullie bewaarde zoekopdracht komen per e-mail binnen en worden door Claude beoordeeld. Claude stelt
              ook aanpassingen van de zoekopdracht voor.
            </p>
            <FundaSearchForm url={settings?.fundaSearchUrl ?? ""} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Makelaars ({makelaars.filter((m) => m.status !== "uit").length})</h2>
            <p className="text-sm text-stone-500">
              Bij de dagelijkse zoektocht kijkt de app op de website van deze makelaars naar nieuwe huizen die in jullie
              Funda-zoekopdracht passen. Claude vult de lijst zelf aan met makelaars in en rond jullie zoekgebied.
            </p>
            <Makelaars makelaars={makelaars} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Zelf een advertentie doorsturen</h2>
            <p className="text-sm text-stone-500">
              Zie je ergens een huis dat de app niet kan openen (Huislijn, Pararius, een makelaar)? Met de bladwijzer{" "}
              <Link href="/ontvang" className="underline">Stuur naar {APP_NAME}</Link> stuur je die pagina met één tik naar Claude.
            </p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Extra instructies voor Claude</h2>
            <SearchInstructions instructions={settings?.instructions ?? ""} />
          </section>
        </div>
      </SearchAreaPanel>

      {ideas.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Zoekideeën voor Funda</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {ideas.map((idea) => (
              <li key={idea.id} className="card flex flex-col gap-2 p-4">
                <p className="font-medium">💡 {idea.title}</p>
                <p className="text-sm text-stone-600 dark:text-stone-400">{idea.reason}</p>
                <a href={idea.url} target="_blank" rel="noreferrer" className="text-sm underline">
                  Open deze zoekopdracht op Funda ↗
                </a>
                <SearchIdeaActions id={idea.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {viewed.length > 0 && (
        <div className="flex flex-col gap-1">
          <SuggestionFilters cities={cities} hasZones={zones.length > 0} />
          {filtered && (
            <p className="text-sm text-stone-500">
              {shown.length} van de {viewed.length} suggesties
            </p>
          )}
        </div>
      )}

      {good.length === 0 ? (
        <div className="card p-10 text-center text-stone-500">
          {busy ? "🔎 Even geduld, Claude is aan het zoeken." : filtered ? "Geen goede suggesties met deze filters." : "Geen nieuwe suggesties."}
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {good.map((s) => (
            <SuggestionCard key={s.id} s={s} link={viewerLink(s, user.id)} receiver={names.get(s.receivedBy ?? 0)} />
          ))}
        </ul>
      )}

      {weaker.length > 0 && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-sm text-stone-500">
            {weaker.length} minder passend{weaker.length === 1 ? " huis" : "e huizen"} (lage score, te ver weg of een zekere ❌)
          </summary>
          <ul className="mt-3 grid gap-4 md:grid-cols-2">
            {weaker.map((s) => (
              <SuggestionCard key={s.id} s={s} link={viewerLink(s, user.id)} receiver={names.get(s.receivedBy ?? 0)} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

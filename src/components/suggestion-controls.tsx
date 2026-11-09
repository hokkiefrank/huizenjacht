"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  acceptSuggestion,
  addMakelaar,
  addTravelLimit,
  confirmMakelaar,
  decideSearchIdea,
  deleteTravelLimit,
  dismissDetailsRequest,
  fetchSuggestionFromFunda,
  rejectSuggestion,
  requestSearch,
  saveFundaSearch,
  saveSuggestionDetails,
  saveSearchInstructions,
  setMakelaarActive,
  updateMakelaarUrl,
} from "@/app/actions";
import type { MakelaarStatus, TravelMode } from "@/db/schema";
import { formatMinutes, TRAVEL_MODES } from "@/lib/travel";

export function SearchButton({ busy }: { busy: boolean }) {
  const [state, action, pending] = useActionState(requestSearch, undefined);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <button className="btn" disabled={pending || busy}>
        {busy ? "Claude is aan het zoeken…" : "Nu zoeken"}
      </button>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

/** While a search runs, refresh the page now and then so results show up by themselves. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}

// Tap to fill in the usual reasons; typing more detail is still welcome
const QUICK_REASONS = ["Ligging", "Geen eigen parkeerplaats", "Te veel opknapwerk", "Te klein", "Te duur", "Tussenwoning", "Indeling"];

/** Sort and filter the suggestions; kept in the url so a refresh or the back button keeps them. */
export function SuggestionFilters({ cities, hasZones }: { cities: { name: string; count: number }[]; hasZones: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`?${next.toString()}`, { scroll: false });
  };
  const select = "w-full py-1.5 text-sm sm:w-auto";
  return (
    <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
      <select aria-label="Sorteren" className={select} value={params.get("sort") ?? ""} onChange={(e) => set("sort", e.target.value)}>
        <option value="">Beste eerst</option>
        <option value="nieuw">Nieuwste eerst</option>
        <option value="prijs-op">Prijs oplopend</option>
        <option value="prijs-af">Prijs aflopend</option>
        <option value="m2">Grootste eerst</option>
      </select>
      <select aria-label="Plaats" className={select} value={params.get("plaats") ?? ""} onChange={(e) => set("plaats", e.target.value)}>
        <option value="">Alle plaatsen</option>
        {cities.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name} ({c.count})
          </option>
        ))}
      </select>
      {hasZones && (
        <select aria-label="Ligging" className={select} value={params.get("ligging") ?? ""} onChange={(e) => set("ligging", e.target.value)}>
          <option value="">Overal</option>
          <option value="binnen">In of vlak bij onze gebieden</option>
          <option value="buiten">Buiten onze gebieden</option>
        </select>
      )}
      <select aria-label="Must-haves" className={select} value={params.get("eisen") ?? ""} onChange={(e) => set("eisen", e.target.value)}>
        <option value="">Alle huizen</option>
        <option value="geen-nee">Geen zekere ❌ op must-haves</option>
      </select>
      {params.size > 0 && (
        <button className="px-2 text-sm text-stone-500 underline" onClick={() => router.replace("?", { scroll: false })}>
          Wissen
        </button>
      )}
    </div>
  );
}

export function SuggestionActions({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  if (rejecting) {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(() => rejectSuggestion(id, reason));
        }}
      >
        <div className="flex flex-wrap gap-1.5">
          {QUICK_REASONS.map((r) => {
            const on = reason.toLowerCase().includes(r.toLowerCase());
            return (
              <button
                key={r}
                type="button"
                onClick={() => setReason(on ? reason.replace(new RegExp(`(, )?${r}`, "i"), "").replace(/^, /, "") : reason ? `${reason}, ${r}` : r)}
                className={`rounded-full px-2.5 py-1 text-xs ${on ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "bg-stone-200/60 text-stone-700 dark:bg-stone-800 dark:text-stone-300"}`}
              >
                {r}
              </button>
            );
          })}
        </div>
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Waarom niet? (helpt de volgende zoektocht)"
        />
        <div className="flex gap-2">
          <button className="btn-ghost py-1.5 text-sm" disabled={pending}>
            Niet interessant
          </button>
          <button type="button" className="px-2 text-sm text-stone-500" onClick={() => setRejecting(false)}>
            Annuleren
          </button>
        </div>
      </form>
    );
  }
  return (
    <div className="flex gap-2">
      <button className="btn py-1.5 text-sm" disabled={pending} onClick={() => startTransition(() => acceptSuggestion(id))}>
        Op het bord
      </button>
      <button className="btn-ghost py-1.5 text-sm" disabled={pending} onClick={() => setRejecting(true)}>
        Niet interessant
      </button>
    </div>
  );
}

export function FetchFundaButton({ id }: { id: number }) {
  const [state, action, pending] = useActionState(fetchSuggestionFromFunda.bind(null, id), undefined);
  return (
    <form action={action} className="flex flex-col gap-1">
      <button className="btn-ghost self-start py-1.5 text-sm" disabled={pending}>
        {pending ? "Ophalen…" : "Gegevens ophalen van Funda"}
      </button>
      {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}

/** Opens by itself until something is filled in, then stays however the user left it (refreshes don't snap it shut). */
export function SearchAreaPanel({ initiallyOpen, summary, children }: { initiallyOpen: boolean; summary: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details className="card p-5" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold">{summary}</summary>
      {children}
    </details>
  );
}

type TravelLimit = { id: number; label: string; address: string; mode: TravelMode; maxMinutes: number };

export function TravelLimits({ limits }: { limits: TravelLimit[] }) {
  const [state, action, pending] = useActionState(addTravelLimit, undefined);
  const [deleting, startDelete] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  // Picking a known place fills in its address, so "Werk Alex" can get a second limit quickly
  const addresses = new Map(limits.map((l) => [l.label, l.address]));

  useEffect(() => {
    if (state && !state.error) form.current?.reset();
  }, [state]);

  return (
    <div className="flex flex-col gap-3">
      {limits.length > 0 && (
        <ul className="flex flex-col gap-2">
          {limits.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 rounded-lg bg-stone-100 px-3 py-2 text-sm dark:bg-stone-800">
              <span>
                {TRAVEL_MODES[l.mode].icon} Hooguit <strong>{formatMinutes(l.maxMinutes)}</strong> {TRAVEL_MODES[l.mode].label} naar{" "}
                <strong>{l.label}</strong> <span className="text-stone-500">({l.address})</span>
              </span>
              <button
                disabled={deleting}
                onClick={() => startDelete(() => deleteTravelLimit(l.id))}
                className="shrink-0 text-xs text-stone-400 hover:text-red-600"
              >
                weghalen
              </button>
            </li>
          ))}
        </ul>
      )}
      <form ref={form} action={action} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto_auto_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-sm">
          Plek
          <input
            name="label"
            list="travel-labels"
            required
            placeholder="Werk Alex"
            onChange={(e) => {
              const known = addresses.get(e.target.value);
              const address = e.target.form?.elements.namedItem("address") as HTMLInputElement | null;
              if (known && address && !address.value) address.value = known;
            }}
          />
          <datalist id="travel-labels">
            {[...addresses.keys()].map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Adres of plaats
          <input name="address" required placeholder="Stationsplein 1, Utrecht" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Vervoer
          <select name="mode" defaultValue="ov">
            {Object.entries(TRAVEL_MODES).map(([mode, m]) => (
              <option key={mode} value={mode}>
                {m.icon} {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Max. minuten
          <input name="maxMinutes" type="number" inputMode="numeric" min={5} max={300} step={5} required placeholder="60" className="sm:w-24" />
        </label>
        <button className="btn-ghost py-2 text-sm" disabled={pending}>
          Toevoegen
        </button>
      </form>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </div>
  );
}

export function SearchInstructions({ instructions }: { instructions: string }) {
  const [state, action, pending] = useActionState(saveSearchInstructions, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <textarea
        name="instructions"
        rows={4}
        defaultValue={instructions}
        placeholder="Bv. kijk ook in dorpen rond Amersfoort, liever niet in een nieuwbouwwijk, check ook de sites van lokale makelaars in de Gelderse Vallei…"
      />
      <div className="flex items-center gap-3">
        <button className="btn-ghost py-1.5 text-sm" disabled={pending}>
          {pending ? "Opslaan…" : "Opslaan"}
        </button>
        {state && !pending && <span className="text-sm text-stone-500">Opgeslagen, geldt vanaf de volgende zoektocht</span>}
      </div>
    </form>
  );
}

export function FundaSearchForm({ url }: { url: string }) {
  const [state, action, pending] = useActionState(saveFundaSearch, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input name="url" type="url" defaultValue={url} placeholder="https://www.funda.nl/zoeken/koop?…" className="min-w-0 flex-1" />
        <button className="btn-ghost py-1.5 text-sm" disabled={pending}>
          {pending ? "Opslaan…" : "Opslaan"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state && !state.error && !pending && <p className="text-sm text-stone-500">Opgeslagen</p>}
    </form>
  );
}

export function SearchIdeaActions({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <button className="btn-ghost py-1.5 text-sm" disabled={pending} onClick={() => startTransition(() => decideSearchIdea(id, "toegevoegd"))}>
        Bewaard in Funda
      </button>
      <button className="px-2 text-sm text-stone-500" disabled={pending} onClick={() => startTransition(() => decideSearchIdea(id, "afgewezen"))}>
        Niet interessant
      </button>
    </div>
  );
}

type Makelaar = { id: number; name: string; listingsUrl: string; places: string; status: MakelaarStatus; lastCount: number | null; lastError: string | null };

const MAKELAAR_STATUS: Record<MakelaarStatus, string> = {
  actief: "",
  leeg: "geen huizen op de pagina gevonden",
  geblokkeerd: "blokkeert ons",
  uit: "uit",
};

export function Makelaars({ makelaars }: { makelaars: Makelaar[] }) {
  const [state, action, pending] = useActionState(addMakelaar, undefined);
  const [toggling, startToggle] = useTransition();
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state && !state.error) form.current?.reset();
  }, [state]);

  const shown = showAll ? makelaars : makelaars.slice(0, 8);
  return (
    <div className="flex flex-col gap-3">
      {makelaars.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {shown.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg bg-stone-100 px-3 py-2 dark:bg-stone-800">
              <span className={m.status === "uit" ? "text-stone-400 line-through" : ""}>
                <a href={m.listingsUrl} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                  {m.name}
                </a>
                {m.places && <span className="text-stone-500"> · {m.places}</span>}
                {m.status === "actief" && m.lastCount != null && <span className="text-stone-500"> · {m.lastCount} huizen</span>}
                {m.status !== "actief" && m.status !== "uit" && <span className="text-amber-700 dark:text-amber-400"> · {MAKELAAR_STATUS[m.status]}</span>}
                {m.status === "actief" && m.lastError && <span className="text-amber-700 dark:text-amber-400"> · {m.lastError}</span>}
              </span>
              <button
                disabled={toggling}
                onClick={() => startToggle(() => setMakelaarActive(m.id, m.status === "uit"))}
                className="shrink-0 text-xs text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
              >
                {m.status === "uit" ? "aanzetten" : "uitzetten"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        {makelaars.length > 8 && (
          <button className="text-stone-500 underline" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Minder tonen" : `Alle ${makelaars.length} tonen`}
          </button>
        )}
        {!adding && (
          <button className="text-stone-500 underline" onClick={() => setAdding(true)}>
            Zelf een makelaar toevoegen
          </button>
        )}
      </div>
      {adding && (
        <form ref={form} action={action} className="grid gap-2 sm:grid-cols-[1fr_1.6fr_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-sm">
            Naam
            <input name="name" required placeholder="Van der Panne Makelaars" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Link naar hun koopaanbod
            <input name="listingsUrl" type="url" required placeholder="https://www.makelaar.nl/aanbod/koop" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Plaatsen
            <input name="places" placeholder="Zeist" />
          </label>
          <button className="btn-ghost py-2 text-sm" disabled={pending}>
            Toevoegen
          </button>
        </form>
      )}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </div>
  );
}

/** One makelaar whose listings url needs a human: paste the right one, or say it's fine. */
export function MakelaarCheck({ id, name, listingsUrl, places, problem }: { id: number; name: string; listingsUrl: string; places: string; problem: string }) {
  const [state, action, pending] = useActionState(updateMakelaarUrl.bind(null, id), undefined);
  const [busy, startTransition] = useTransition();
  return (
    <form action={action} className="flex flex-col gap-2">
      <p className="text-sm">
        <strong>{name}</strong>
        {places && <span className="text-stone-500"> · {places}</span>}
        <br />
        <span className="text-stone-500">{problem[0].toUpperCase() + problem.slice(1)}. </span>
        <a href={listingsUrl} target="_blank" rel="noreferrer" className="break-all underline">
          {listingsUrl.replace(/^https?:\/\/(www\.)?/, "")} ↗
        </a>
      </p>
      <input name="listingsUrl" type="url" required placeholder="Plak de link naar de pagina met al hun koophuizen" />
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost py-1.5 text-sm" disabled={pending}>
          {pending ? "Opslaan…" : "Link opslaan"}
        </button>
        <button type="button" className="px-2 text-sm text-stone-500" disabled={busy} onClick={() => startTransition(() => confirmMakelaar(id))}>
          Klopt zo
        </button>
        <button type="button" className="px-2 text-sm text-stone-500" disabled={busy} onClick={() => startTransition(() => setMakelaarActive(id, false))}>
          Uitzetten
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

export function DetailsRequest({ id }: { id: number }) {
  const [state, action, pending] = useActionState(saveSuggestionDetails.bind(null, id), undefined);
  const [dismissing, startDismiss] = useTransition();
  return (
    <form action={action} className="flex flex-col gap-2">
      <textarea name="details" rows={3} placeholder="Plak hier de kenmerken en omschrijving uit de advertentie, dan beoordeelt Claude het huis opnieuw" />
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost py-1.5 text-sm" disabled={pending}>
          {pending ? "Opslaan…" : "Opnieuw beoordelen"}
        </button>
        <button type="button" className="px-2 text-sm text-stone-500" disabled={dismissing} onClick={() => startDismiss(() => dismissDetailsRequest(id))}>
          Niet nodig
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

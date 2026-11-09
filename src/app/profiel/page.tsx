import { asc, eq } from "drizzle-orm";
import { logout } from "@/app/actions";
import { ProposalActions, RegenerateButton, RejectButton, WishesForm } from "@/components/profile-controls";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { formatDate, formatPrice } from "@/lib/format";
import { changesSince, estimateCostUsd, getLatestProfile } from "@/lib/profile";
import type { ProfileItem, ProfileSection } from "@/lib/profile-types";

const SECTIONS: { key: ProfileSection; title: string; emoji: string }[] = [
  { key: "mustHaves", title: "Must-haves", emoji: "✅" },
  { key: "voorkeuren", title: "Voorkeuren", emoji: "💛" },
  { key: "dealbreakers", title: "Dealbreakers", emoji: "⛔" },
];

const PROPOSAL_SECTIONS = { mustHaves: "Must-have", voorkeuren: "Voorkeur", dealbreakers: "Dealbreaker", zoekgebied: "Zoekgebied" };

function Who({ wie }: { wie: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        wie === "samen"
          ? "bg-accent-soft text-accent dark:bg-accent-night-soft dark:text-accent-night-text"
          : "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
      }`}
    >
      {wie}
    </span>
  );
}

function Item({ item, section, index }: { item: ProfileItem; section: ProfileSection; index: number }) {
  return (
    <li className="flex gap-3">
      <div className="flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className={item.zekerheid === "vermoeden" ? "italic" : "font-medium"}>{item.tekst}</span>
          <Who wie={item.wie} />
          {item.zekerheid === "vermoeden" && <span className="text-xs text-stone-500">vermoeden</span>}
        </p>
        <p className="text-sm text-stone-500">{item.onderbouwing}</p>
      </div>
      <RejectButton section={section} index={index} />
    </li>
  );
}

export default async function ProfilePage() {
  const user = await requireUser();
  const [profile, users, proposals] = await Promise.all([
    getLatestProfile(),
    db.select().from(schema.users).orderBy(asc(schema.users.id)),
    db.select().from(schema.profileProposals).where(eq(schema.profileProposals.status, "nieuw")).orderBy(asc(schema.profileProposals.id)),
  ]);
  const changes = profile ? await changesSince(profile.createdAt) : 0;
  const me = users.find((u) => u.id === user.id)!;
  const others = users.filter((u) => u.id !== user.id);
  const p = profile?.content;
  const cost = profile && estimateCostUsd(profile.inputTokens, profile.outputTokens);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Ons profiel</h1>
          <p className="text-sm text-stone-500">
            {profile
              ? [
                  `Bijgewerkt ${formatDate(profile.createdAt)}`,
                  cost != null && `kostte ± $${cost.toFixed(2)}`,
                  changes > 0 ? `${changes} wijzigingen sindsdien` : "up-to-date",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Claude maakt een profiel van jullie wensen, beoordelingen en reacties."}
          </p>
        </div>
        <RegenerateButton hasProfile={!!profile} upToDate={!!profile && changes === 0} />
      </div>

      {proposals.length > 0 && (
        <section className="card flex flex-col gap-4 border-amber-300 p-5 dark:border-amber-700">
          <div>
            <h2 className="font-semibold">💡 Claude stelt voor om jullie profiel aan te passen</h2>
            <p className="text-sm text-stone-500">
              Op basis van de huizen die jullie afwezen en jullie reacties. Wat jullie toevoegen, gebruikt Claude meteen bij het
              zoeken en beoordelen.
            </p>
          </div>
          <ul className="flex flex-col gap-4">
            {proposals.map((pr) => (
              <li key={pr.id} className="flex flex-col gap-2">
                <p>
                  <span className="text-sm text-stone-500">{PROPOSAL_SECTIONS[pr.section]}: </span>
                  <strong>{pr.text}</strong> <Who wie={pr.who} />
                </p>
                {pr.reason && <p className="text-sm text-stone-600 dark:text-stone-400">{pr.reason}</p>}
                <ProposalActions id={pr.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {p && (
        <>
          <section className="card p-5">
            <p className="text-lg leading-relaxed">{p.samenvatting}</p>
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            {SECTIONS.map(({ key, title, emoji }) => (
              <section key={key} className="card flex flex-col gap-3 p-5">
                <h2 className="font-semibold">
                  {emoji} {title}
                </h2>
                {p[key].length === 0 ? (
                  <p className="text-sm text-stone-500">Nog niets bekend.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {p[key].map((item, i) => (
                      <Item key={i} item={item} section={key} index={i} />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="card flex flex-col gap-2 p-5">
              <h2 className="font-semibold">💶 Budget</h2>
              {(p.budget.minPrijs != null || p.budget.maxPrijs != null) && (
                <p className="text-xl font-medium">
                  {formatPrice(p.budget.minPrijs) ?? "?"} – {formatPrice(p.budget.maxPrijs) ?? "?"}
                </p>
              )}
              <p className="text-sm text-stone-600 dark:text-stone-400">{p.budget.samenvatting}</p>
            </section>
            <section className="card flex flex-col gap-2 p-5">
              <h2 className="font-semibold">📍 Zoekgebied</h2>
              <p className="text-sm text-stone-600 dark:text-stone-400">{p.zoekgebied}</p>
            </section>
          </div>

          {p.oneens.length > 0 && (
            <section className="card flex flex-col gap-3 p-5">
              <h2 className="font-semibold">⚖️ Hier denken jullie verschillend over</h2>
              <ul className="flex flex-col gap-4">
                {p.oneens.map((o, i) => (
                  <li key={i} className="flex gap-3">
                    <div className="flex-1">
                      <p className="font-medium">{o.onderwerp}</p>
                      <ul className="mt-1 flex flex-col gap-1">
                        {o.standpunten.map((s, j) => (
                          <li key={j} className="flex items-start gap-2 text-sm">
                            <Who wie={s.wie} />
                            <span className="text-stone-600 dark:text-stone-400">{s.standpunt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <RejectButton section="oneens" index={i} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {p.openVragen.length > 0 && (
            <section className="card flex flex-col gap-2 p-5">
              <h2 className="font-semibold">💬 Om samen over te praten</h2>
              <ul className="list-disc pl-5 text-stone-700 dark:text-stone-300">
                {p.openVragen.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="card flex flex-col gap-4 p-5">
        <div>
          <h2 className="font-semibold">Wat zoek jij?</h2>
          <p className="text-sm text-stone-500">
            In je eigen woorden. Claude combineert dit met jullie beoordelingen en reacties op huizen.
          </p>
        </div>
        <WishesForm wishes={me.wishes} />
        {others.map((o) => (
          <div key={o.id} className="border-t border-stone-200 pt-4 dark:border-stone-800">
            <p className="text-sm font-medium">{o.name} zoekt:</p>
            <p className="whitespace-pre-wrap text-sm text-stone-600 dark:text-stone-400">
              {o.wishes.trim() || "Nog niets ingevuld."}
            </p>
          </div>
        ))}
      </section>

      {/* The header has no room for this on phones */}
      <form action={logout} className="sm:hidden">
        <button className="text-sm text-stone-500">Uitloggen ({me.name})</button>
      </form>
    </div>
  );
}

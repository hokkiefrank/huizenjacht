import Link from "next/link";
import { houseStatus, type HouseStatus } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { agreement, formatPrice, RATING_EMOJI, STATUS_LABELS } from "@/lib/format";
import { listHouses, listUsers } from "@/lib/queries";

const FILTERS: { key: HouseStatus | "actief" | "alles"; label: string }[] = [
  { key: "actief", label: "Actief" },
  ...houseStatus.enumValues.map((s) => ({ key: s, label: STATUS_LABELS[s] })),
  { key: "alles", label: "Alles" },
];

export default async function BoardPage({ searchParams }: PageProps<"/">) {
  await requireUser();
  const { status = "actief" } = await searchParams;
  const filter = FILTERS.find((f) => f.key === status)?.key ?? "actief";
  const [houses, users] = await Promise.all([listHouses(filter === "alles" ? undefined : filter), listUsers()]);
  const userIds = users.map((u) => u.id);

  return (
    <div className="flex flex-col gap-5">
      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "actief" ? "/" : `/?status=${f.key}`}
            className={`shrink-0 rounded-full px-3 py-1 text-sm ${
              f.key === filter
                ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                : "bg-stone-200/60 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {houses.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-4xl">🏠</p>
          <p className="text-stone-500">Nog geen huizen hier.</p>
          <Link href="/nieuw" className="btn">
            Eerste huis toevoegen
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {houses.map((h) => {
            const badge = agreement(h.ratings, userIds);
            return (
              <li key={h.id}>
                <Link href={`/huis/${h.id}`} className="card block overflow-hidden transition hover:shadow-md">
                  <div className="relative aspect-[3/2] bg-stone-200 dark:bg-stone-800">
                    {h.imageUrl ? (
                      <img src={h.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-4xl">🏠</div>
                    )}
                    <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-stone-800">
                      {STATUS_LABELS[h.status]}
                    </span>
                    {badge && (
                      <span className="absolute right-2 top-2 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-white dark:bg-accent-night">
                        {badge}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 p-4">
                    <p className="font-semibold leading-tight">{h.address}</p>
                    <p className="text-sm text-stone-500">
                      {[h.city, formatPrice(h.price), h.livingArea && `${h.livingArea} m²`].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="flex gap-3">
                        {users.map((u) => (
                          <span key={u.id} className={h.ratings[u.id] === undefined ? "text-stone-400" : ""}>
                            {u.name} {RATING_EMOJI[h.ratings[u.id]] ?? "–"}
                          </span>
                        ))}
                      </span>
                      {h.commentCount > 0 && <span className="text-stone-500">💬 {h.commentCount}</span>}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

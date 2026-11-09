"use client";

import { useState, type ComponentProps } from "react";
import { Comments, LAYOUT_TAGS } from "@/components/house-controls";

type Floor = { id: number; name: string; svg: string; description?: string };
type Comment = ComponentProps<typeof Comments>["comments"][number] & { floorplanId: number | null };

/** One floor at a time, so a three-storey house doesn't turn into an endless page on a phone. */
export function FloorplanTabs({
  houseId,
  floors,
  comments,
  userId,
}: {
  houseId: number;
  floors: Floor[];
  comments: Comment[];
  userId: number;
}) {
  const [active, setActive] = useState(floors[0]?.id);
  const floor = floors.find((f) => f.id === active) ?? floors[0];
  if (!floor) return null;
  const count = (id: number) => comments.filter((c) => c.floorplanId === id).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {floors.map((f) => (
          <button
            key={f.id}
            onClick={() => setActive(f.id)}
            className={`shrink-0 rounded-full px-3 py-1 text-sm ${
              f.id === floor.id
                ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                : "bg-stone-200/60 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
            }`}
          >
            {f.name}
            {count(f.id) > 0 && <span className="ml-1 opacity-70">💬 {count(f.id)}</span>}
          </button>
        ))}
      </div>
      {/* Our own SVG (src/lib/floorplan.ts), room names escaped there */}
      <div
        className="mx-auto w-full max-w-lg overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700 [&>svg]:h-auto [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: floor.svg }}
      />
      {floor.description && <p className="text-sm text-stone-600 dark:text-stone-400">{floor.description}</p>}
      <Comments
        key={floor.id}
        houseId={houseId}
        floorplanId={floor.id}
        comments={comments.filter((c) => c.floorplanId === floor.id)}
        userId={userId}
        quickTags={LAYOUT_TAGS}
        placeholder={`Wat vind je van de indeling van de ${floor.name.toLowerCase()}?`}
      />
    </div>
  );
}

"use client";

import { useActionState, useState, useTransition } from "react";
import { addComment, clearRating, deleteComment, deleteHouse, rate, refreshFromFunda, setStatus } from "@/app/actions";
import type { CommentKind, HouseStatus } from "@/db/schema";
import { formatDate, RATING_EMOJI, STATUS_LABELS } from "@/lib/format";

export function RatingButtons({ houseId, value }: { houseId: number; value: number | undefined }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex gap-2">
      {[1, 0, -1].map((v) => (
        <button
          key={v}
          disabled={pending}
          onClick={() => startTransition(() => (value === v ? clearRating(houseId) : rate(houseId, v)))}
          className={`rounded-xl border px-4 py-2 text-2xl transition ${
            value === v
              ? "border-accent bg-accent-soft dark:border-accent-night-text dark:bg-accent-night-soft"
              : "border-stone-300 opacity-60 hover:opacity-100 dark:border-stone-700"
          }`}
          aria-pressed={value === v}
        >
          {RATING_EMOJI[v]}
        </button>
      ))}
    </div>
  );
}

export function StatusSelect({ houseId, value }: { houseId: number; value: HouseStatus }) {
  const [pending, startTransition] = useTransition();
  return (
    <select
      value={value}
      disabled={pending}
      onChange={(e) => {
        const status = e.target.value;
        startTransition(() => setStatus(houseId, status));
      }}
    >
      {Object.entries(STATUS_LABELS).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function DeleteHouseButton({ houseId }: { houseId: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      className="text-sm text-red-600 hover:underline"
      onClick={() => {
        if (confirm("Dit huis en alle reacties verwijderen?")) startTransition(() => deleteHouse(houseId));
      }}
    >
      Verwijderen
    </button>
  );
}

export function RefreshFundaButton({ houseId, hasData }: { houseId: number; hasData: boolean }) {
  const [state, action, pending] = useActionState(refreshFromFunda.bind(null, houseId), undefined);
  return (
    <form action={action} className="flex flex-col gap-1">
      <button className="btn-ghost py-1.5" disabled={pending}>
        {pending ? "Ophalen…" : hasData ? "Opnieuw ophalen van Funda" : "Gegevens ophalen van Funda"}
      </button>
      {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}

type QuickTag = { kind: CommentKind; text: string };

export const LAYOUT_TAGS: QuickTag[] = [
  { kind: "plus", text: "Fijne indeling" },
  { kind: "plus", text: "Ruime slaapkamers" },
  { kind: "plus", text: "Goede bergruimte" },
  { kind: "min", text: "Doorloopkamer" },
  { kind: "min", text: "Kleine slaapkamers" },
  { kind: "min", text: "Onhandige badkamer" },
];

const QUICK_TAGS: QuickTag[] = [
  { kind: "plus", text: "Mooie tuin" },
  { kind: "plus", text: "Veel licht" },
  { kind: "plus", text: "Goede locatie" },
  { kind: "plus", text: "Mooie keuken" },
  { kind: "plus", text: "Rustige straat" },
  { kind: "min", text: "Te klein" },
  { kind: "min", text: "Te duur" },
  { kind: "min", text: "Drukke straat" },
  { kind: "min", text: "Veel opknapwerk" },
  { kind: "min", text: "Slecht energielabel" },
];

const KIND_STYLE: Record<CommentKind, { label: string; className: string }> = {
  plus: { label: "👍 Plus", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  min: { label: "👎 Min", className: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300" },
  notitie: { label: "📝 Notitie", className: "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300" },
};

type Comment = {
  id: number;
  kind: CommentKind;
  body: string;
  createdAt: Date;
  userId: number;
  userName: string;
  // Name of the floor plan the comment is about, shown in the house-wide list
  floorplanName?: string | null;
};

export function Comments({
  houseId,
  comments,
  userId,
  floorplanId,
  quickTags = QUICK_TAGS,
  placeholder = "Wat vind je ervan?",
}: {
  houseId: number;
  comments: Comment[];
  userId: number;
  floorplanId?: number;
  quickTags?: QuickTag[];
  placeholder?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<CommentKind>("notitie");
  const [body, setBody] = useState("");

  const submit = (k: CommentKind, text: string, fromTextarea = false) =>
    startTransition(async () => {
      await addComment(houseId, k, text, floorplanId);
      // A quick tag must not wipe what someone is still typing
      if (fromTextarea) setBody("");
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {quickTags.map((t) => (
          <button
            key={t.text}
            disabled={pending}
            onClick={() => submit(t.kind, t.text)}
            className={`rounded-full px-3 py-1 text-sm transition hover:opacity-80 ${KIND_STYLE[t.kind].className}`}
          >
            {t.kind === "plus" ? "+" : "−"} {t.text}
          </button>
        ))}
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(kind, body, true);
        }}
      >
        <div className="flex gap-1">
          {(Object.keys(KIND_STYLE) as CommentKind[]).map((k) => (
            <button
              type="button"
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-lg px-3 py-1 text-sm ${kind === k ? KIND_STYLE[k].className + " font-medium" : "text-stone-500"}`}
            >
              {KIND_STYLE[k].label}
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(kind, body, true);
          }}
        />
        <button className="btn self-start" disabled={pending || !body.trim()}>
          Plaatsen
        </button>
      </form>

      <ul className="flex flex-col gap-3">
        {comments.map((c) => (
          <li key={c.id} className="flex gap-3">
            <span className={`h-fit shrink-0 rounded-full px-2 py-0.5 text-xs ${KIND_STYLE[c.kind].className}`}>
              {KIND_STYLE[c.kind].label.split(" ")[0]}
            </span>
            <div className="flex-1">
              <p className="whitespace-pre-wrap">
                {c.floorplanName && <span className="mr-1 text-xs text-stone-500">📐 {c.floorplanName}:</span>}
                {c.body}
              </p>
              <p className="text-xs text-stone-500">
                {c.userName} · {formatDate(c.createdAt)}
                {c.userId === userId && (
                  <button
                    className="ml-2 hover:text-red-600"
                    onClick={() => startTransition(() => deleteComment(c.id))}
                  >
                    verwijderen
                  </button>
                )}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

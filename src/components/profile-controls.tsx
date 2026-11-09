"use client";

import { useActionState, useTransition } from "react";
import { decideProfileProposal, regenerateProfile, rejectItem, saveWishes } from "@/app/actions";
import type { ProfileSection } from "@/lib/profile-types";

export function RegenerateButton({ hasProfile, upToDate }: { hasProfile: boolean; upToDate: boolean }) {
  const [state, action, pending] = useActionState(regenerateProfile, undefined);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <button className="btn" disabled={pending || upToDate} title={upToDate ? "Er is niets veranderd sinds de laatste update" : undefined}>
        {pending ? "Claude denkt na… (± 1 minuut)" : hasProfile ? "Profiel bijwerken" : "Profiel maken"}
      </button>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

export function WishesForm({ wishes }: { wishes: string }) {
  const [state, action, pending] = useActionState(saveWishes, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <textarea
        name="wishes"
        rows={6}
        defaultValue={wishes}
        placeholder="Bv. minstens 3 slaapkamers, tuin, max 30 min fietsen naar het werk, liefst jaren '30…"
      />
      <div className="flex items-center gap-3">
        <button className="btn-ghost py-1.5 text-sm" disabled={pending}>
          {pending ? "Opslaan…" : "Opslaan"}
        </button>
        {state && !pending && <span className="text-sm text-stone-500">Opgeslagen</span>}
      </div>
    </form>
  );
}

export function RejectButton({ section, index }: { section: ProfileSection | "oneens"; index: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => rejectItem(section, index))}
      className="shrink-0 text-xs text-stone-400 hover:text-red-600"
      title="Dit klopt niet: weghalen en onthouden voor de volgende keer"
    >
      klopt niet
    </button>
  );
}

export function ProposalActions({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex gap-2">
      <button className="btn py-1 text-sm" disabled={pending} onClick={() => startTransition(() => decideProfileProposal(id, true))}>
        Klopt, toevoegen
      </button>
      <button className="btn-ghost py-1 text-sm" disabled={pending} onClick={() => startTransition(() => decideProfileProposal(id, false))}>
        Nee
      </button>
    </div>
  );
}

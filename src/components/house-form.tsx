"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions";
import type { House } from "@/db/schema";

type Defaults = Partial<Pick<House, "url" | "source" | "address" | "city" | "price" | "livingArea" | "plotArea" | "bedrooms" | "yearBuilt" | "energyLabel" | "imageUrl" | "description">>;

const NUMBER_FIELDS = [
  { name: "price", label: "Vraagprijs (€)" },
  { name: "livingArea", label: "Woonoppervlak (m²)" },
  { name: "plotArea", label: "Perceel (m²)" },
  { name: "bedrooms", label: "Slaapkamers" },
  { name: "yearBuilt", label: "Bouwjaar" },
] as const;

export function HouseForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Defaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {defaults.url && <input type="hidden" name="url" value={defaults.url} />}
      {defaults.source && <input type="hidden" name="source" value={defaults.source} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="address">Adres</label>
          <input id="address" name="address" defaultValue={defaults.address ?? ""} required />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="city">Plaats</label>
          <input id="city" name="city" defaultValue={defaults.city ?? ""} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {NUMBER_FIELDS.map((f) => (
          <div key={f.name} className="flex flex-col gap-1">
            <label htmlFor={f.name}>{f.label}</label>
            <input id={f.name} name={f.name} inputMode="numeric" defaultValue={defaults[f.name] ?? ""} />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <label htmlFor="energyLabel">Energielabel</label>
          <input id="energyLabel" name="energyLabel" defaultValue={defaults.energyLabel ?? ""} placeholder="bv. A++" />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="imageUrl">Link naar foto</label>
        <input
          id="imageUrl"
          name="imageUrl"
          type="url"
          defaultValue={defaults.imageUrl ?? ""}
          placeholder="Rechtsklik op een foto → Afbeeldingsadres kopiëren"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description">Notitie / omschrijving</label>
        <textarea id="description" name="description" rows={3} defaultValue={defaults.description ?? ""} />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn self-start" disabled={pending}>
        {pending ? "Opslaan…" : submitLabel}
      </button>
    </form>
  );
}

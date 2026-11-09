"use client";

import { useActionState, useState } from "react";
import { applyCapture } from "@/app/actions";

export function CaptureActions({ token, suggestionId }: { token: string; suggestionId: number | null }) {
  const [state, action, pending] = useActionState(() => applyCapture(token, suggestionId), undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <button className="btn self-start" disabled={pending}>
        {pending ? "Bezig…" : suggestionId ? "Opnieuw laten beoordelen" : "Als suggestie toevoegen"}
      </button>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

export function BookmarkletInstall({ code, name }: { code: string; name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-5 text-sm">
      <section className="card flex flex-col gap-2 p-5">
        <h2 className="font-semibold">Op de laptop</h2>
        <p>
          Sleep deze knop naar je bladwijzerbalk. Zie je die balk niet? Druk op <strong>⌘ Shift B</strong> (Mac) of{" "}
          <strong>Ctrl Shift B</strong> (Windows).
        </p>
        {/* React blocks javascript: URLs in href, so set it on the element directly */}
        <a
          ref={(el) => el?.setAttribute("href", code)}
          className="btn self-start"
          onClick={(e) => e.preventDefault()}
          title="Sleep me naar je bladwijzerbalk"
        >
          🏡 Stuur naar {name}
        </a>
        <p className="text-stone-500">Open daarna een advertentie en klik op de bladwijzer.</p>
      </section>
      <section className="card flex flex-col gap-2 p-5">
        <h2 className="font-semibold">Op Android (Chrome)</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <button
              className="btn-ghost py-1 text-sm"
              onClick={() => navigator.clipboard.writeText(code).then(() => setCopied(true))}
            >
              {copied ? "Gekopieerd ✓" : "Kopieer de code"}
            </button>
          </li>
          <li>Maak een bladwijzer van deze pagina (☆ in het menu) en tik op <em>Bewerken</em>.</li>
          <li>Noem hem <strong>{name}</strong> en vervang de URL door de gekopieerde code. Opslaan.</li>
          <li>
            Op een advertentie: tik in de adresbalk, typ <strong>{name}</strong> en kies de bladwijzer met het sterretje uit de
            lijst.
          </li>
        </ol>
      </section>
      <p className="text-stone-500">
        Er opent een nieuw tabblad van {name} waar je bevestigt wat ermee moet gebeuren: bij een bestaande suggestie wordt het
        huis opnieuw beoordeeld, een nieuw huis wordt een suggestie. De app ziet alleen de pagina waarop je de bladwijzer
        gebruikt.
      </p>
    </div>
  );
}

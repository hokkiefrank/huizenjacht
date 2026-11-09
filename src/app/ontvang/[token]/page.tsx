import { eq } from "drizzle-orm";
import Link from "next/link";
import { CaptureActions } from "@/components/capture-controls";
import { db, schema } from "@/db";
import { getUser } from "@/lib/auth";
import { findCaptureMatch } from "@/lib/capture";

export default async function CapturePage({ params, searchParams }: PageProps<"/ontvang/[token]">) {
  const { token } = await params;
  const user = await getUser();
  if (!user) {
    // We got here via a redirect from another site's form, and browsers may leave our cookie out of that first
    // request. Loading the page again from here does send it; only after that is "not logged in" real.
    if ((await searchParams).opnieuw) {
      return (
        <p className="card mx-auto max-w-md p-6 text-sm">
          Je bent niet ingelogd. <Link href="/login" className="underline">Log in</Link> en tik daarna nog eens op de bladwijzer.
        </p>
      );
    }
    return <meta httpEquiv="refresh" content={`0;url=/ontvang/${token}?opnieuw=1`} />;
  }

  const [capture] = await db.select().from(schema.pageCaptures).where(eq(schema.pageCaptures.token, token));
  if (!capture || capture.usedAt) {
    return (
      <p className="card mx-auto max-w-md p-6 text-sm">
        {capture ? "Deze pagina is al verwerkt." : "Deze pagina is verlopen. Tik nog eens op de bladwijzer."}{" "}
        <Link href="/suggesties" className="underline">Naar de suggesties</Link>
      </p>
    );
  }
  const match = await findCaptureMatch(capture.url);
  const host = new URL(capture.url).hostname.replace(/^www\./, "");

  return (
    <div className="card mx-auto flex max-w-xl flex-col gap-4 p-6">
      <div>
        <p className="text-sm text-stone-500">Ontvangen van {host}</p>
        <h1 className="text-lg font-semibold leading-tight">{capture.title || capture.url}</h1>
      </div>
      {capture.imageUrl && <img src={capture.imageUrl} alt="" className="aspect-[2/1] w-full rounded-lg object-cover" />}
      {match?.kind === "house" ? (
        <p className="text-sm">
          Dit huis staat al op jullie bord: <Link href={`/huis/${match.id}`} className="underline">{match.address}</Link>
        </p>
      ) : (
        <>
          <p className="text-sm">
            {match
              ? <>Hoort bij de suggestie <strong>{match.address}</strong>. Claude beoordeelt het huis opnieuw met de gegevens van deze pagina.</>
              : <>Dit huis staat nog niet in de app. Claude haalt de gegevens uit de pagina en beoordeelt het als suggestie.</>}
          </p>
          <CaptureActions token={token} suggestionId={match?.id ?? null} />
        </>
      )}
      <details className="text-sm text-stone-500">
        <summary className="cursor-pointer">Wat is er ontvangen?</summary>
        <p className="mt-2 max-h-60 overflow-y-auto whitespace-pre-line">{capture.text.slice(0, 3000)}</p>
      </details>
    </div>
  );
}

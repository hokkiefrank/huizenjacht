import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import { logout } from "@/app/actions";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { APP_NAME, APP_TITLE } from "@/lib/app-name";
import { getUser } from "@/lib/auth";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// A function rather than a constant, so the name is read from .env at runtime
export function generateMetadata(): Metadata {
  return {
    title: APP_TITLE,
    description: "Samen een koophuis zoeken, met suggesties en beoordelingen van Claude",
    appleWebApp: { capable: true, title: APP_TITLE, statusBarStyle: "default" },
    // src/app/favicon.ico is linked automatically; the SVG is sharper where browsers support it
    icons: { icon: { url: "/favicon.svg", type: "image/svg+xml" }, apple: "/icons/180" },
  };
}

export const viewport: Viewport = {
  themeColor: "#5c3a24",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getUser();
  // Alert houses waiting for this user to open them (see the suggestions page)
  const detailRequests = user
    ? await db.$count(
        schema.suggestions,
        and(
          eq(schema.suggestions.status, "nieuw"),
          eq(schema.suggestions.needsDetails, true),
          or(eq(schema.suggestions.receivedBy, user.id), isNull(schema.suggestions.receivedBy)),
        ),
      )
    : 0;
  const proposals = user ? await db.$count(schema.profileProposals, eq(schema.profileProposals.status, "nieuw")) : 0;
  return (
    <html lang="nl" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <header className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50/90 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
            <Link href="/" className="whitespace-nowrap text-lg font-semibold tracking-tight">
              🏡 <span className="sm:hidden">{APP_NAME}</span>
              <span className="hidden sm:inline">{APP_TITLE}</span>
            </Link>
            {user && (
              <div className="flex items-center gap-1 sm:gap-2">
                <Link
                  href="/suggesties"
                  className="whitespace-nowrap rounded-lg px-1.5 py-1.5 text-sm font-medium hover:bg-stone-200/60 dark:hover:bg-stone-800"
                >
                  Suggesties
                  {detailRequests > 0 && (
                    <span
                      className="ml-1 rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-white dark:bg-accent-night"
                      title="Huizen die je even moet openen"
                    >
                      {detailRequests}
                    </span>
                  )}
                </Link>
                <Link
                  href="/kaart"
                  className="whitespace-nowrap rounded-lg px-1.5 py-1.5 text-sm font-medium hover:bg-stone-200/60 dark:hover:bg-stone-800"
                >
                  Kaart
                </Link>
                <Link
                  href="/profiel"
                  className="whitespace-nowrap rounded-lg px-1.5 py-1.5 text-sm font-medium hover:bg-stone-200/60 dark:hover:bg-stone-800"
                >
                  Profiel
                  {proposals > 0 && (
                    <span
                      className="ml-1 rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-white dark:bg-accent-night"
                      title="Voorstellen om jullie profiel aan te passen"
                    >
                      {proposals}
                    </span>
                  )}
                </Link>
                <Link href="/nieuw" className="btn whitespace-nowrap py-1.5 text-sm">
                  + Huis
                </Link>
                <form action={logout} className="hidden sm:block">
                  <button className="whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
                    {user.name} · uitloggen
                  </button>
                </form>
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

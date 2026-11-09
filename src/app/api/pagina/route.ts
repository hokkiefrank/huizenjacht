import { randomBytes } from "node:crypto";
import { gt, lt } from "drizzle-orm";
import { db, schema } from "@/db";

// The "Stuur naar …" bookmarklet (/ontvang) posts the page you're looking at here, from that site's tab.
// No cookie comes along (and anyone could post), so we only park it; /ontvang/<token> asks you what to do with it.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const field = (name: string, max: number) => String(form?.get(name) ?? "").slice(0, max);
  let url: URL;
  try {
    url = new URL(field("url", 2000));
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch {
    return new Response("Geen geldige pagina ontvangen.", { status: 400 });
  }
  const text = field("text", 60_000).trim();
  if (!text) return new Response("De pagina was leeg.", { status: 400 });

  await db.delete(schema.pageCaptures).where(lt(schema.pageCaptures.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const recent = await db.$count(schema.pageCaptures, gt(schema.pageCaptures.createdAt, new Date(Date.now() - 60 * 60 * 1000)));
  if (recent > 100) return new Response("Even te veel pagina's ontvangen, probeer het later nog eens.", { status: 429 });

  let imageUrl: string | null = field("image", 1000);
  try {
    imageUrl = imageUrl && new URL(imageUrl, url).protocol === "https:" ? new URL(imageUrl, url).toString() : null;
  } catch {
    imageUrl = null;
  }
  const token = randomBytes(18).toString("base64url");
  await db.insert(schema.pageCaptures).values({ token, url: url.toString(), title: field("title", 300), text, imageUrl });
  const base = process.env.APP_URL ?? new URL(request.url).origin;
  return Response.redirect(`${base}/ontvang/${token}`, 303);
}

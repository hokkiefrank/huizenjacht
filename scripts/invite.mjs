// Create (or re-invite) a user and print a one-time link where they choose their password.
//   node scripts/invite.mjs "Alex" alex@example.com
// The login can also be a plain username ("sam"); the app never sends email.
// Plain JS on purpose, so it also runs inside the production container.
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

const [name, rawEmail] = process.argv.slice(2);
if (!name || !rawEmail) {
  console.error('Usage: node scripts/invite.mjs "<name>" <email or username>');
  process.exit(1);
}
const email = rawEmail.trim().toLowerCase();
const sql = postgres(process.env.DATABASE_URL ?? "postgres://localhost/huizen");

const [user] = await sql`
  insert into users (name, email) values (${name}, ${email})
  on conflict (email) do update set name = excluded.name
  returning id`;

const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
await sql`delete from invites where user_id = ${user.id}`;
await sql`insert into invites (token_hash, user_id, expires_at) values (${tokenHash}, ${user.id}, ${expiresAt})`;
await sql.end();

const base = process.env.APP_URL ?? "http://localhost:3000";
console.log(`Uitnodiging voor ${name} (7 dagen geldig):\n${base}/uitnodiging/${token}`);

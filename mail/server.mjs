// Receives mail for one address (MAIL_ADDRESS, e.g. alerts@example.com) and stores it for the agent
// worker, which reads Funda search alerts from it. Receive-only: it never sends or relays anything.
import { readFileSync } from "node:fs";
import { simpleParser } from "mailparser";
import postgres from "postgres";
import { SMTPServer } from "smtp-server";

const ADDRESS = process.env.MAIL_ADDRESS?.trim().toLowerCase();
if (!ADDRESS) throw new Error("MAIL_ADDRESS is not set");
const PORT = Number(process.env.PORT ?? 2525);
const MAX_BYTES = 5 * 1024 * 1024;
const TLS_DIR = process.env.TLS_DIR ?? "/tmp/tls";
const sql = postgres(process.env.DATABASE_URL);

const log = (...args) => console.log(new Date().toISOString(), ...args);

// Gmail forwards with the original sender in From; its forwarding confirmation comes from Google itself.
// The sites' exact sending addresses aren't documented, so links to the site count too. From Funda we only
// take listing ids (each listing is then checked with Funda itself); Pararius and Huislijn mails are read whole.
const SITES = ["pararius", "huislijn", "funda"];
function classify(from, body) {
  if (from === "forwarding-noreply@google.com") return "gmail";
  const site = SITES.find((s) => new RegExp(`@([\\w-]+\\.)*${s}\\.nl$`).test(from));
  if (site) return site;
  return SITES.find((s) => new RegExp(`${s}\\.nl`, "i").test(body)) ?? "other";
}

const server = new SMTPServer({
  name: process.env.MAIL_HOSTNAME ?? ADDRESS.split("@")[1],
  banner: "receive only",
  authOptional: true,
  disabledCommands: ["AUTH"],
  // Self-signed (see Dockerfile): senders use STARTTLS opportunistically and don't verify it
  key: readFileSync(`${TLS_DIR}/key.pem`),
  cert: readFileSync(`${TLS_DIR}/cert.pem`),
  size: MAX_BYTES,
  maxClients: 10,
  socketTimeout: 60_000,
  onRcptTo(address, _session, callback) {
    if (address.address.trim().toLowerCase() !== ADDRESS) {
      return callback(Object.assign(new Error("No such user here"), { responseCode: 550 }));
    }
    callback();
  },
  onData(stream, session, callback) {
    simpleParser(stream, { skipImageLinks: true, skipTextToHtml: true })
      .then(async (mail) => {
        if (stream.sizeExceeded) {
          return callback(Object.assign(new Error("Message too big"), { responseCode: 552 }));
        }
        const from = (mail.from?.value?.[0]?.address ?? session.envelope.mailFrom?.address ?? "").toLowerCase();
        const kind = classify(from, `${mail.text ?? ""} ${mail.html || ""}`);
        // Whose alert this is: Gmail's auto-forward adds "X-Forwarded-For: <their address> <our address>"
        const forwardedFor = String(mail.headers.get("x-forwarded-for") ?? "").split(/\s+/)[0];
        const to = (forwardedFor.includes("@") ? forwardedFor : (mail.to?.value?.[0]?.address ?? "")).toLowerCase();
        const cap = (v) => (typeof v === "string" ? v.slice(0, 1_000_000) : "");
        await sql`
          insert into inbound_emails (from_address, to_address, subject, text, html, kind)
          values (${from}, ${to.slice(0, 300)}, ${cap(mail.subject).slice(0, 500)}, ${kind === "other" ? "" : cap(mail.text)},
            ${kind === "other" ? "" : cap(mail.html || "")}, ${kind})`;
        log(`stored ${kind} mail from ${from}: ${mail.subject ?? ""}`);
        callback();
      })
      .catch((error) => {
        log("failed to store mail:", error.message);
        callback(Object.assign(new Error("Try again later"), { responseCode: 451 }));
      });
  },
});

server.on("error", (error) => log("smtp error:", error.message));
server.listen(PORT, () => log(`receiving mail for ${ADDRESS} on port ${PORT}`));

// Mail is only needed until the worker has read it
setInterval(() => {
  sql`delete from inbound_emails where received_at < now() - interval '30 days'`.catch((e) => log("cleanup failed:", e.message));
}, 24 * 60 * 60 * 1000);

import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { FundaListing } from "@/lib/funda";

/** Set by the agent worker on houses that didn't come from Funda. */
export type SuggestionListingExtras = {
  // url is a Pararius alert link that logs in to the account of whoever got the mail (receivedBy)
  loginLink?: boolean;
  lookedUp?: boolean;
  detailsUrl?: string;
};
import type { Layout } from "@/lib/layout-types";
import type { Profile } from "@/lib/profile-types";

export const houseStatus = pgEnum("house_status", [
  "interessant",
  "bezichtiging",
  "bezichtigd",
  "bod",
  "afgevallen",
]);

export const commentKind = pgEnum("comment_kind", ["plus", "min", "notitie"]);

// niet_beschikbaar = sold or under offer; unlike afgewezen it says nothing about what we like
export const suggestionStatus = pgEnum("suggestion_status", ["nieuw", "toegevoegd", "afgewezen", "niet_beschikbaar"]);

export const runStatus = pgEnum("run_status", ["queued", "running", "done", "failed"]);

// suggestions = search for houses; layout = describe one house's floor plans;
// rate = score houses that came in through our saved Funda search
export const runKind = pgEnum("run_kind", ["suggestions", "layout", "rate"]);

export const ideaStatus = pgEnum("idea_status", ["nieuw", "toegevoegd", "afgewezen"]);

// ov = public transport
export const travelMode = pgEnum("travel_mode", ["ov", "auto", "fiets"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  // Null until the user has accepted their invite and chosen a password
  passwordHash: text("password_hash"),
  // What this person says they're looking for, in their own words; input for the profile
  wishes: text("wishes").notNull().default(""),
  wishesUpdatedAt: timestamp("wishes_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invites = pgTable("invites", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const sessions = pgTable("sessions", {
  // sha256 of the cookie token, so a database leak doesn't leak sessions
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const houses = pgTable("houses", {
  id: serial("id").primaryKey(),
  url: text("url").notNull().unique(),
  source: text("source").notNull(),
  address: text("address").notNull(),
  city: text("city"),
  price: integer("price"),
  livingArea: integer("living_area"),
  plotArea: integer("plot_area"),
  bedrooms: integer("bedrooms"),
  yearBuilt: integer("year_built"),
  energyLabel: text("energy_label"),
  imageUrl: text("image_url"),
  description: text("description"),
  photos: jsonb("photos").$type<string[]>().notNull().default([]),
  // Full listing as fetched from Funda, kept so it survives the listing going offline
  listing: jsonb("listing").$type<FundaListing>(),
  // The agent's one-time description of the floor plans; input for the profile
  layout: jsonb("layout").$type<Layout>(),
  status: houseStatus("status").notNull().default("interessant"),
  addedBy: integer("added_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FloorplanRoom = { name: string; area: number };

export const floorplans = pgTable("floorplans", {
  id: serial("id").primaryKey(),
  houseId: integer("house_id")
    .notNull()
    .references(() => houses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  rooms: jsonb("rooms").$type<FloorplanRoom[]>().notNull(),
  // Rendered by us from the Floorplanner data (src/lib/floorplan.ts)
  svg: text("svg").notNull(),
});

export const ratings = pgTable(
  "ratings",
  {
    houseId: integer("house_id")
      .notNull()
      .references(() => houses.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 1 = 👍, 0 = 🤷, -1 = 👎
    value: smallint("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.houseId, t.userId] })],
);

export const comments = pgTable("comments", {
  id: serial("id").primaryKey(),
  houseId: integer("house_id")
    .notNull()
    .references(() => houses.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Set when the comment is about one floor plan
  floorplanId: integer("floorplan_id").references(() => floorplans.id, { onDelete: "set null" }),
  kind: commentKind("kind").notNull().default("notitie"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Generated preference profile; every regeneration adds a row, the newest is shown
export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  content: jsonb("content").$type<Profile>().notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// "Klopt niet" on a profile item: fed back into the next generation so it isn't re-added
export const profileCorrections = pgTable("profile_corrections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One job for the Claude Code agent (agent/worker.mjs picks up queued runs)
export const agentRuns = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  kind: runKind("kind").notNull().default("suggestions"),
  status: runStatus("status").notNull().default("queued"),
  // For layout runs
  houseId: integer("house_id").references(() => houses.id, { onDelete: "cascade" }),
  // null = the daily scheduled run
  requestedBy: integer("requested_by").references(() => users.id, { onDelete: "set null" }),
  error: text("error"),
  notes: text("notes"),
  found: integer("found"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const suggestions = pgTable("suggestions", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  url: text("url").notNull().unique(),
  source: text("source").notNull(),
  address: text("address").notNull(),
  city: text("city"),
  price: integer("price"),
  livingArea: integer("living_area"),
  bedrooms: integer("bedrooms"),
  imageUrl: text("image_url"),
  // Null while a house from our Funda search alert waits to be rated
  score: smallint("score"),
  reason: text("reason").notNull(),
  concerns: text("concerns"),
  status: suggestionStatus("status").notNull().default("nieuw"),
  // Why it was rejected; fed back into the next search and the profile
  rejectReason: text("reject_reason"),
  rejectedBy: integer("rejected_by").references(() => users.id, { onDelete: "set null" }),
  houseId: integer("house_id").references(() => houses.id, { onDelete: "set null" }),
  // Funda's data, or the same fields read from an alert mail / makelaar page (agent/worker.mjs)
  listing: jsonb("listing").$type<FundaListing & SuggestionListingExtras>(),
  // The agent's estimate per travel limit, e.g. 45 minutes by public transport to "Werk Alex"
  travelTimes: jsonb("travel_times").$type<TravelTime[]>(),
  // From an alert mail: whose mailbox it came from (the Gmail account that forwards it)
  receivedBy: integer("received_by").references(() => users.id, { onDelete: "set null" }),
  // Claude couldn't find more than the mail said; receivedBy is asked to open it and paste the details
  needsDetails: boolean("needs_details").notNull().default(false),
  // Where it is, from the listing or PDOK's address search (agent/worker.mjs); compared with our search zones
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  geocodedAt: timestamp("geocoded_at", { withTimezone: true }),
  // Claude's verdict per must-have and dealbreaker in the profile
  checks: jsonb("checks").$type<ProfileCheck[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One must-have or dealbreaker checked against the listing. `past` is "nee" when the house fails it
 * (lacks the must-have or has the dealbreaker); `zeker` only when the listing says so explicitly.
 */
export type ProfileCheck = { eis: string; past: "ja" | "nee" | "onbekend"; zeker: boolean; toelichting: string };

export type TravelTime = { label: string; mode: TravelMode; minutes: number | null; maxMinutes: number };

// "Within 1 hour by public transport from Alex's work": the agent searches only where all of these hold
export const travelLimits = pgTable("travel_limits", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  address: text("address").notNull(),
  mode: travelMode("mode").notNull(),
  maxMinutes: integer("max_minutes").notNull(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Free-text instructions for the search agent, shared by both of us (a single row, id 1)
export const searchSettings = pgTable("search_settings", {
  id: integer("id").primaryKey().default(1),
  instructions: text("instructions").notNull().default(""),
  // Our saved search on funda.nl; the starting point for search ideas
  fundaSearchUrl: text("funda_search_url").notNull().default(""),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // When Claude last proposed profile changes from new rejections (agent/worker.mjs)
  proposalsAt: timestamp("proposals_at", { withTimezone: true }),
});

export type House = typeof houses.$inferSelect;
export type HouseStatus = (typeof houseStatus.enumValues)[number];
export type CommentKind = (typeof commentKind.enumValues)[number];
export type TravelMode = (typeof travelMode.enumValues)[number];

// Email sent to our own address (mail/server.mjs): Funda search alerts, forwarded from Gmail
export const inboundEmails = pgTable("inbound_emails", {
  id: serial("id").primaryKey(),
  fromAddress: text("from_address").notNull(),
  // The original recipient: Gmail keeps To when forwarding, so this tells whose alert it was
  toAddress: text("to_address").notNull().default(""),
  subject: text("subject").notNull().default(""),
  text: text("text").notNull().default(""),
  html: text("html").notNull().default(""),
  // funda/pararius/huislijn = search alert; pagina = sent by our bookmarklet; gmail = Gmail's forwarding confirmation; other = ignored
  kind: text("kind").$type<"funda" | "pararius" | "huislijn" | "pagina" | "gmail" | "other">().notNull(),
  found: integer("found"),
  error: text("error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

// A different Funda search Claude thinks is worth saving, e.g. a nearby town that fits our travel times
export const searchIdeas = pgTable("search_ideas", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  reason: text("reason").notNull(),
  url: text("url").notNull(),
  status: ideaStatus("status").notNull().default("nieuw"),
  decidedBy: integer("decided_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Estate agents whose own listings page we check daily (their sites don't block us, unlike Funda and Pararius).
// "uit" = switched off by us, so Claude won't add it again; "leeg" = page showed no houses (rechecked weekly).
export const makelaarStatus = pgEnum("makelaar_status", ["actief", "leeg", "geblokkeerd", "uit"]);

export const makelaars = pgTable("makelaars", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // The page that lists their houses for sale
  listingsUrl: text("listings_url").notNull().unique(),
  places: text("places").notNull().default(""),
  status: makelaarStatus("status").notNull().default("actief"),
  // null = found by Claude
  addedBy: integer("added_by").references(() => users.id, { onDelete: "set null" }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  // Skip reading the page again when nothing changed
  lastHash: text("last_hash"),
  lastCount: integer("last_count"),
  lastError: text("last_error"),
  // Claude gave this url without managing to open it; cleared once our crawl reads houses from it
  unverified: boolean("unverified").notNull().default(false),
  // One of them fixed or confirmed the url, so stop asking
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type MakelaarStatus = (typeof makelaarStatus.enumValues)[number];

// A page sent by the "Stuur naar …" bookmarklet (/ontvang). Anyone can post one (it comes from another site, without
// our cookie), so it does nothing until a logged-in user confirms it on /ontvang/<token>. Removed after a day.
export const pageCaptures = pgTable("page_captures", {
  token: text("token").primaryKey(),
  url: text("url").notNull(),
  title: text("title").notNull().default(""),
  text: text("text").notNull(),
  imageUrl: text("image_url"),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Areas drawn on the map: where we search, and where we definitely don't want to live
export const zoneKind = pgEnum("zone_kind", ["zoeken", "niet"]);

export const searchZones = pgTable("search_zones", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kind: zoneKind("kind").notNull(),
  // [lat, lng] corners
  polygon: jsonb("polygon").$type<[number, number][]>().notNull(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type SearchZone = typeof searchZones.$inferSelect;

export const proposalSection = pgEnum("proposal_section", ["mustHaves", "voorkeuren", "dealbreakers", "zoekgebied"]);

// Profile changes Claude proposes from rejections and comments; one of us accepts or declines them
export const profileProposals = pgTable("profile_proposals", {
  id: serial("id").primaryKey(),
  section: proposalSection("section").notNull(),
  text: text("text").notNull(),
  // "samen" or one of our names
  who: text("who").notNull(),
  reason: text("reason").notNull(),
  status: ideaStatus("status").notNull().default("nieuw"),
  decidedBy: integer("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

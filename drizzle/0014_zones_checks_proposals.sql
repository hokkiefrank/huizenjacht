CREATE TYPE "public"."proposal_section" AS ENUM('mustHaves', 'voorkeuren', 'dealbreakers', 'zoekgebied');--> statement-breakpoint
CREATE TYPE "public"."zone_kind" AS ENUM('zoeken', 'niet');--> statement-breakpoint
CREATE TABLE "profile_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"section" "proposal_section" NOT NULL,
	"text" text NOT NULL,
	"who" text NOT NULL,
	"reason" text NOT NULL,
	"status" "idea_status" DEFAULT 'nieuw' NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_zones" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "zone_kind" NOT NULL,
	"polygon" jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "search_settings" ADD COLUMN "proposals_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suggestions" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "suggestions" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "suggestions" ADD COLUMN "geocoded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suggestions" ADD COLUMN "checks" jsonb;--> statement-breakpoint
ALTER TABLE "profile_proposals" ADD CONSTRAINT "profile_proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_zones" ADD CONSTRAINT "search_zones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
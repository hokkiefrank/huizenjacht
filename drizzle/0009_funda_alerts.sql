CREATE TYPE "public"."idea_status" AS ENUM('nieuw', 'toegevoegd', 'afgewezen');--> statement-breakpoint
ALTER TYPE "public"."run_kind" ADD VALUE 'rate';--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_address" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"found" integer,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "search_ideas" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"url" text NOT NULL,
	"status" "idea_status" DEFAULT 'nieuw' NOT NULL,
	"decided_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suggestions" ALTER COLUMN "score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "search_settings" ADD COLUMN "funda_search_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "search_ideas" ADD CONSTRAINT "search_ideas_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_ideas" ADD CONSTRAINT "search_ideas_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
CREATE TYPE "public"."makelaar_status" AS ENUM('actief', 'leeg', 'geblokkeerd', 'uit');--> statement-breakpoint
CREATE TABLE "makelaars" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"listings_url" text NOT NULL,
	"places" text DEFAULT '' NOT NULL,
	"status" "makelaar_status" DEFAULT 'actief' NOT NULL,
	"added_by" integer,
	"last_checked_at" timestamp with time zone,
	"last_hash" text,
	"last_count" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "makelaars_listings_url_unique" UNIQUE("listings_url")
);
--> statement-breakpoint
ALTER TABLE "makelaars" ADD CONSTRAINT "makelaars_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
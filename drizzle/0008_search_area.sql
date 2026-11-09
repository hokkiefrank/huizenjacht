CREATE TYPE "public"."travel_mode" AS ENUM('ov', 'auto', 'fiets');--> statement-breakpoint
CREATE TABLE "search_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travel_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"address" text NOT NULL,
	"mode" "travel_mode" NOT NULL,
	"max_minutes" integer NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suggestions" ADD COLUMN "travel_times" jsonb;--> statement-breakpoint
ALTER TABLE "search_settings" ADD CONSTRAINT "search_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_limits" ADD CONSTRAINT "travel_limits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
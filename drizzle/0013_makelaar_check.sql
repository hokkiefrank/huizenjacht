ALTER TABLE "makelaars" ADD COLUMN "unverified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "makelaars" ADD COLUMN "confirmed_at" timestamp with time zone;
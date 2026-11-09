CREATE TYPE "public"."run_kind" AS ENUM('suggestions', 'layout');--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "kind" "run_kind" DEFAULT 'suggestions' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "house_id" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE cascade ON UPDATE no action;
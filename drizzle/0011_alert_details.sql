ALTER TABLE "inbound_emails" ADD COLUMN "to_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "suggestions" ADD COLUMN "received_by" integer;--> statement-breakpoint
ALTER TABLE "suggestions" ADD COLUMN "needs_details" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
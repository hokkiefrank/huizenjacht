CREATE TABLE "floorplans" (
	"id" serial PRIMARY KEY NOT NULL,
	"house_id" integer NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"rooms" jsonb NOT NULL,
	"svg" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "floorplan_id" integer;--> statement-breakpoint
ALTER TABLE "houses" ADD COLUMN "photos" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "houses" ADD COLUMN "listing" jsonb;--> statement-breakpoint
ALTER TABLE "houses" ADD COLUMN "layout" jsonb;--> statement-breakpoint
ALTER TABLE "floorplans" ADD CONSTRAINT "floorplans_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_floorplan_id_floorplans_id_fk" FOREIGN KEY ("floorplan_id") REFERENCES "public"."floorplans"("id") ON DELETE set null ON UPDATE no action;
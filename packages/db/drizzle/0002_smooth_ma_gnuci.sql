CREATE TYPE "public"."album_page_kind" AS ENUM('cover', 'spread', 'back');--> statement-breakpoint
ALTER TYPE "public"."storage_ledger_reason" ADD VALUE 'album_upload';--> statement-breakpoint
ALTER TYPE "public"."storage_ledger_reason" ADD VALUE 'album_delete';--> statement-breakpoint
CREATE TABLE "album_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" uuid NOT NULL,
	"kind" "album_page_kind" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"object_key" text NOT NULL,
	"bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "album_pages" ADD CONSTRAINT "album_pages_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "albums" ADD CONSTRAINT "albums_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "album_pages_slot_unique" ON "album_pages" USING btree ("album_id","kind","position");--> statement-breakpoint
CREATE INDEX "album_pages_album_position_idx" ON "album_pages" USING btree ("album_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "albums_event_unique" ON "albums" USING btree ("event_id");
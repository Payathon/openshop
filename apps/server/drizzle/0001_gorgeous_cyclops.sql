CREATE TABLE "changeset_ops" (
	"id" text PRIMARY KEY NOT NULL,
	"changeset_id" text NOT NULL,
	"shop_id" text NOT NULL,
	"seq" integer NOT NULL,
	"op" jsonb NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "changesets" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "publishes" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"version" integer NOT NULL,
	"changes" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_pages" (
	"shop_id" text PRIMARY KEY NOT NULL,
	"sections" jsonb NOT NULL,
	"theme" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "status" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "changeset_ops" ADD CONSTRAINT "changeset_ops_changeset_id_changesets_id_fk" FOREIGN KEY ("changeset_id") REFERENCES "public"."changesets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changeset_ops" ADD CONSTRAINT "changeset_ops_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changesets" ADD CONSTRAINT "changesets_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishes" ADD CONSTRAINT "publishes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_pages" ADD CONSTRAINT "shop_pages_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "changeset_ops_seq_idx" ON "changeset_ops" USING btree ("changeset_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "changesets_one_open_idx" ON "changesets" USING btree ("shop_id") WHERE "changesets"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "publishes_shop_version_idx" ON "publishes" USING btree ("shop_id","version");
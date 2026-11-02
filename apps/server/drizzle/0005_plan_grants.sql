CREATE TABLE "plan_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"days" integer NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_grants" ADD CONSTRAINT "plan_grants_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_grants_shop_idx" ON "plan_grants" USING btree ("shop_id");
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"account_id" text,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_shop_idx" ON "push_subscriptions" USING btree ("shop_id");--> statement-breakpoint
-- Orders paid before push existed have nothing left to announce.
UPDATE "orders" SET "notified_at" = "paid_at" WHERE "paid_at" IS NOT NULL;
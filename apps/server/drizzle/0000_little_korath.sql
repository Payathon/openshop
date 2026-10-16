CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"order_count" integer NOT NULL,
	"total_fen" integer NOT NULL,
	"first_order_at" timestamp with time zone NOT NULL,
	"last_order_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"product_name" text NOT NULL,
	"attributes" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"quantity" integer NOT NULL,
	"unit_fen" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"status" text NOT NULL,
	"fulfillment" text NOT NULL,
	"source" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"address" jsonb,
	"slot_start" timestamp with time zone,
	"slot_end" timestamp with time zone,
	"total_fen" integer NOT NULL,
	"access_token_hash" text NOT NULL,
	"payment_url" text,
	"payment_expires_at" timestamp with time zone NOT NULL,
	"refunded" boolean DEFAULT false NOT NULL,
	"tracking_no" text,
	"created_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"images" jsonb NOT NULL,
	"fulfillment" text NOT NULL,
	"duration_minutes" integer,
	"order_options" jsonb NOT NULL,
	"info" jsonb NOT NULL,
	"published" boolean NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"industry" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"phone" text NOT NULL,
	"address" text,
	"schedule" jsonb,
	"cancel_policy" jsonb NOT NULL,
	"merchant_token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shops_slug_unique" UNIQUE("slug"),
	CONSTRAINT "shops_merchant_token_hash_unique" UNIQUE("merchant_token_hash")
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"shop_id" text NOT NULL,
	"position" integer NOT NULL,
	"attributes" jsonb NOT NULL,
	"price_fen" integer NOT NULL,
	"stock" integer,
	"deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_shop_phone_idx" ON "customers" USING btree ("shop_id","phone");--> statement-breakpoint
CREATE INDEX "orders_shop_status_idx" ON "orders" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "products_shop_idx" ON "products" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "variants_product_idx" ON "variants" USING btree ("product_id");
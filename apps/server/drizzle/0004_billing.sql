CREATE TABLE "billing_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"plan" text NOT NULL,
	"months" integer NOT NULL,
	"amount_fen" integer NOT NULL,
	"status" text NOT NULL,
	"payment_url" text NOT NULL,
	"payment_expires_at" timestamp with time zone NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_payments_shop_idx" ON "billing_payments" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_payments_status_idx" ON "billing_payments" USING btree ("status");
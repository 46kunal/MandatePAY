ALTER TABLE "orders" ADD COLUMN "payer_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_source" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paypal_payer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paypal_verified" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paypal_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_paypal_payer_id_unique" UNIQUE("paypal_payer_id");
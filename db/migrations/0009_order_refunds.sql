ALTER TABLE "orders" ADD COLUMN "refunds" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunds_checked_at" timestamp with time zone;
CREATE TABLE "carts" (
	"cart_id" text PRIMARY KEY NOT NULL,
	"mandate_id" text NOT NULL,
	"cart" jsonb NOT NULL,
	"cart_hash" text NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"guard" jsonb NOT NULL,
	"closed_mandate_jws" text,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"dispute_id" text PRIMARY KEY NOT NULL,
	"capture_id" text,
	"paypal_order_id" text,
	"mandate_id" text,
	"reason" text,
	"stage" text,
	"status" text,
	"amount_minor" integer,
	"currency" text,
	"raw_dispute" jsonb,
	"verdict" jsonb,
	"analysis_status" text DEFAULT 'pending' NOT NULL,
	"action_taken" text,
	"outcome" text,
	"human_approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"mandate_id" text PRIMARY KEY NOT NULL,
	"buyer_ref" text NOT NULL,
	"request_text" text,
	"constraints" jsonb NOT NULL,
	"jws" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"paypal_order_id" text PRIMARY KEY NOT NULL,
	"cart_id" text NOT NULL,
	"mandate_id" text NOT NULL,
	"status" text NOT NULL,
	"approve_url" text,
	"capture_id" text,
	"receipt_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_at" timestamp with time zone,
	CONSTRAINT "orders_capture_id_unique" UNIQUE("capture_id")
);
--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_mandate_id_mandates_mandate_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("mandate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_carts_cart_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("cart_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_mandate_id_mandates_mandate_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("mandate_id") ON DELETE no action ON UPDATE no action;
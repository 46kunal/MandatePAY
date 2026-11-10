CREATE TABLE "problem_reports" (
	"report_id" text PRIMARY KEY NOT NULL,
	"paypal_order_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"assessment" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reply" text,
	"refund_id" text,
	"refund_minor" integer,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_paypal_order_id_orders_paypal_order_id_fk" FOREIGN KEY ("paypal_order_id") REFERENCES "public"."orders"("paypal_order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "problem_reports_order_idx" ON "problem_reports" USING btree ("paypal_order_id");
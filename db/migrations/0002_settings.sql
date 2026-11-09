CREATE TABLE "settings" (
	"id" text PRIMARY KEY DEFAULT 'store' NOT NULL,
	"store_name" text,
	"support_email" text,
	"approval_threshold_minor" integer,
	"human_review_over_minor" integer,
	"min_confidence" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

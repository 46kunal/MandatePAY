CREATE TABLE "buyer_keys" (
	"user_id" text PRIMARY KEY NOT NULL,
	"kid" text NOT NULL,
	"public_key_pem" text NOT NULL,
	"private_key_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyer_keys_kid_unique" UNIQUE("kid")
);
--> statement-breakpoint
ALTER TABLE "buyer_keys" ADD CONSTRAINT "buyer_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
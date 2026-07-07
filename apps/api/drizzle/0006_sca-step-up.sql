ALTER TYPE "public"."webauthn_ceremony" ADD VALUE 'sca';--> statement-breakpoint
CREATE TABLE "sca_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"action_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD COLUMN "action_hash" text;--> statement-breakpoint
ALTER TABLE "sca_grants" ADD CONSTRAINT "sca_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sca_grants" ADD CONSTRAINT "sca_grants_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sca_grants_token_hash_uniq" ON "sca_grants" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sca_grants_user_idx" ON "sca_grants" USING btree ("user_id");
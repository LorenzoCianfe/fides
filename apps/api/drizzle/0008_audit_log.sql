CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"correlation_id" text,
	"metadata" jsonb,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_seq_uniq" ON "audit_log" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_prev_hash_uniq" ON "audit_log" USING btree ("prev_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_hash_uniq" ON "audit_log" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_type","actor_id");--> statement-breakpoint
CREATE INDEX "audit_log_correlation_idx" ON "audit_log" USING btree ("correlation_id");--> statement-breakpoint
-- Append-only enforcement for the hash-chained audit trail (ADR-0024): reuse the
-- ledger's fides_forbid_mutation() (migration 0002) to reject any UPDATE or DELETE
-- at the database, so a chain rewrite or deletion must bypass the trigger and is
-- then caught by chain verification. INSERT is allowed; TRUNCATE (not a row-level
-- event) remains available for test resets.
CREATE TRIGGER audit_log_append_only
	BEFORE UPDATE OR DELETE ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION fides_forbid_mutation();
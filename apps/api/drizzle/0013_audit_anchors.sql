CREATE TABLE "audit_anchors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigint NOT NULL,
	"hash" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"payload" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_anchors_seq_idx" ON "audit_anchors" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "audit_anchors_published_idx" ON "audit_anchors" USING btree ("published_at");--> statement-breakpoint
-- Append-only enforcement for the anchors (ADR-0031), reusing the ledger's
-- fides_forbid_mutation() from migration 0002. This does NOT make the table the
-- control -- an attacker who can drop the trigger can drop the rows, which is
-- precisely why each anchor is also published to the process log, off-host and
-- unretractable. What it does buy is the same floor the audit trail itself has:
-- an anchor cannot be quietly edited to attest to a shorter chain, so tampering
-- has to escalate to schema changes rather than a single UPDATE.
CREATE TRIGGER audit_anchors_append_only
	BEFORE UPDATE OR DELETE ON "audit_anchors"
	FOR EACH ROW EXECUTE FUNCTION fides_forbid_mutation();
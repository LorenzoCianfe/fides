-- Append-only enforcement for the ledger (ADR-0005): the database itself
-- rejects any UPDATE or DELETE on ledger_accounts, journal_entries, and
-- postings. Mutable projections (balances) and operational tables (outbox,
-- idempotency_keys) are intentionally excluded. TRUNCATE is not a row-level
-- event and remains available for test resets.

CREATE OR REPLACE FUNCTION fides_forbid_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'append-only violation: % on % is not permitted', TG_OP, TG_TABLE_NAME
		USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_accounts_append_only
	BEFORE UPDATE OR DELETE ON "ledger_accounts"
	FOR EACH ROW EXECUTE FUNCTION fides_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER journal_entries_append_only
	BEFORE UPDATE OR DELETE ON "journal_entries"
	FOR EACH ROW EXECUTE FUNCTION fides_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER postings_append_only
	BEFORE UPDATE OR DELETE ON "postings"
	FOR EACH ROW EXECUTE FUNCTION fides_forbid_mutation();

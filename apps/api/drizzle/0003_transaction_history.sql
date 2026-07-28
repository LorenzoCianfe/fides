CREATE TABLE "transaction_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"balance_after_minor" numeric(38, 0) NOT NULL,
	"currency" text NOT NULL,
	"counterparty_account_ids" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction_history" ADD CONSTRAINT "transaction_history_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_history" ADD CONSTRAINT "transaction_history_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_history_account_entry_uniq" ON "transaction_history" USING btree ("account_id","journal_entry_id");--> statement-breakpoint
CREATE INDEX "transaction_history_account_occurred_idx" ON "transaction_history" USING btree ("account_id","occurred_at");
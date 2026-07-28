CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."posting_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."idempotency_status" AS ENUM('pending', 'completed');--> statement-breakpoint
CREATE TABLE "balances" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"balance" numeric(38, 0) DEFAULT '0' NOT NULL,
	"currency" text NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"correlation_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "account_type" NOT NULL,
	"currency" text NOT NULL,
	"code" text NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"direction" "posting_direction" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"actor_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"operation" text NOT NULL,
	"status" "idempotency_status" DEFAULT 'pending' NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_actor_id_key_pk" PRIMARY KEY("actor_id","key")
);
--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_code_uniq" ON "ledger_accounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "postings_entry_idx" ON "postings" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "postings_account_idx" ON "postings" USING btree ("account_id","id");
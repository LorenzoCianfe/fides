CREATE TYPE "public"."admin_role" AS ENUM('super_admin', 'compliance_officer', 'fraud_analyst', 'support_agent', 'auditor');--> statement-breakpoint
CREATE TYPE "public"."admin_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."pending_admin_action_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."audit_actor_type" ADD VALUE 'admin';--> statement-breakpoint
CREATE TABLE "admin_login_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"secret_issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" "admin_role" NOT NULL,
	"status" "admin_status" DEFAULT 'active' NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"totp_enrolled_at" timestamp with time zone,
	"last_totp_step" bigint,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_admin_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" "pending_admin_action_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"maker_id" uuid NOT NULL,
	"maker_reason" text,
	"checker_id" uuid,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"result_ref" text,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_admin_actions_sod_check" CHECK ("pending_admin_actions"."checker_id" IS NULL OR "pending_admin_actions"."checker_id" <> "pending_admin_actions"."maker_id")
);
--> statement-breakpoint
ALTER TABLE "admin_login_challenges" ADD CONSTRAINT "admin_login_challenges_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_admin_actions" ADD CONSTRAINT "pending_admin_actions_maker_id_admins_id_fk" FOREIGN KEY ("maker_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_admin_actions" ADD CONSTRAINT "pending_admin_actions_checker_id_admins_id_fk" FOREIGN KEY ("checker_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_login_challenges_hash_uniq" ON "admin_login_challenges" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_login_challenges_admin_idx" ON "admin_login_challenges" USING btree ("admin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_hash_uniq" ON "admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_idx" ON "admin_sessions" USING btree ("admin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admins_email_uniq" ON "admins" USING btree ("email");--> statement-breakpoint
CREATE INDEX "pending_admin_actions_status_idx" ON "pending_admin_actions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "pending_admin_actions_maker_idx" ON "pending_admin_actions" USING btree ("maker_id");
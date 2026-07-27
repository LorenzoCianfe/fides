ALTER TABLE "sca_grants" DROP CONSTRAINT "sca_grants_session_id_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "sca_grants" ADD CONSTRAINT "sca_grants_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
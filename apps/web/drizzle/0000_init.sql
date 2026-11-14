CREATE TYPE "public"."adhesion_method" AS ENUM('especes', 'virement', 'cheque', 'stripe', 'gratuit');--> statement-breakpoint
CREATE TYPE "public"."assembly_status" AS ENUM('brouillon', 'candidatures', 'vote_ouvert', 'cloturee');--> statement-breakpoint
CREATE TYPE "public"."budget_entry_type" AS ENUM('recette', 'depense');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('especes', 'virement', 'stripe', 'gratuit');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('en_attente', 'paye', 'annule');--> statement-breakpoint
CREATE TYPE "public"."poll_scope" AS ENUM('bureau', 'adherents', 'lycee');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('brouillon', 'en_cours', 'valide', 'termine', 'archive');--> statement-breakpoint
CREATE TYPE "public"."registration_mode" AS ENUM('open', 'school_code', 'invite_only');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'doing', 'done');--> statement-breakpoint
CREATE TYPE "public"."ticket_tier" AS ENUM('plein', 'reduit', 'prevente');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('president', 'tresorier', 'secretaire', 'bureau', 'prof_referent', 'adherent', 'invite');--> statement-breakpoint
CREATE TYPE "public"."vault_category" AS ENUM('statuts', 'rib', 'convention', 'photo', 'autre');--> statement-breakpoint
CREATE TYPE "public"."vote_cast_mode" AS ENUM('salle', 'en_ligne');--> statement-breakpoint
CREATE TABLE "ag_attendances" (
	"id" serial PRIMARY KEY NOT NULL,
	"assembly_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ag_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"assembly_id" integer NOT NULL,
	"user_id" integer,
	"full_name" text NOT NULL,
	"classe" text DEFAULT '' NOT NULL,
	"position_title" text NOT NULL,
	"profession_of_faith" text DEFAULT '' NOT NULL,
	"votes_count" integer DEFAULT 0 NOT NULL,
	"approved" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ag_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"assembly_id" integer NOT NULL,
	"voter_id" integer,
	"candidate_id" integer,
	"is_blank" boolean DEFAULT false NOT NULL,
	"cast_mode" "vote_cast_mode" NOT NULL,
	"anonymized" boolean DEFAULT false NOT NULL,
	"cast_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assemblies" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"location" text NOT NULL,
	"status" "assembly_status" DEFAULT 'brouillon' NOT NULL,
	"vote_opens_at" timestamp with time zone,
	"vote_closes_at" timestamp with time zone,
	"quorum_required" integer DEFAULT 1 NOT NULL,
	"pv_generated_at" timestamp with time zone,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_user_id" integer,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"details_json" text DEFAULT '{}' NOT NULL,
	"prev_hash" text NOT NULL,
	"entry_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"type" "budget_entry_type" NOT NULL,
	"category" text NOT NULL,
	"label" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"entry_date" text NOT NULL,
	"receipt_path" text,
	"receipt_mime" text,
	"created_by" integer NOT NULL,
	"validated_by" integer,
	"fiscal_year" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"event_date" timestamp with time zone NOT NULL,
	"location" text NOT NULL,
	"capacity" integer NOT NULL,
	"price_full_cents" integer DEFAULT 0 NOT NULL,
	"price_reduced_cents" integer DEFAULT 0 NOT NULL,
	"price_presale_cents" integer DEFAULT 0 NOT NULL,
	"access_code" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"stripe_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_hash" text NOT NULL,
	"email_encrypted" text NOT NULL,
	"role" "user_role" DEFAULT 'adherent' NOT NULL,
	"custom_title" text,
	"token_hash" text NOT NULL,
	"invited_by" integer NOT NULL,
	"accepted_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parcoursup_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"school_year" text NOT NULL,
	"summary_text" text DEFAULT '' NOT NULL,
	"skills_json" text DEFAULT '[]' NOT NULL,
	"hours_total" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passation_checklists" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_year" text NOT NULL,
	"step_key" text NOT NULL,
	"label" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_by" integer,
	"completed_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"poll_id" integer NOT NULL,
	"voter_key_hash" text NOT NULL,
	"option_indexes_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"scope" "poll_scope" DEFAULT 'lycee' NOT NULL,
	"options_json" text NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"multiple_choice" boolean DEFAULT false NOT NULL,
	"created_by" integer NOT NULL,
	"closes_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"hours_logged" real DEFAULT 0 NOT NULL,
	"role_in_project" text DEFAULT 'Bénévole' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"title" text NOT NULL,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"due_date" text,
	"assignee_id" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"event_date" timestamp with time zone,
	"budget_planned_cents" integer DEFAULT 0 NOT NULL,
	"status" "project_status" DEFAULT 'brouillon' NOT NULL,
	"lead_user_id" integer NOT NULL,
	"safety_checklist_json" text DEFAULT '[]' NOT NULL,
	"prof_validated_by" integer,
	"prof_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_name" text NOT NULL,
	"mdl_name" text NOT NULL,
	"primary_color" text DEFAULT '#1d4ed8' NOT NULL,
	"accent_color" text DEFAULT '#f59e0b' NOT NULL,
	"logo_url" text,
	"membership_fee_cents" integer DEFAULT 500 NOT NULL,
	"school_year" text NOT NULL,
	"legal_representative" text,
	"registration_mode" "registration_mode" DEFAULT 'open' NOT NULL,
	"school_code_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"user_agent" text,
	"ip_hash" text,
	"two_factor_verified" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"buyer_user_id" integer,
	"buyer_name" text NOT NULL,
	"buyer_email_encrypted" text NOT NULL,
	"buyer_classe" text,
	"tier" "ticket_tier" NOT NULL,
	"price_cents" integer NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"payment_status" "payment_status" DEFAULT 'en_attente' NOT NULL,
	"ed25519_token" text DEFAULT '' NOT NULL,
	"jwt_token" text DEFAULT '' NOT NULL,
	"qr_code_id" text NOT NULL,
	"scanned_at" timestamp with time zone,
	"scanned_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_encrypted" text NOT NULL,
	"email_hash" text NOT NULL,
	"legal_guardian_email_encrypted" text,
	"password_hash" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"classe" text,
	"role" "user_role" DEFAULT 'adherent' NOT NULL,
	"custom_title" text,
	"is_adherent" boolean DEFAULT false NOT NULL,
	"adhesion_paid_at" timestamp with time zone,
	"adhesion_method" "adhesion_method",
	"totp_secret_encrypted" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"magic_token_hash" text,
	"magic_token_expires_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" "vault_category" NOT NULL,
	"file_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"encrypted" boolean DEFAULT true NOT NULL,
	"uploaded_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ag_attendances" ADD CONSTRAINT "ag_attendances_assembly_id_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assemblies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ag_attendances" ADD CONSTRAINT "ag_attendances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ag_candidates" ADD CONSTRAINT "ag_candidates_assembly_id_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assemblies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ag_candidates" ADD CONSTRAINT "ag_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ag_votes" ADD CONSTRAINT "ag_votes_assembly_id_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assemblies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ag_votes" ADD CONSTRAINT "ag_votes_voter_id_users_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ag_votes" ADD CONSTRAINT "ag_votes_candidate_id_ag_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."ag_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assemblies" ADD CONSTRAINT "assemblies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcoursup_drafts" ADD CONSTRAINT "parcoursup_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passation_checklists" ADD CONSTRAINT "passation_checklists_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_user_id_users_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_prof_validated_by_users_id_fk" FOREIGN KEY ("prof_validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_scanned_by_users_id_fk" FOREIGN KEY ("scanned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_documents" ADD CONSTRAINT "vault_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ag_attendances_assembly_user_uniq" ON "ag_attendances" USING btree ("assembly_id","user_id");--> statement-breakpoint
CREATE INDEX "ag_candidates_assembly_idx" ON "ag_candidates" USING btree ("assembly_id");--> statement-breakpoint
CREATE INDEX "ag_candidates_position_idx" ON "ag_candidates" USING btree ("assembly_id","position_title");--> statement-breakpoint
CREATE UNIQUE INDEX "ag_votes_assembly_voter_active_uniq" ON "ag_votes" USING btree ("assembly_id","voter_id") WHERE voter_id IS NOT NULL AND anonymized = false;--> statement-breakpoint
CREATE INDEX "ag_votes_assembly_idx" ON "ag_votes" USING btree ("assembly_id");--> statement-breakpoint
CREATE INDEX "ag_votes_candidate_idx" ON "ag_votes" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "assemblies_status_idx" ON "assemblies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assemblies_scheduled_at_idx" ON "assemblies" USING btree ("scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_logs_entry_hash_uniq" ON "audit_logs" USING btree ("entry_hash");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "budget_entries_fiscal_year_idx" ON "budget_entries" USING btree ("fiscal_year");--> statement-breakpoint
CREATE INDEX "budget_entries_project_idx" ON "budget_entries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "budget_entries_type_idx" ON "budget_entries" USING btree ("type");--> statement-breakpoint
CREATE INDEX "budget_entries_entry_date_idx" ON "budget_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "events_date_idx" ON "events" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "events_public_idx" ON "events" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX "events_project_idx" ON "events" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_uniq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_email_hash_idx" ON "invitations" USING btree ("email_hash");--> statement-breakpoint
CREATE INDEX "invitations_invited_by_idx" ON "invitations" USING btree ("invited_by");--> statement-breakpoint
CREATE UNIQUE INDEX "parcoursup_user_year_uniq" ON "parcoursup_drafts" USING btree ("user_id","school_year");--> statement-breakpoint
CREATE UNIQUE INDEX "passation_year_step_uniq" ON "passation_checklists" USING btree ("school_year","step_key");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_votes_poll_voter_uniq" ON "poll_votes" USING btree ("poll_id","voter_key_hash");--> statement-breakpoint
CREATE INDEX "polls_is_open_idx" ON "polls" USING btree ("is_open");--> statement-breakpoint
CREATE INDEX "polls_scope_idx" ON "polls" USING btree ("scope");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_user_uniq" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_tasks_project_pos_idx" ON "project_tasks" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "project_tasks_assignee_idx" ON "project_tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_lead_user_idx" ON "projects" USING btree ("lead_user_id");--> statement-breakpoint
CREATE INDEX "projects_event_date_idx" ON "projects" USING btree ("event_date");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_uniq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_qr_code_id_uniq" ON "tickets" USING btree ("qr_code_id");--> statement-breakpoint
CREATE INDEX "tickets_event_idx" ON "tickets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "tickets_buyer_user_idx" ON "tickets" USING btree ("buyer_user_id");--> statement-breakpoint
CREATE INDEX "tickets_payment_status_idx" ON "tickets" USING btree ("payment_status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_hash_uniq" ON "users" USING btree ("email_hash");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_deleted_at_idx" ON "users" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "vault_documents_category_idx" ON "vault_documents" USING btree ("category");--> statement-breakpoint
CREATE INDEX "vault_documents_uploaded_by_idx" ON "vault_documents" USING btree ("uploaded_by");
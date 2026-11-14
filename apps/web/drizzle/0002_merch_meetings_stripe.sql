ALTER TABLE "school_settings" ADD COLUMN IF NOT EXISTS "stripe_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN IF NOT EXISTS "stripe_publishable_key" text;--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN IF NOT EXISTS "stripe_secret_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN IF NOT EXISTS "stripe_webhook_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN IF NOT EXISTS "stripe_currency" text DEFAULT 'eur' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "buyer_email_hash" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "lookup_token" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "stripe_session_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_buyer_email_hash_idx" ON "tickets" USING btree ("buyer_email_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_lookup_token_idx" ON "tickets" USING btree ("lookup_token");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merch_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'pull' NOT NULL,
	"image_url" text,
	"price_cents" integer NOT NULL,
	"supplier_cost_cents" integer DEFAULT 0 NOT NULL,
	"sizes_json" jsonb DEFAULT '["XS","S","M","L","XL","XXL"]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"zero_advance_mode" boolean DEFAULT true NOT NULL,
	"closes_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merch_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"buyer_user_id" integer,
	"buyer_name" text NOT NULL,
	"buyer_email_encrypted" text NOT NULL,
	"buyer_email_hash" text NOT NULL,
	"buyer_classe" text NOT NULL,
	"size" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"payment_method" text DEFAULT 'especes' NOT NULL,
	"payment_status" "public"."payment_status" DEFAULT 'en_attente' NOT NULL,
	"order_status" text DEFAULT 'precommande' NOT NULL,
	"stripe_session_id" text,
	"lookup_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meetings" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"scope" "public"."poll_scope" DEFAULT 'bureau' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"location" text NOT NULL,
	"agenda_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"minutes_text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'planifiee' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_attendances" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"rsvp_status" text DEFAULT 'present' NOT NULL,
	"checked_in" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "merch_items" ADD CONSTRAINT "merch_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merch_items" ADD CONSTRAINT "merch_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merch_orders" ADD CONSTRAINT "merch_orders_item_id_merch_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."merch_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merch_orders" ADD CONSTRAINT "merch_orders_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendances" ADD CONSTRAINT "meeting_attendances_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendances" ADD CONSTRAINT "meeting_attendances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merch_items_active_idx" ON "merch_items" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merch_orders_lookup_uniq" ON "merch_orders" USING btree ("lookup_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merch_orders_item_idx" ON "merch_orders" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merch_orders_buyer_user_idx" ON "merch_orders" USING btree ("buyer_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merch_orders_buyer_email_idx" ON "merch_orders" USING btree ("buyer_email_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_scheduled_idx" ON "meetings" USING btree ("scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_attendances_uniq" ON "meeting_attendances" USING btree ("meeting_id", "user_id");--> statement-breakpoint
UPDATE "roles" SET "permissions_json" = '["admin:settings","admin:roles","members:read","members:invite","members:manage","projects:read","projects:create","projects:edit","projects:validate","budget:read","budget:write","budget:close_year","ag:read","ag:manage","ag:vote","ag:generate_pv","polls:read","polls:create","polls:vote","tickets:read_admin","tickets:manage","tickets:scan","tickets:buy","merch:read","merch:buy","merch:manage","meetings:read","meetings:manage","meetings:rsvp","passation:read","passation:manage","vault:read","vault:write","parcoursup:read_own","parcoursup:export_all","audit:read"]'::jsonb WHERE "slug" = 'president';--> statement-breakpoint
UPDATE "roles" SET "permissions_json" = '["members:read","members:invite","projects:read","projects:create","projects:edit","budget:read","budget:write","budget:close_year","ag:read","ag:vote","polls:read","polls:create","polls:vote","tickets:read_admin","tickets:manage","tickets:scan","tickets:buy","merch:read","merch:buy","merch:manage","meetings:read","meetings:manage","meetings:rsvp","passation:read","passation:manage","vault:read","vault:write","parcoursup:read_own","audit:read"]'::jsonb WHERE "slug" = 'tresorier';--> statement-breakpoint
UPDATE "roles" SET "permissions_json" = '["members:read","members:invite","members:manage","projects:read","projects:create","projects:edit","budget:read","ag:read","ag:manage","ag:vote","ag:generate_pv","polls:read","polls:create","polls:vote","tickets:read_admin","tickets:scan","tickets:buy","merch:read","merch:buy","meetings:read","meetings:manage","meetings:rsvp","passation:read","passation:manage","vault:read","vault:write","parcoursup:read_own","parcoursup:export_all"]'::jsonb WHERE "slug" = 'secretaire';--> statement-breakpoint
UPDATE "roles" SET "permissions_json" = '["members:read","projects:read","projects:create","projects:edit","budget:read","ag:read","ag:vote","polls:read","polls:create","polls:vote","tickets:read_admin","tickets:scan","tickets:buy","merch:read","merch:buy","meetings:read","meetings:manage","meetings:rsvp","passation:read","vault:read","parcoursup:read_own"]'::jsonb WHERE "slug" = 'bureau';--> statement-breakpoint
UPDATE "roles" SET "permissions_json" = '["members:read","projects:read","projects:validate","budget:read","ag:read","ag:vote","polls:read","polls:vote","tickets:read_admin","merch:read","merch:buy","meetings:read","meetings:rsvp","passation:read","vault:read","parcoursup:read_own","parcoursup:export_all","audit:read"]'::jsonb WHERE "slug" = 'prof_referent';--> statement-breakpoint
UPDATE "roles" SET "permissions_json" = '["projects:read","ag:read","ag:vote","polls:read","polls:vote","tickets:buy","merch:read","merch:buy","meetings:read","meetings:rsvp","parcoursup:read_own"]'::jsonb WHERE "slug" = 'adherent';--> statement-breakpoint
UPDATE "roles" SET "permissions_json" = '["projects:read","polls:read","tickets:buy","merch:read","merch:buy"]'::jsonb WHERE "slug" = 'invite';--> statement-breakpoint
UPDATE "roles" SET "permissions_json" = "permissions_json" || '["merch:read","merch:buy"]'::jsonb WHERE NOT "is_system" AND NOT ("permissions_json" ? 'merch:read');

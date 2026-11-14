ALTER TABLE "school_settings" ADD COLUMN IF NOT EXISTS "school_city" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN IF NOT EXISTS "school_postal_code" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN IF NOT EXISTS "school_department" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN IF NOT EXISTS "school_uai" text;--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN IF NOT EXISTS "merch_supplier_name" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN IF NOT EXISTS "merch_supplier_email" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN IF NOT EXISTS "merch_supplier_url" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "school_settings" ADD COLUMN IF NOT EXISTS "setup_completed" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "merch_items" ADD COLUMN IF NOT EXISTS "supplier_name" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "merch_items" ADD COLUMN IF NOT EXISTS "supplier_email" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "merch_items" ADD COLUMN IF NOT EXISTS "supplier_url" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "merch_items" ADD COLUMN IF NOT EXISTS "supplier_reference" text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "roles" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"permissions_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_elevated" boolean DEFAULT false NOT NULL,
	"is_bureau" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "roles" ("slug", "label", "description", "permissions_json", "is_system", "is_elevated", "is_bureau") VALUES
(
	'president',
	'Président / Admin',
	'Administration complète du lycée, rôles, paramètres, budget et audit.',
	'["admin:settings","admin:roles","members:read","members:invite","members:manage","projects:read","projects:create","projects:edit","projects:validate","budget:read","budget:write","budget:close_year","ag:read","ag:manage","ag:vote","ag:generate_pv","polls:read","polls:create","polls:vote","tickets:read_admin","tickets:manage","tickets:scan","tickets:buy","passation:read","passation:manage","vault:read","vault:write","parcoursup:read_own","parcoursup:export_all","audit:read"]'::jsonb,
	true,
	true,
	true
),
(
	'tresorier',
	'Trésorier',
	'Gestion financière, budget, billetterie, clôture d’exercice et coffre.',
	'["members:read","members:invite","projects:read","projects:create","projects:edit","budget:read","budget:write","budget:close_year","ag:read","ag:vote","polls:read","polls:create","polls:vote","tickets:read_admin","tickets:manage","tickets:scan","tickets:buy","passation:read","passation:manage","vault:read","vault:write","parcoursup:read_own","audit:read"]'::jsonb,
	true,
	true,
	true
),
(
	'secretaire',
	'Secrétaire',
	'Gestion des membres, assemblées générales, PV, dossiers Parcoursup et coffre.',
	'["members:read","members:invite","members:manage","projects:read","projects:create","projects:edit","budget:read","ag:read","ag:manage","ag:vote","ag:generate_pv","polls:read","polls:create","polls:vote","tickets:read_admin","tickets:scan","tickets:buy","passation:read","passation:manage","vault:read","vault:write","parcoursup:read_own","parcoursup:export_all"]'::jsonb,
	true,
	true,
	true
),
(
	'bureau',
	'Membre du bureau',
	'Animation quotidienne : projets, sondages, scan des billets et consultation bureau.',
	'["members:read","projects:read","projects:create","projects:edit","budget:read","ag:read","ag:vote","polls:read","polls:create","polls:vote","tickets:read_admin","tickets:scan","tickets:buy","passation:read","vault:read","parcoursup:read_own"]'::jsonb,
	true,
	false,
	true
),
(
	'prof_referent',
	'Professeur référent',
	'Validation pédagogique des projets, suivi budgétaire et consultation audit.',
	'["members:read","projects:read","projects:validate","budget:read","ag:read","ag:vote","polls:read","polls:vote","tickets:read_admin","passation:read","vault:read","parcoursup:read_own","parcoursup:export_all","audit:read"]'::jsonb,
	true,
	true,
	true
),
(
	'adherent',
	'Adhérent',
	'Élève cotisant : votes AG, sondages adhérents, projets et billetterie.',
	'["projects:read","ag:read","ag:vote","polls:read","polls:vote","tickets:buy","parcoursup:read_own"]'::jsonb,
	true,
	false,
	false
),
(
	'invite',
	'Invité',
	'Élève non-cotisant : consultation publique, sondages lycée et achat de billets.',
	'["projects:read","polls:read","tickets:buy"]'::jsonb,
	true,
	false,
	false
)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" TYPE text USING "role"::text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'adherent';--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "role" TYPE text USING "role"::text;--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "role" SET DEFAULT 'adherent';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_roles_slug_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("slug") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_roles_slug_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("slug") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."user_role";

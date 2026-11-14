import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core';
import type { Permission } from '../../shared/permissions';

export const REGISTRATION_MODES = ['open', 'school_code', 'invite_only'] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

export const PROJECT_STATUSES = [
  'brouillon',
  'en_cours',
  'valide',
  'termine',
  'archive'
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const BUDGET_ENTRY_TYPES = ['recette', 'depense'] as const;
export type BudgetEntryType = (typeof BUDGET_ENTRY_TYPES)[number];

export const ASSEMBLY_STATUSES = [
  'brouillon',
  'candidatures',
  'vote_ouvert',
  'cloturee'
] as const;
export type AssemblyStatus = (typeof ASSEMBLY_STATUSES)[number];

export const VOTE_CAST_MODES = ['salle', 'en_ligne'] as const;
export type VoteCastMode = (typeof VOTE_CAST_MODES)[number];

export const POLL_SCOPES = ['bureau', 'adherents', 'lycee'] as const;
export type PollScope = (typeof POLL_SCOPES)[number];

export const TICKET_TIERS = ['plein', 'reduit', 'prevente'] as const;
export type TicketTier = (typeof TICKET_TIERS)[number];

export const PAYMENT_METHODS = ['especes', 'virement', 'stripe', 'gratuit'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['en_attente', 'paye', 'annule'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const VAULT_CATEGORIES = [
  'statuts',
  'rib',
  'convention',
  'photo',
  'autre'
] as const;
export type VaultCategory = (typeof VAULT_CATEGORIES)[number];

export const ADHESION_METHODS = [
  'especes',
  'virement',
  'cheque',
  'stripe',
  'gratuit'
] as const;
export type AdhesionMethod = (typeof ADHESION_METHODS)[number];

// Enums PostgreSQL natifs
export const registrationModeEnum = pgEnum('registration_mode', REGISTRATION_MODES);
export const adhesionMethodEnum = pgEnum('adhesion_method', ADHESION_METHODS);
export const projectStatusEnum = pgEnum('project_status', PROJECT_STATUSES);
export const taskStatusEnum = pgEnum('task_status', TASK_STATUSES);
export const budgetEntryTypeEnum = pgEnum('budget_entry_type', BUDGET_ENTRY_TYPES);
export const assemblyStatusEnum = pgEnum('assembly_status', ASSEMBLY_STATUSES);
export const voteCastModeEnum = pgEnum('vote_cast_mode', VOTE_CAST_MODES);
export const pollScopeEnum = pgEnum('poll_scope', POLL_SCOPES);
export const ticketTierEnum = pgEnum('ticket_tier', TICKET_TIERS);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);
export const vaultCategoryEnum = pgEnum('vault_category', VAULT_CATEGORIES);

// Module A — Paramètres établissement & branding MDL
export const schoolSettings = pgTable('school_settings', {
  id: serial('id').primaryKey(),
  schoolName: text('school_name').notNull(),
  schoolCity: text('school_city').notNull().default(''),
  schoolPostalCode: text('school_postal_code').notNull().default(''),
  schoolDepartment: text('school_department').notNull().default(''),
  schoolUai: text('school_uai'),
  mdlName: text('mdl_name').notNull(),
  primaryColor: text('primary_color').notNull().default('#1d4ed8'),
  accentColor: text('accent_color').notNull().default('#f59e0b'),
  logoUrl: text('logo_url'),
  membershipFeeCents: integer('membership_fee_cents').notNull().default(500),
  schoolYear: text('school_year').notNull(),
  legalRepresentative: text('legal_representative'),
  registrationMode: registrationModeEnum('registration_mode').notNull().default('open'),
  schoolCodeHash: text('school_code_hash'),
  stripeEnabled: boolean('stripe_enabled').notNull().default(false),
  stripePublishableKey: text('stripe_publishable_key'),
  stripeSecretKeyEncrypted: text('stripe_secret_key_encrypted'),
  stripeWebhookSecretEncrypted: text('stripe_webhook_secret_encrypted'),
  stripeCurrency: text('stripe_currency').notNull().default('eur'),
  merchSupplierName: text('merch_supplier_name').notNull().default(''),
  merchSupplierEmail: text('merch_supplier_email').notNull().default(''),
  merchSupplierUrl: text('merch_supplier_url').notNull().default(''),
  setupCompleted: boolean('setup_completed').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow()
});

// Module B — Utilisateurs, rôles dynamiques, adhésions & authentification
export const roles = pgTable('roles', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  description: text('description').notNull().default(''),
  permissionsJson: jsonb('permissions_json').$type<Permission[]>().notNull().default([]),
  isSystem: boolean('is_system').notNull().default(false),
  isElevated: boolean('is_elevated').notNull().default(false),
  isBureau: boolean('is_bureau').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow()
});

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    emailEncrypted: text('email_encrypted').notNull(),
    emailHash: text('email_hash').notNull(),
    legalGuardianEmailEncrypted: text('legal_guardian_email_encrypted'),
    passwordHash: text('password_hash'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    classe: text('classe'),
    role: text('role')
      .notNull()
      .default('adherent')
      .references(() => roles.slug, { onUpdate: 'cascade', onDelete: 'restrict' }),
    customTitle: text('custom_title'),
    isAdherent: boolean('is_adherent').notNull().default(false),
    adhesionPaidAt: timestamp('adhesion_paid_at', { withTimezone: true, mode: 'string' }),
    adhesionMethod: adhesionMethodEnum('adhesion_method'),
    totpSecretEncrypted: text('totp_secret_encrypted'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    magicTokenHash: text('magic_token_hash'),
    magicTokenExpiresAt: timestamp('magic_token_expires_at', {
      withTimezone: true,
      mode: 'string'
    }),
    deletionRequestedAt: timestamp('deletion_requested_at', {
      withTimezone: true,
      mode: 'string'
    }),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('users_email_hash_uniq').on(table.emailHash),
    index('users_role_idx').on(table.role),
    index('users_deleted_at_idx').on(table.deletedAt)
  ]
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'),
    twoFactorVerified: boolean('two_factor_verified').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt)
  ]
);

export const invitations = pgTable(
  'invitations',
  {
    id: serial('id').primaryKey(),
    emailHash: text('email_hash').notNull(),
    emailEncrypted: text('email_encrypted').notNull(),
    role: text('role')
      .notNull()
      .default('adherent')
      .references(() => roles.slug, { onUpdate: 'cascade', onDelete: 'restrict' }),
    customTitle: text('custom_title'),
    tokenHash: text('token_hash').notNull(),
    invitedBy: integer('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'string' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('invitations_token_hash_uniq').on(table.tokenHash),
    index('invitations_email_hash_idx').on(table.emailHash),
    index('invitations_invited_by_idx').on(table.invitedBy)
  ]
);

// Module C — Projets lycéens, Kanban & checklist sécurité
export const projects = pgTable(
  'projects',
  {
    id: serial('id').primaryKey(),
    templateId: text('template_id'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull(),
    eventDate: timestamp('event_date', { withTimezone: true, mode: 'string' }),
    budgetPlannedCents: integer('budget_planned_cents').notNull().default(0),
    status: projectStatusEnum('status').notNull().default('brouillon'),
    leadUserId: integer('lead_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    safetyChecklistJson: text('safety_checklist_json').notNull().default('[]'),
    profValidatedBy: integer('prof_validated_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    profValidatedAt: timestamp('prof_validated_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('projects_status_idx').on(table.status),
    index('projects_lead_user_idx').on(table.leadUserId),
    index('projects_event_date_idx').on(table.eventDate)
  ]
);

export const projectTasks = pgTable(
  'project_tasks',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: taskStatusEnum('status').notNull().default('todo'),
    dueDate: text('due_date'),
    assigneeId: integer('assignee_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('project_tasks_project_pos_idx').on(table.projectId, table.position),
    index('project_tasks_assignee_idx').on(table.assigneeId)
  ]
);

export const projectMembers = pgTable(
  'project_members',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    hoursLogged: real('hours_logged').notNull().default(0),
    roleInProject: text('role_in_project').notNull().default('Bénévole')
  },
  (table) => [
    uniqueIndex('project_members_project_user_uniq').on(table.projectId, table.userId),
    index('project_members_user_idx').on(table.userId)
  ]
);

// Module D — Trésorerie & pièces justificatives
export const budgetEntries = pgTable(
  'budget_entries',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id').references(() => projects.id, {
      onDelete: 'set null'
    }),
    type: budgetEntryTypeEnum('type').notNull(),
    category: text('category').notNull(),
    label: text('label').notNull(),
    amountCents: integer('amount_cents').notNull(),
    entryDate: text('entry_date').notNull(),
    receiptPath: text('receipt_path'),
    receiptMime: text('receipt_mime'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    validatedBy: integer('validated_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    fiscalYear: text('fiscal_year').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('budget_entries_fiscal_year_idx').on(table.fiscalYear),
    index('budget_entries_project_idx').on(table.projectId),
    index('budget_entries_type_idx').on(table.type),
    index('budget_entries_entry_date_idx').on(table.entryDate)
  ]
);

// Module E — Assemblées Générales, élections & vote secret anonymisé
export const assemblies = pgTable(
  'assemblies',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true, mode: 'string' }).notNull(),
    location: text('location').notNull(),
    status: assemblyStatusEnum('status').notNull().default('brouillon'),
    voteOpensAt: timestamp('vote_opens_at', { withTimezone: true, mode: 'string' }),
    voteClosesAt: timestamp('vote_closes_at', { withTimezone: true, mode: 'string' }),
    quorumRequired: integer('quorum_required').notNull().default(1),
    pvGeneratedAt: timestamp('pv_generated_at', { withTimezone: true, mode: 'string' }),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('assemblies_status_idx').on(table.status),
    index('assemblies_scheduled_at_idx').on(table.scheduledAt)
  ]
);

export const agCandidates = pgTable(
  'ag_candidates',
  {
    id: serial('id').primaryKey(),
    assemblyId: integer('assembly_id')
      .notNull()
      .references(() => assemblies.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    fullName: text('full_name').notNull(),
    classe: text('classe').notNull().default(''),
    positionTitle: text('position_title').notNull(),
    professionOfFaith: text('profession_of_faith').notNull().default(''),
    votesCount: integer('votes_count').notNull().default(0),
    approved: boolean('approved').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('ag_candidates_assembly_idx').on(table.assemblyId),
    index('ag_candidates_position_idx').on(table.assemblyId, table.positionTitle)
  ]
);

export const agVotes = pgTable(
  'ag_votes',
  {
    id: serial('id').primaryKey(),
    assemblyId: integer('assembly_id')
      .notNull()
      .references(() => assemblies.id, { onDelete: 'cascade' }),
    voterId: integer('voter_id').references(() => users.id, { onDelete: 'set null' }),
    candidateId: integer('candidate_id').references(() => agCandidates.id, {
      onDelete: 'set null'
    }),
    isBlank: boolean('is_blank').notNull().default(false),
    castMode: voteCastModeEnum('cast_mode').notNull(),
    anonymized: boolean('anonymized').notNull().default(false),
    castAt: timestamp('cast_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('ag_votes_assembly_voter_active_uniq')
      .on(table.assemblyId, table.voterId)
      .where(sql`voter_id IS NOT NULL AND anonymized = false`),
    index('ag_votes_assembly_idx').on(table.assemblyId),
    index('ag_votes_candidate_idx').on(table.candidateId)
  ]
);

export const agAttendances = pgTable(
  'ag_attendances',
  {
    id: serial('id').primaryKey(),
    assemblyId: integer('assembly_id')
      .notNull()
      .references(() => assemblies.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    present: boolean('present').notNull().default(true),
    signedAt: timestamp('signed_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('ag_attendances_assembly_user_uniq').on(table.assemblyId, table.userId)
  ]
);

// Module F — Sondages & consultations lycéennes
export const polls = pgTable(
  'polls',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    scope: pollScopeEnum('scope').notNull().default('lycee'),
    optionsJson: text('options_json').notNull(),
    isOpen: boolean('is_open').notNull().default(true),
    multipleChoice: boolean('multiple_choice').notNull().default(false),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    closesAt: timestamp('closes_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('polls_is_open_idx').on(table.isOpen),
    index('polls_scope_idx').on(table.scope)
  ]
);

export const pollVotes = pgTable(
  'poll_votes',
  {
    id: serial('id').primaryKey(),
    pollId: integer('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    voterKeyHash: text('voter_key_hash').notNull(),
    optionIndexesJson: text('option_indexes_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('poll_votes_poll_voter_uniq').on(table.pollId, table.voterKeyHash)
  ]
);

// Module G — Événements & billetterie QR signée Ed25519 / JWT
export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id').references(() => projects.id, {
      onDelete: 'set null'
    }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    eventDate: timestamp('event_date', { withTimezone: true, mode: 'string' }).notNull(),
    location: text('location').notNull(),
    capacity: integer('capacity').notNull(),
    priceFullCents: integer('price_full_cents').notNull().default(0),
    priceReducedCents: integer('price_reduced_cents').notNull().default(0),
    pricePresaleCents: integer('price_presale_cents').notNull().default(0),
    accessCode: text('access_code'),
    isPublic: boolean('is_public').notNull().default(true),
    stripeEnabled: boolean('stripe_enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('events_date_idx').on(table.eventDate),
    index('events_public_idx').on(table.isPublic),
    index('events_project_idx').on(table.projectId)
  ]
);

export const tickets = pgTable(
  'tickets',
  {
    id: serial('id').primaryKey(),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    buyerUserId: integer('buyer_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    buyerName: text('buyer_name').notNull(),
    buyerEmailEncrypted: text('buyer_email_encrypted').notNull(),
    buyerEmailHash: text('buyer_email_hash'),
    buyerClasse: text('buyer_classe'),
    tier: ticketTierEnum('tier').notNull(),
    priceCents: integer('price_cents').notNull(),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    paymentStatus: paymentStatusEnum('payment_status').notNull().default('en_attente'),
    ed25519Token: text('ed25519_token').notNull().default(''),
    jwtToken: text('jwt_token').notNull().default(''),
    qrCodeId: text('qr_code_id').notNull(),
    lookupToken: text('lookup_token'),
    stripeSessionId: text('stripe_session_id'),
    scannedAt: timestamp('scanned_at', { withTimezone: true, mode: 'string' }),
    scannedBy: integer('scanned_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('tickets_qr_code_id_uniq').on(table.qrCodeId),
    index('tickets_event_idx').on(table.eventId),
    index('tickets_buyer_user_idx').on(table.buyerUserId),
    index('tickets_buyer_email_hash_idx').on(table.buyerEmailHash),
    index('tickets_lookup_token_idx').on(table.lookupToken),
    index('tickets_payment_status_idx').on(table.paymentStatus)
  ]
);

// Module M — Boutique & précommandes merch (pulls de promo, maillots, goodies)
export const merchItems = pgTable(
  'merch_items',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id').references(() => projects.id, {
      onDelete: 'set null'
    }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull().default('pull'),
    imageUrl: text('image_url'),
    priceCents: integer('price_cents').notNull(),
    supplierCostCents: integer('supplier_cost_cents').notNull().default(0),
    supplierName: text('supplier_name').notNull().default(''),
    supplierEmail: text('supplier_email').notNull().default(''),
    supplierUrl: text('supplier_url').notNull().default(''),
    supplierReference: text('supplier_reference').notNull().default(''),
    sizesJson: jsonb('sizes_json').$type<string[]>().notNull().default(['XS', 'S', 'M', 'L', 'XL', 'XXL']),
    isActive: boolean('is_active').notNull().default(true),
    zeroAdvanceMode: boolean('zero_advance_mode').notNull().default(true),
    closesAt: timestamp('closes_at', { withTimezone: true, mode: 'string' }),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [index('merch_items_active_idx').on(table.isActive)]
);

export const merchOrders = pgTable(
  'merch_orders',
  {
    id: serial('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => merchItems.id, { onDelete: 'cascade' }),
    buyerUserId: integer('buyer_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    buyerName: text('buyer_name').notNull(),
    buyerEmailEncrypted: text('buyer_email_encrypted').notNull(),
    buyerEmailHash: text('buyer_email_hash').notNull(),
    buyerClasse: text('buyer_classe').notNull(),
    size: text('size').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPriceCents: integer('unit_price_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    paymentMethod: text('payment_method').notNull().default('especes'),
    paymentStatus: paymentStatusEnum('payment_status').notNull().default('en_attente'),
    orderStatus: text('order_status').notNull().default('precommande'),
    stripeSessionId: text('stripe_session_id'),
    lookupCode: text('lookup_code').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('merch_orders_lookup_uniq').on(table.lookupCode),
    index('merch_orders_item_idx').on(table.itemId),
    index('merch_orders_buyer_user_idx').on(table.buyerUserId),
    index('merch_orders_buyer_email_idx').on(table.buyerEmailHash)
  ]
);

// Module N — Réunions dédiées (ordre du jour, présences & comptes-rendus)
export interface MeetingAgendaItem {
  title: string;
  durationMin?: number;
  done?: boolean;
}

export const meetings = pgTable(
  'meetings',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    scope: pollScopeEnum('scope').notNull().default('bureau'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true, mode: 'string' }).notNull(),
    location: text('location').notNull(),
    agendaJson: jsonb('agenda_json').$type<MeetingAgendaItem[]>().notNull().default([]),
    minutesText: text('minutes_text').notNull().default(''),
    status: text('status').notNull().default('planifiee'),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [index('meetings_scheduled_idx').on(table.scheduledAt)]
);

export const meetingAttendances = pgTable(
  'meeting_attendances',
  {
    id: serial('id').primaryKey(),
    meetingId: integer('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rsvpStatus: text('rsvp_status').notNull().default('present'),
    checkedIn: boolean('checked_in').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('meeting_attendances_uniq').on(table.meetingId, table.userId)
  ]
);

// Module H — Coffre-fort documentaire chiffré
export const vaultDocuments = pgTable(
  'vault_documents',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    category: vaultCategoryEnum('category').notNull(),
    filePath: text('file_path').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    encrypted: boolean('encrypted').notNull().default(true),
    uploadedBy: integer('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('vault_documents_category_idx').on(table.category),
    index('vault_documents_uploaded_by_idx').on(table.uploadedBy)
  ]
);

// Module I — Passation annuelle de bureau
export const passationChecklists = pgTable(
  'passation_checklists',
  {
    id: serial('id').primaryKey(),
    schoolYear: text('school_year').notNull(),
    stepKey: text('step_key').notNull(),
    label: text('label').notNull(),
    completed: boolean('completed').notNull().default(false),
    completedBy: integer('completed_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    notes: text('notes')
  },
  (table) => [
    uniqueIndex('passation_year_step_uniq').on(table.schoolYear, table.stepKey)
  ]
);

// Module J — Attestations d'engagement & Parcoursup
export const parcoursupDrafts = pgTable(
  'parcoursup_drafts',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    schoolYear: text('school_year').notNull(),
    summaryText: text('summary_text').notNull().default(''),
    skillsJson: text('skills_json').notNull().default('[]'),
    hoursTotal: real('hours_total').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('parcoursup_user_year_uniq').on(table.userId, table.schoolYear)
  ]
);

// Module K — Notifications Web Push (VAPID)
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('push_subscriptions_endpoint_uniq').on(table.endpoint),
    index('push_subscriptions_user_idx').on(table.userId)
  ]
);

// Module L — Journal d'audit inviolable (chaîne SHA-256) & Rate limiting
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorUserId: integer('actor_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    actorRole: text('actor_role').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    detailsJson: text('details_json').notNull().default('{}'),
    prevHash: text('prev_hash').notNull(),
    entryHash: text('entry_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('audit_logs_entry_hash_uniq').on(table.entryHash),
    index('audit_logs_action_idx').on(table.action),
    index('audit_logs_target_idx').on(table.targetType, table.targetId),
    index('audit_logs_created_at_idx').on(table.createdAt),
    index('audit_logs_actor_idx').on(table.actorUserId)
  ]
);

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  resetAt: bigint('reset_at', { mode: 'number' }).notNull()
});

export type SchoolSettings = typeof schoolSettings.$inferSelect;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectTask = typeof projectTasks.$inferSelect;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type BudgetEntry = typeof budgetEntries.$inferSelect;
export type Assembly = typeof assemblies.$inferSelect;
export type AgCandidate = typeof agCandidates.$inferSelect;
export type AgVote = typeof agVotes.$inferSelect;
export type AgAttendance = typeof agAttendances.$inferSelect;
export type Poll = typeof polls.$inferSelect;
export type PollVote = typeof pollVotes.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type MerchItem = typeof merchItems.$inferSelect;
export type MerchOrder = typeof merchOrders.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type MeetingAttendance = typeof meetingAttendances.$inferSelect;
export type VaultDocument = typeof vaultDocuments.$inferSelect;
export type PassationChecklist = typeof passationChecklists.$inferSelect;
export type ParcoursupDraft = typeof parcoursupDrafts.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type RateLimit = typeof rateLimits.$inferSelect;

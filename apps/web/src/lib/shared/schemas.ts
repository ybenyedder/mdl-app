import { z } from 'zod';
import { PERMISSIONS } from './permissions';

export const roleSchema = z
  .string()
  .trim()
  .min(2, 'Identifiant de rôle trop court')
  .max(40, 'Identifiant de rôle trop long')
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'Identifiant technique invalide (lettres minuscules, chiffres et _ uniquement)'
  );

export const registerSchema = z.object({
  email: z.string().trim().email('Adresse email invalide').max(160),
  password: z
    .string()
    .min(10, 'Le mot de passe doit contenir au moins 10 caractères')
    .max(128),
  firstName: z.string().trim().min(1, 'Prénom requis').max(60),
  lastName: z.string().trim().min(1, 'Nom requis').max(60),
  classe: z.string().trim().min(1, 'Classe requise (ex: 1ère G2)').max(30),
  schoolCode: z.string().trim().max(40).optional(),
  legalGuardianEmail: z
    .union([z.string().trim().email('Email du responsable invalide').max(160), z.literal('')])
    .optional(),
  rgpdConsent: z.literal(true, {
    errorMap: () => ({ message: 'Le consentement RGPD est obligatoire' })
  })
});

export const loginSchema = z.object({
  email: z.string().trim().email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
  totpCode: z.string().trim().optional()
});

export const projectCreateSchema = z.object({
  templateId: z.string().trim().optional(),
  title: z.string().trim().min(3, 'Titre trop court').max(120),
  description: z.string().trim().max(2000).default(''),
  category: z.string().trim().min(2).max(60),
  eventDate: z.string().trim().optional(),
  budgetPlannedCents: z.number().int().min(0).max(50_000_000).default(0)
});

export const taskCreateSchema = z.object({
  title: z.string().trim().min(2).max(160),
  status: z.enum(['todo', 'doing', 'done']).default('todo'),
  dueDate: z.string().trim().optional()
});

export const budgetEntrySchema = z.object({
  projectId: z.number().int().positive().nullable().optional(),
  type: z.enum(['recette', 'depense']),
  category: z.string().trim().min(2).max(60),
  label: z.string().trim().min(2).max(160),
  amountCents: z.number().int().positive().max(50_000_000),
  entryDate: z.string().trim().min(8).max(32),
  fiscalYear: z.string().trim().min(4).max(16).default('2026-2027')
});

export const assemblyCreateSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().max(2000).default(''),
  scheduledAt: z.string().trim().min(8),
  location: z.string().trim().min(2).max(120),
  quorumRequired: z.number().int().min(1).max(2000).default(30)
});

export const candidateCreateSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  classe: z.string().trim().min(1).max(30),
  positionTitle: z.string().trim().min(2).max(80),
  professionOfFaith: z.string().trim().min(10).max(1500)
});

export const pollCreateSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(1000).default(''),
  scope: z.enum(['bureau', 'adherents', 'lycee']).default('lycee'),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(10),
  multipleChoice: z.boolean().default(false),
  closesAt: z.string().trim().optional()
});

export const eventCreateSchema = z.object({
  projectId: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().max(2000).default(''),
  eventDate: z.string().trim().min(8),
  location: z.string().trim().min(2).max(140),
  capacity: z.number().int().min(1).max(5000),
  priceFullCents: z.number().int().min(0).max(100_000),
  priceReducedCents: z.number().int().min(0).max(100_000),
  pricePresaleCents: z.number().int().min(0).max(100_000),
  accessCode: z.string().trim().max(40).optional(),
  isPublic: z.boolean().default(true)
});

export const ticketPurchaseSchema = z.object({
  eventId: z.number().int().positive(),
  buyerName: z.string().trim().min(2).max(100),
  buyerEmail: z.string().trim().email('Email invalide'),
  buyerClasse: z.string().trim().min(1).max(30),
  tier: z.enum(['plein', 'reduit', 'prevente']),
  paymentMethod: z.enum(['especes', 'virement', 'stripe', 'gratuit']),
  accessCode: z.string().trim().optional()
});

export const settingsUpdateSchema = z.object({
  schoolName: z.string().trim().min(2).max(120),
  schoolCity: z.string().trim().max(100).default(''),
  schoolPostalCode: z.string().trim().max(16).default(''),
  schoolDepartment: z.string().trim().max(80).default(''),
  schoolUai: z.string().trim().max(20).nullable().optional(),
  mdlName: z.string().trim().min(2).max(80),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  membershipFeeCents: z.number().int().min(0).max(50_000),
  schoolYear: z.string().trim().min(4).max(20),
  legalRepresentative: z.string().trim().max(120).default(''),
  merchSupplierName: z.string().trim().max(120).default(''),
  merchSupplierEmail: z.string().trim().max(160).default(''),
  merchSupplierUrl: z.string().trim().max(300).default(''),
  setupCompleted: z.boolean().optional()
});

export const permissionSchema = z.enum(PERMISSIONS);

export const roleCreateSchema = z.object({
  slug: roleSchema.optional(),
  label: z.string().trim().min(2, 'Nom du rôle trop court').max(60, 'Nom du rôle trop long'),
  description: z.string().trim().max(300).default(''),
  permissions: z.array(permissionSchema).max(PERMISSIONS.length)
});

export const roleUpdateSchema = z
  .object({
    label: z.string().trim().min(2, 'Nom du rôle trop court').max(60).optional(),
    description: z.string().trim().max(300).optional(),
    permissions: z.array(permissionSchema).max(PERMISSIONS.length).optional()
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'Aucune modification fournie.'
  });

export const roleDeleteSchema = z.object({
  reassignTo: roleSchema.default('adherent')
});

export const MERCH_CATEGORIES = [
  'pull',
  'tshirt',
  'maillot',
  'goodies',
  'yearbook',
  'autre'
] as const;

export const MERCH_ORDER_STATUSES = [
  'precommande',
  'payee',
  'commandee_fournisseur',
  'recue',
  'distribuee',
  'annulee'
] as const;

export const merchItemCreateSchema = z.object({
  projectId: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(2, 'Nom d’article trop court').max(120),
  description: z.string().trim().max(2000).default(''),
  category: z.enum(MERCH_CATEGORIES).default('pull'),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  priceCents: z.number().int().min(0).max(500_000),
  supplierCostCents: z.number().int().min(0).max(500_000).default(0),
  supplierName: z.string().trim().max(120).default(''),
  supplierEmail: z.string().trim().max(160).default(''),
  supplierUrl: z.string().trim().max(300).default(''),
  supplierReference: z.string().trim().max(100).default(''),
  sizes: z.array(z.string().trim().min(1).max(20)).min(1).max(16).default(['XS', 'S', 'M', 'L', 'XL', 'XXL']),
  zeroAdvanceMode: z.boolean().default(true),
  closesAt: z.string().trim().nullable().optional()
});

export const merchOrderCreateSchema = z.object({
  itemId: z.number().int().positive(),
  buyerName: z.string().trim().min(2, 'Nom requis').max(100),
  buyerEmail: z.string().trim().email('Email invalide').max(160),
  buyerClasse: z.string().trim().min(1, 'Classe requise').max(30),
  size: z.string().trim().min(1, 'Taille requise').max(20),
  quantity: z.number().int().min(1).max(10).default(1),
  paymentMethod: z.enum(['stripe', 'especes', 'virement', 'cheque', 'gratuit']).default('especes')
});

export const merchOrderPatchSchema = z
  .object({
    paymentStatus: z.enum(['en_attente', 'paye', 'annule']).optional(),
    orderStatus: z.enum(MERCH_ORDER_STATUSES).optional()
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'Aucune modification fournie.'
  });

export const MEETING_STATUSES = ['planifiee', 'en_cours', 'terminee', 'annulee'] as const;
export const MEETING_RSVP_STATUSES = ['present', 'absent', 'excuse', 'en_attente'] as const;

export const meetingAgendaItemSchema = z.object({
  title: z.string().trim().min(2).max(160),
  durationMin: z.number().int().min(1).max(240).optional(),
  done: z.boolean().optional()
});

export const meetingCreateSchema = z.object({
  title: z.string().trim().min(3, 'Titre requis').max(140),
  description: z.string().trim().max(2000).default(''),
  scope: z.enum(['bureau', 'adherents', 'lycee']).default('bureau'),
  scheduledAt: z.string().trim().min(8),
  location: z.string().trim().min(2, 'Lieu requis').max(140),
  agenda: z.array(meetingAgendaItemSchema).max(30).default([])
});

export const meetingPatchSchema = z
  .object({
    title: z.string().trim().min(3).max(140).optional(),
    description: z.string().trim().max(2000).optional(),
    scope: z.enum(['bureau', 'adherents', 'lycee']).optional(),
    scheduledAt: z.string().trim().min(8).optional(),
    location: z.string().trim().min(2).max(140).optional(),
    agenda: z.array(meetingAgendaItemSchema).max(30).optional(),
    minutesText: z.string().trim().max(15_000).optional(),
    status: z.enum(MEETING_STATUSES).optional()
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'Aucune modification fournie.'
  });

export const meetingRsvpSchema = z.object({
  rsvpStatus: z.enum(MEETING_RSVP_STATUSES).optional(),
  userId: z.number().int().positive().optional(),
  checkedIn: z.boolean().optional()
});

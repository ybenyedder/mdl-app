import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { decryptText, encryptText, hmacLookup } from '$lib/server/crypto';
import { db, REGISTRATION_MODES, schoolSettings } from '$lib/server/db';
import { parseJsonBody } from '$lib/server/http';
import { maskSecretHint } from '$lib/server/stripe';
import { settingsUpdateSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

const adminSettingsPutSchema = settingsUpdateSchema.extend({
  registrationMode: z.enum(REGISTRATION_MODES).optional(),
  schoolCode: z.string().trim().max(40).nullable().optional(),
  logoUrl: z.string().trim().max(500).nullable().optional(),
  stripeEnabled: z.boolean().optional(),
  stripePublishableKey: z.string().trim().max(250).nullable().optional(),
  stripeSecretKey: z.string().trim().max(250).nullable().optional(),
  stripeWebhookSecret: z.string().trim().max(250).nullable().optional(),
  stripeCurrency: z.string().trim().min(3).max(8).optional()
});

function formatPublicSettings(
  row: typeof schoolSettings.$inferSelect | undefined,
  fallback: App.Locals['settings'],
  includeAdminStripeMeta = false
) {
  if (!row) {
    return {
      schoolName: fallback.schoolName,
      schoolCity: fallback.schoolCity,
      schoolPostalCode: fallback.schoolPostalCode,
      schoolDepartment: fallback.schoolDepartment,
      schoolUai: fallback.schoolUai,
      mdlName: fallback.mdlName,
      primaryColor: fallback.primaryColor,
      accentColor: fallback.accentColor,
      logoUrl: fallback.logoUrl,
      membershipFeeCents: fallback.membershipFeeCents,
      schoolYear: fallback.schoolYear,
      legalRepresentative: '',
      registrationMode: fallback.registrationMode,
      hasSchoolCode: false,
      stripeEnabled: fallback.stripeEnabled,
      stripePublishableKey: fallback.stripePublishableKey,
      stripeCurrency: 'eur',
      merchSupplierName: fallback.merchSupplierName,
      merchSupplierEmail: fallback.merchSupplierEmail,
      merchSupplierUrl: fallback.merchSupplierUrl,
      setupCompleted: fallback.setupCompleted,
      ...(includeAdminStripeMeta
        ? {
            hasStripeSecretKey: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
            stripeSecretKeyHint: maskSecretHint(process.env.STRIPE_SECRET_KEY?.trim() || null),
            hasStripeWebhookSecret: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim())
          }
        : {}),
      updatedAt: null
    };
  }

  let secretHint: string | null = null;
  if (includeAdminStripeMeta && row.stripeSecretKeyEncrypted) {
    try {
      secretHint = maskSecretHint(decryptText(row.stripeSecretKeyEncrypted));
    } catch {
      secretHint = 'sk_••••';
    }
  } else if (includeAdminStripeMeta && process.env.STRIPE_SECRET_KEY?.trim()) {
    secretHint = maskSecretHint(process.env.STRIPE_SECRET_KEY.trim());
  }

  return {
    schoolName: row.schoolName,
    schoolCity: row.schoolCity || '',
    schoolPostalCode: row.schoolPostalCode || '',
    schoolDepartment: row.schoolDepartment || '',
    schoolUai: row.schoolUai || null,
    mdlName: row.mdlName,
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    logoUrl: row.logoUrl,
    membershipFeeCents: row.membershipFeeCents,
    schoolYear: row.schoolYear,
    legalRepresentative: row.legalRepresentative ?? '',
    registrationMode: row.registrationMode,
    hasSchoolCode: Boolean(row.schoolCodeHash),
    stripeEnabled: fallback.stripeEnabled,
    stripePublishableKey: fallback.stripePublishableKey,
    stripeCurrency: row.stripeCurrency || 'eur',
    merchSupplierName: row.merchSupplierName || '',
    merchSupplierEmail: row.merchSupplierEmail || '',
    merchSupplierUrl: row.merchSupplierUrl || '',
    setupCompleted: Boolean(row.setupCompleted),
    ...(includeAdminStripeMeta
      ? {
          hasStripeSecretKey: Boolean(
            row.stripeSecretKeyEncrypted || process.env.STRIPE_SECRET_KEY?.trim()
          ),
          stripeSecretKeyHint: secretHint,
          hasStripeWebhookSecret: Boolean(
            row.stripeWebhookSecretEncrypted || process.env.STRIPE_WEBHOOK_SECRET?.trim()
          )
        }
      : {}),
    updatedAt: row.updatedAt
  };
}

export const GET: RequestHandler = async ({ locals }) => {
  const [row] = await db.select().from(schoolSettings).limit(1);
  const isAdmin = Boolean(locals.user?.permissions.includes('admin:settings'));
  return json({
    ok: true,
    settings: formatPublicSettings(row, locals.settings, isAdmin)
  });
};

export const PUT: RequestHandler = async (event) => {
  const actor = requireAuth(event, 'admin:settings');
  const payload = await parseJsonBody(event.request, adminSettingsPutSchema);

  const [existing] = await db.select().from(schoolSettings).limit(1);
  const nextRegistrationMode =
    payload.registrationMode ?? existing?.registrationMode ?? 'open';

  let nextSchoolCodeHash: string | null = existing?.schoolCodeHash ?? null;
  let schoolCodeUpdated = false;

  if (payload.schoolCode !== undefined) {
    if (payload.schoolCode === null || payload.schoolCode === '') {
      nextSchoolCodeHash = null;
      schoolCodeUpdated = existing?.schoolCodeHash !== null;
    } else {
      nextSchoolCodeHash = hmacLookup(payload.schoolCode);
      schoolCodeUpdated = true;
    }
  }

  if (nextRegistrationMode === 'school_code' && !nextSchoolCodeHash) {
    return json(
      {
        error:
          "Un code établissement est requis lorsque le mode d'inscription est 'school_code'."
      },
      { status: 400 }
    );
  }

  let nextStripeSecretKeyEncrypted: string | null = existing?.stripeSecretKeyEncrypted ?? null;
  let stripeKeysUpdated = false;
  if (payload.stripeSecretKey !== undefined) {
    if (payload.stripeSecretKey === null || payload.stripeSecretKey === '') {
      nextStripeSecretKeyEncrypted = null;
      stripeKeysUpdated = existing?.stripeSecretKeyEncrypted !== null;
    } else {
      if (!payload.stripeSecretKey.startsWith('sk_') && !payload.stripeSecretKey.startsWith('rk_')) {
        return json(
          { error: 'La clé secrète Stripe doit commencer par sk_test_, sk_live_ ou rk_.' },
          { status: 400 }
        );
      }
      nextStripeSecretKeyEncrypted = encryptText(payload.stripeSecretKey);
      stripeKeysUpdated = true;
    }
  }

  let nextStripeWebhookSecretEncrypted: string | null =
    existing?.stripeWebhookSecretEncrypted ?? null;
  if (payload.stripeWebhookSecret !== undefined) {
    if (payload.stripeWebhookSecret === null || payload.stripeWebhookSecret === '') {
      nextStripeWebhookSecretEncrypted = null;
      stripeKeysUpdated = stripeKeysUpdated || existing?.stripeWebhookSecretEncrypted !== null;
    } else {
      if (!payload.stripeWebhookSecret.startsWith('whsec_')) {
        return json(
          { error: 'Le secret webhook Stripe doit commencer par whsec_.' },
          { status: 400 }
        );
      }
      nextStripeWebhookSecretEncrypted = encryptText(payload.stripeWebhookSecret);
      stripeKeysUpdated = true;
    }
  }

  const nextStripePublishableKey =
    payload.stripePublishableKey !== undefined
      ? payload.stripePublishableKey || null
      : (existing?.stripePublishableKey ?? null);

  if (
    nextStripePublishableKey &&
    !nextStripePublishableKey.startsWith('pk_test_') &&
    !nextStripePublishableKey.startsWith('pk_live_')
  ) {
    return json(
      { error: 'La clé publique Stripe doit commencer par pk_test_ ou pk_live_.' },
      { status: 400 }
    );
  }

  const nextStripeEnabled =
    payload.stripeEnabled !== undefined
      ? payload.stripeEnabled
      : (existing?.stripeEnabled ?? false);

  if (
    nextStripeEnabled &&
    !nextStripeSecretKeyEncrypted &&
    !process.env.STRIPE_SECRET_KEY?.trim()
  ) {
    return json(
      { error: 'Renseigne la clé secrète Stripe (sk_...) avant d’activer le paiement CB.' },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  const values = {
    schoolName: payload.schoolName,
    schoolCity: payload.schoolCity ?? existing?.schoolCity ?? '',
    schoolPostalCode: payload.schoolPostalCode ?? existing?.schoolPostalCode ?? '',
    schoolDepartment: payload.schoolDepartment ?? existing?.schoolDepartment ?? '',
    schoolUai: payload.schoolUai !== undefined ? payload.schoolUai || null : (existing?.schoolUai ?? null),
    mdlName: payload.mdlName,
    primaryColor: payload.primaryColor,
    accentColor: payload.accentColor,
    logoUrl: payload.logoUrl !== undefined ? payload.logoUrl || null : (existing?.logoUrl ?? null),
    membershipFeeCents: payload.membershipFeeCents,
    schoolYear: payload.schoolYear,
    legalRepresentative: payload.legalRepresentative,
    registrationMode: nextRegistrationMode,
    schoolCodeHash: nextSchoolCodeHash,
    stripeEnabled: nextStripeEnabled,
    stripePublishableKey: nextStripePublishableKey,
    stripeSecretKeyEncrypted: nextStripeSecretKeyEncrypted,
    stripeWebhookSecretEncrypted: nextStripeWebhookSecretEncrypted,
    stripeCurrency: (payload.stripeCurrency ?? existing?.stripeCurrency ?? 'eur').toLowerCase(),
    merchSupplierName: payload.merchSupplierName ?? existing?.merchSupplierName ?? '',
    merchSupplierEmail: payload.merchSupplierEmail ?? existing?.merchSupplierEmail ?? '',
    merchSupplierUrl: payload.merchSupplierUrl ?? existing?.merchSupplierUrl ?? '',
    setupCompleted: payload.setupCompleted ?? existing?.setupCompleted ?? false,
    updatedAt: nowIso
  };

  let saved: typeof schoolSettings.$inferSelect;
  if (existing) {
    const [updated] = await db
      .update(schoolSettings)
      .set(values)
      .where(eq(schoolSettings.id, existing.id))
      .returning();
    saved = updated;
  } else {
    const [inserted] = await db.insert(schoolSettings).values(values).returning();
    saved = inserted;
  }

  await appendAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'admin.settings_updated',
    targetType: 'school_settings',
    targetId: saved.id,
    details: {
      registrationMode: saved.registrationMode,
      schoolCodeUpdated,
      schoolYear: saved.schoolYear,
      stripeEnabled: saved.stripeEnabled,
      stripeKeysUpdated
    }
  });

  const resolvedLocals = {
    ...event.locals.settings,
    stripeEnabled: Boolean(
      saved.stripeEnabled &&
        (saved.stripeSecretKeyEncrypted || process.env.STRIPE_SECRET_KEY?.trim())
    ),
    stripePublishableKey:
      saved.stripePublishableKey || process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || null
  };

  return json({
    ok: true,
    settings: formatPublicSettings(saved, resolvedLocals, true)
  });
};

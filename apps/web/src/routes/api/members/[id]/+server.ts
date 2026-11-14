import { json } from '@sveltejs/kit';
import { and, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { safeDecrypt } from '$lib/server/api-helpers';
import { appendAuditLog } from '$lib/server/audit';
import { invalidateAllUserSessions, requireAuth } from '$lib/server/auth';
import { ADHESION_METHODS, db, invitations, users } from '$lib/server/db';
import { parseJsonBody, parsePositiveIntId } from '$lib/server/http';
import { findRoleBySlug } from '$lib/server/roles';
import { hasPermission, isElevatedRole, type Role } from '$shared/permissions';
import { roleSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

const memberPatchSchema = z
  .object({
    role: roleSchema.optional(),
    customTitle: z.string().trim().max(80).nullable().optional(),
    isAdherent: z.boolean().optional(),
    adhesionMethod: z.enum(ADHESION_METHODS).nullable().optional(),
    adhesionPaidAt: z
      .string()
      .trim()
      .refine((val) => !Number.isNaN(Date.parse(val)), 'Date invalide')
      .nullable()
      .optional(),
    classe: z.string().trim().min(1).max(30).optional()
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'Aucun champ à mettre à jour.'
  });

export const PATCH: RequestHandler = async (event) => {
  const actor = requireAuth(event);
  const targetId = parsePositiveIntId(event.params.id, 'Identifiant membre');
  const patch = await parseJsonBody(event.request, memberPatchSchema);

  const [target] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, targetId), isNull(users.deletedAt)))
    .limit(1);

  if (!target) {
    return json({ error: 'Membre introuvable.' }, { status: 404 });
  }

  if (patch.role !== undefined) {
    if (patch.role === 'president' && actor.role !== 'president') {
      return json(
        { error: 'Seul un président peut promouvoir un membre au rang de président.' },
        { status: 403 }
      );
    }

    if (target.role === 'president' && actor.role !== 'president') {
      return json(
        { error: 'Seul un président peut modifier le rôle d’un président.' },
        { status: 403 }
      );
    }

    const targetRoleDef = await findRoleBySlug(patch.role);
    if (!targetRoleDef) {
      return json({ error: `Rôle introuvable : ${patch.role}.` }, { status: 400 });
    }

    const currentRoleDef = await findRoleBySlug(target.role);

    if (target.role === 'president' && patch.role !== 'president') {
      const [{ total }] = await db
        .select({ total: count() })
        .from(users)
        .where(and(eq(users.role, 'president'), isNull(users.deletedAt)));
      if (Number(total) <= 1) {
        return json(
          { error: 'Impossible de rétrograder le dernier président actif.' },
          { status: 400 }
        );
      }
    }

    const involvesElevatedRole =
      targetRoleDef.isElevated ||
      Boolean(currentRoleDef?.isElevated) ||
      isElevatedRole(patch.role) ||
      isElevatedRole(target.role as Role);

    if (involvesElevatedRole && !hasPermission(actor.role, 'admin:roles')) {
      return json(
        { error: 'Permission admin:roles requise pour attribuer ou modifier ce rôle.' },
        { status: 403 }
      );
    }

    if (
      !involvesElevatedRole &&
      !hasPermission(actor.role, 'admin:roles') &&
      !hasPermission(actor.role, 'members:manage')
    ) {
      return json({ error: 'Accès refusé pour modifier ce rôle.' }, { status: 403 });
    }
  }

  if (patch.customTitle !== undefined) {
    if (
      !hasPermission(actor.role, 'admin:roles') &&
      !hasPermission(actor.role, 'members:manage')
    ) {
      return json({ error: 'Accès refusé pour modifier le titre.' }, { status: 403 });
    }
  }

  if (
    patch.isAdherent !== undefined ||
    patch.adhesionMethod !== undefined ||
    patch.adhesionPaidAt !== undefined ||
    patch.classe !== undefined
  ) {
    if (!hasPermission(actor.role, 'members:manage')) {
      return json(
        { error: 'Permission members:manage requise pour gérer les adhésions.' },
        { status: 403 }
      );
    }
  }

  const nowIso = new Date().toISOString();
  const nextAdhesionPaidAt =
    patch.adhesionPaidAt !== undefined
      ? patch.adhesionPaidAt
        ? new Date(patch.adhesionPaidAt).toISOString()
        : null
      : patch.isAdherent === true && !target.adhesionPaidAt
        ? nowIso
        : target.adhesionPaidAt;

  const [updated] = await db
    .update(users)
    .set({
      role: patch.role ?? target.role,
      customTitle: patch.customTitle !== undefined ? patch.customTitle : target.customTitle,
      isAdherent: patch.isAdherent !== undefined ? patch.isAdherent : target.isAdherent,
      adhesionMethod:
        patch.adhesionMethod !== undefined ? patch.adhesionMethod : target.adhesionMethod,
      adhesionPaidAt: nextAdhesionPaidAt,
      classe: patch.classe !== undefined ? patch.classe : target.classe,
      updatedAt: nowIso
    })
    .where(eq(users.id, target.id))
    .returning();

  await appendAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'members.updated',
    targetType: 'user',
    targetId: updated.id,
    details: {
      previousRole: target.role,
      newRole: updated.role,
      isAdherent: updated.isAdherent,
      adhesionMethod: updated.adhesionMethod
    }
  });

  return json({
    ok: true,
    member: {
      id: updated.id,
      email: safeDecrypt(updated.emailEncrypted, 'chiffrement-indisponible'),
      firstName: updated.firstName,
      lastName: updated.lastName,
      classe: updated.classe,
      role: updated.role,
      customTitle: updated.customTitle,
      isAdherent: updated.isAdherent,
      adhesionPaidAt: updated.adhesionPaidAt,
      adhesionMethod: updated.adhesionMethod,
      totpEnabled: updated.totpEnabled
    }
  });
};

export const DELETE: RequestHandler = async (event) => {
  const targetId = parsePositiveIntId(event.params.id, 'Identifiant');

  if (event.url.searchParams.get('type') === 'invitation') {
    const actor = requireAuth(event, 'members:invite');
    const [deletedInv] = await db
      .delete(invitations)
      .where(and(eq(invitations.id, targetId), isNull(invitations.acceptedAt)))
      .returning({ id: invitations.id });

    if (!deletedInv) {
      return json({ error: 'Invitation introuvable ou déjà acceptée.' }, { status: 404 });
    }

    await appendAuditLog({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'members.invite_revoked',
      targetType: 'invitation',
      targetId: deletedInv.id
    });

    return json({ ok: true, id: deletedInv.id });
  }

  const actor = requireAuth(event, 'members:manage');

  if (actor.id === targetId) {
    return json(
      { error: 'Utilisez /api/rgpd/delete pour demander la suppression de votre propre compte.' },
      { status: 400 }
    );
  }

  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.id, targetId), isNull(users.deletedAt)))
    .limit(1);

  if (!target) {
    return json({ error: 'Membre introuvable.' }, { status: 404 });
  }

  if (target.role === 'president' && actor.role !== 'president') {
    return json(
      { error: 'Seul un président peut archiver un compte président.' },
      { status: 403 }
    );
  }

  const nowIso = new Date().toISOString();

  await db
    .update(users)
    .set({
      deletedAt: nowIso,
      isAdherent: false,
      magicTokenHash: null,
      magicTokenExpiresAt: null,
      updatedAt: nowIso
    })
    .where(eq(users.id, target.id));

  await invalidateAllUserSessions(target.id);

  await appendAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'members.archived',
    targetType: 'user',
    targetId: target.id
  });

  return json({ ok: true, id: target.id });
};

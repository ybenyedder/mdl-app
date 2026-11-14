import { json } from '@sveltejs/kit';
import { and, count, eq, isNull } from 'drizzle-orm';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db, invitations, roles, users } from '$lib/server/db';
import { parseJsonBody } from '$lib/server/http';
import { findRoleBySlug, loadRolesCatalog } from '$lib/server/roles';
import { computeRoleFlags } from '$shared/permissions';
import { roleDeleteSchema, roleSchema, roleUpdateSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
  const actor = requireAuth(event, 'admin:roles');
  const parsedSlug = roleSchema.safeParse(event.params.slug);
  if (!parsedSlug.success) {
    return json({ error: 'Identifiant de rôle invalide.' }, { status: 400 });
  }
  const slug = parsedSlug.data;

  const existing = await findRoleBySlug(slug);
  if (!existing) {
    return json({ error: 'Rôle introuvable.' }, { status: 404 });
  }

  const patch = await parseJsonBody(event.request, roleUpdateSchema);
  const nextPermissions =
    patch.permissions !== undefined
      ? Array.from(new Set(patch.permissions))
      : existing.permissions;

  if (slug === 'president') {
    if (!nextPermissions.includes('admin:roles') || !nextPermissions.includes('admin:settings')) {
      return json(
        {
          error:
            'Le rôle Président doit conserver les permissions admin:roles et admin:settings.'
        },
        { status: 400 }
      );
    }
  }

  const nextLabel = patch.label ?? existing.label;
  const nextDescription = patch.description ?? existing.description;
  const flags = computeRoleFlags(slug, nextPermissions);
  const nowIso = new Date().toISOString();

  const [updated] = await db
    .update(roles)
    .set({
      label: nextLabel,
      description: nextDescription,
      permissionsJson: nextPermissions,
      isElevated: flags.isElevated,
      isBureau: flags.isBureau,
      updatedAt: nowIso
    })
    .where(eq(roles.slug, slug))
    .returning();

  await loadRolesCatalog();

  await appendAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'admin.role_updated',
    targetType: 'role',
    targetId: slug,
    details: {
      label: nextLabel,
      permissionsCount: nextPermissions.length,
      isElevated: flags.isElevated,
      isBureau: flags.isBureau
    }
  });

  return json({
    ok: true,
    role: {
      slug: updated.slug,
      label: updated.label,
      description: updated.description,
      permissions: nextPermissions,
      isSystem: updated.isSystem,
      isElevated: updated.isElevated,
      isBureau: updated.isBureau
    }
  });
};

export const DELETE: RequestHandler = async (event) => {
  const actor = requireAuth(event, 'admin:roles');
  const parsedSlug = roleSchema.safeParse(event.params.slug);
  if (!parsedSlug.success) {
    return json({ error: 'Identifiant de rôle invalide.' }, { status: 400 });
  }
  const slug = parsedSlug.data;

  const existing = await findRoleBySlug(slug);
  if (!existing) {
    return json({ error: 'Rôle introuvable.' }, { status: 404 });
  }

  if (existing.isSystem) {
    return json(
      { error: 'Impossible de supprimer un rôle système natif.' },
      { status: 400 }
    );
  }

  let reassignTo = event.url.searchParams.get('reassignTo')?.trim() || '';
  if (!reassignTo) {
    const contentLength = event.request.headers.get('content-length');
    if (contentLength && Number(contentLength) > 0) {
      const body = await parseJsonBody(event.request, roleDeleteSchema);
      reassignTo = body.reassignTo;
    } else {
      reassignTo = 'adherent';
    }
  }

  const parsedFallback = roleSchema.safeParse(reassignTo);
  if (!parsedFallback.success) {
    return json({ error: 'Rôle de réaffectation invalide.' }, { status: 400 });
  }
  reassignTo = parsedFallback.data;

  if (reassignTo === slug) {
    return json(
      { error: 'Le rôle de réaffectation doit être différent du rôle supprimé.' },
      { status: 400 }
    );
  }

  const fallbackRole = await findRoleBySlug(reassignTo);
  if (!fallbackRole) {
    return json({ error: `Rôle de réaffectation introuvable : ${reassignTo}.` }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    const [{ total }] = await tx
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.role, slug), isNull(users.deletedAt)));

    await tx
      .update(users)
      .set({ role: reassignTo, updatedAt: new Date().toISOString() })
      .where(eq(users.role, slug));

    await tx
      .update(invitations)
      .set({ role: reassignTo })
      .where(eq(invitations.role, slug));

    await tx.delete(roles).where(eq(roles.slug, slug));

    return { reassignedUsers: Number(total) };
  });

  await loadRolesCatalog();

  await appendAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'admin.role_deleted',
    targetType: 'role',
    targetId: slug,
    details: {
      label: existing.label,
      reassignTo,
      reassignedUsers: result.reassignedUsers
    }
  });

  return json({
    ok: true,
    deletedSlug: slug,
    reassignTo,
    reassignedUsers: result.reassignedUsers
  });
};

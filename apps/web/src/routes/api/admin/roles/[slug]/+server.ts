import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db, roles } from '$lib/server/db';
import { parseJsonBody } from '$lib/server/http';
import {
  RoleDeletionError,
  deleteRoleWithReassignment,
  findRoleBySlug,
  loadRolesCatalog
} from '$lib/server/roles';
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

  let reassignTo = event.url.searchParams.get('reassignTo')?.trim() || '';
  if (!reassignTo) {
    const contentLength = event.request.headers.get('content-length');
    if (contentLength && Number(contentLength) > 0) {
      const body = await parseJsonBody(event.request, roleDeleteSchema);
      reassignTo = body.reassignTo;
    }
  }

  if (reassignTo) {
    const parsedFallback = roleSchema.safeParse(reassignTo);
    if (!parsedFallback.success) {
      return json({ error: 'Rôle de réaffectation invalide.' }, { status: 400 });
    }
    reassignTo = parsedFallback.data;
  }

  try {
    const result = await deleteRoleWithReassignment(
      slug,
      actor.role,
      reassignTo || undefined
    );

    await appendAuditLog({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'admin.role_deleted',
      targetType: 'role',
      targetId: slug,
      details: {
        label: result.deletedLabel,
        reassignTo: result.reassignTo,
        reassignedUsers: result.reassignedUsers
      }
    });

    return json({
      ok: true,
      deletedSlug: result.deletedSlug,
      reassignTo: result.reassignTo,
      reassignedUsers: result.reassignedUsers
    });
  } catch (err) {
    if (err instanceof RoleDeletionError) {
      return json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
};

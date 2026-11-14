import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db, roles } from '$lib/server/db';
import { parseJsonBody } from '$lib/server/http';
import { loadRolesCatalog, loadRolesWithCounts } from '$lib/server/roles';
import { computeRoleFlags, slugifyRoleLabel } from '$shared/permissions';
import { roleCreateSchema, roleSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  requireAuth(event);
  const catalog = await loadRolesWithCounts();
  return json({ ok: true, roles: catalog });
};

export const POST: RequestHandler = async (event) => {
  const actor = requireAuth(event, 'admin:roles');
  const payload = await parseJsonBody(event.request, roleCreateSchema);

  const derivedSlug = payload.slug?.trim() || slugifyRoleLabel(payload.label);
  const parsedSlug = roleSchema.safeParse(derivedSlug);
  if (!parsedSlug.success) {
    return json(
      {
        error:
          parsedSlug.error.issues[0]?.message ||
          'Identifiant technique invalide pour ce rôle (ex : resp_communication).'
      },
      { status: 400 }
    );
  }

  const slug = parsedSlug.data;
  const [existing] = await db.select({ slug: roles.slug }).from(roles).where(eq(roles.slug, slug)).limit(1);
  if (existing) {
    return json(
      { error: `Un rôle avec l’identifiant « ${slug} » existe déjà.` },
      { status: 409 }
    );
  }

  const uniquePermissions = Array.from(new Set(payload.permissions));
  const flags = computeRoleFlags(slug, uniquePermissions);
  const nowIso = new Date().toISOString();

  const [created] = await db
    .insert(roles)
    .values({
      slug,
      label: payload.label,
      description: payload.description,
      permissionsJson: uniquePermissions,
      isSystem: false,
      isElevated: flags.isElevated,
      isBureau: flags.isBureau,
      createdAt: nowIso,
      updatedAt: nowIso
    })
    .returning();

  await loadRolesCatalog();

  await appendAuditLog({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'admin.role_created',
    targetType: 'role',
    targetId: created.slug,
    details: {
      label: created.label,
      permissionsCount: uniquePermissions.length,
      isElevated: flags.isElevated,
      isBureau: flags.isBureau
    }
  });

  return json(
    {
      ok: true,
      role: {
        slug: created.slug,
        label: created.label,
        description: created.description,
        permissions: uniquePermissions,
        isSystem: created.isSystem,
        isElevated: created.isElevated,
        isBureau: created.isBureau,
        memberCount: 0
      }
    },
    { status: 201 }
  );
};

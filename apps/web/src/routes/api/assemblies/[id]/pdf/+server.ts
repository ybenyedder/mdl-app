import { error } from '@sveltejs/kit';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { agAttendances, agCandidates, agVotes, assemblies, users } from '$lib/server/db/schema';
import { parsePositiveIntId, pdfResponse } from '$lib/server/http';
import {
  generateConvocationPdf,
  generateEmargementPdf,
  generatePvAgPdf
} from '$lib/server/pdf';
import { hasAnyPermission } from '$shared/permissions';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = requireAuth(event, 'ag:read');
  const id = parsePositiveIntId(event.params.id, 'Assemblée');
  const pdfType = event.url.searchParams.get('type') || 'convocation';

  const [assembly] = await db.select().from(assemblies).where(eq(assemblies.id, id)).limit(1);
  if (!assembly) {
    throw error(404, 'Assemblée générale introuvable.');
  }

  const { schoolName, mdlName } = event.locals.settings;

  if (pdfType === 'convocation') {
    const bytes = await generateConvocationPdf({
      schoolName,
      mdlName,
      assemblyTitle: assembly.title,
      scheduledAt: assembly.scheduledAt,
      location: assembly.location,
      description: assembly.description,
      quorumRequired: assembly.quorumRequired
    });
    return pdfResponse(bytes, `convocation-ag-${id}.pdf`);
  }

  if (pdfType === 'emargement') {
    if (!hasAnyPermission(user.role, ['ag:manage', 'ag:generate_pv', 'members:read'])) {
      throw error(403, 'Accès refusé à la liste d’émargement nominative.');
    }

    const [adherents, attendances] = await Promise.all([
      db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          classe: users.classe
        })
        .from(users)
        .where(and(eq(users.isAdherent, true), isNull(users.deletedAt)))
        .orderBy(asc(users.lastName), asc(users.firstName)),
      db
        .select({ userId: agAttendances.userId, present: agAttendances.present })
        .from(agAttendances)
        .where(eq(agAttendances.assemblyId, id))
    ]);

    const presentSet = new Set(attendances.filter((a) => a.present).map((a) => a.userId));

    const bytes = await generateEmargementPdf({
      schoolName,
      mdlName,
      assemblyTitle: assembly.title,
      scheduledAt: assembly.scheduledAt,
      members: adherents.map((m) => ({
        fullName: `${m.lastName.toUpperCase()} ${m.firstName}`,
        classe: m.classe || 'Non renseignée',
        present: presentSet.has(m.id)
      }))
    });

    return pdfResponse(bytes, `emargement-ag-${id}.pdf`);
  }

  if (pdfType === 'pv') {
    if (!hasAnyPermission(user.role, ['ag:generate_pv', 'ag:manage'])) {
      throw error(403, 'Permission ag:generate_pv ou ag:manage requise pour générer le PV.');
    }

    const [candidates, totalRow, blankRow] = await Promise.all([
      db.select().from(agCandidates).where(eq(agCandidates.assemblyId, id)),
      db.select({ total: count() }).from(agVotes).where(eq(agVotes.assemblyId, id)),
      db
        .select({ total: count() })
        .from(agVotes)
        .where(and(eq(agVotes.assemblyId, id), eq(agVotes.isBlank, true)))
    ]);

    if (!assembly.pvGeneratedAt) {
      await db
        .update(assemblies)
        .set({ pvGeneratedAt: new Date().toISOString() })
        .where(eq(assemblies.id, id));
    }

    const bytes = await generatePvAgPdf({
      schoolName,
      mdlName,
      assemblyTitle: assembly.title,
      scheduledAt: assembly.scheduledAt,
      location: assembly.location,
      totalVoters: Number(totalRow[0]?.total ?? 0),
      quorumRequired: assembly.quorumRequired,
      blankVotes: Number(blankRow[0]?.total ?? 0),
      candidates: candidates.map((c) => ({
        fullName: c.fullName,
        classe: c.classe,
        positionTitle: c.positionTitle,
        votesCount: c.votesCount
      }))
    });

    await appendAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'ag:pv_generate',
      targetType: 'assembly',
      targetId: id
    });

    return pdfResponse(bytes, `pv-ag-${id}.pdf`);
  }

  throw error(400, 'Paramètre type invalide (convocation, emargement ou pv attendu).');
};

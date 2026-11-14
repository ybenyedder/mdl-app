import { error, json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { meetingAttendances, meetings, users } from '$lib/server/db/schema';
import { parseJsonBody, parsePositiveIntId, pdfResponse } from '$lib/server/http';
import { generateMeetingMinutesPdf } from '$lib/server/pdf';
import { canAccessPollScope } from '$lib/server/polls';
import { getRoleLabel, hasPermission } from '$shared/permissions';
import { meetingPatchSchema, meetingRsvpSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = requireAuth(event, 'meetings:read');
  const id = parsePositiveIntId(event.params.id, 'Réunion');

  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  if (!meeting) {
    throw error(404, 'Réunion introuvable.');
  }
  if (!hasPermission(user.role, 'meetings:manage') && !canAccessPollScope(user, meeting.scope)) {
    throw error(403, 'Accès refusé à cette réunion.');
  }

  const attendeesRows = await db
    .select({
      userId: meetingAttendances.userId,
      rsvpStatus: meetingAttendances.rsvpStatus,
      checkedIn: meetingAttendances.checkedIn,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      customTitle: users.customTitle
    })
    .from(meetingAttendances)
    .innerJoin(users, eq(meetingAttendances.userId, users.id))
    .where(eq(meetingAttendances.meetingId, id))
    .orderBy(asc(users.lastName));

  const attendees = attendeesRows.map((a) => ({
    name: `${a.firstName} ${a.lastName}`,
    roleLabel: getRoleLabel(a.role, a.customTitle),
    rsvpStatus: a.rsvpStatus,
    checkedIn: a.checkedIn
  }));

  if (event.url.searchParams.get('format') === 'pdf') {
    const bytes = await generateMeetingMinutesPdf({
      schoolName: event.locals.settings.schoolName,
      mdlName: event.locals.settings.mdlName,
      title: meeting.title,
      scheduledAt: meeting.scheduledAt,
      location: meeting.location,
      scope: meeting.scope,
      agenda: meeting.agendaJson,
      attendees,
      minutesText: meeting.minutesText
    });
    return pdfResponse(bytes, `compte-rendu-reunion-${meeting.id}.pdf`);
  }

  return json({
    meeting: {
      ...meeting,
      agenda: meeting.agendaJson,
      attendees
    }
  });
};

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event, 'meetings:rsvp');
  const id = parsePositiveIntId(event.params.id, 'Réunion');
  const body = await parseJsonBody(event.request, meetingRsvpSchema);

  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  if (!meeting) {
    throw error(404, 'Réunion introuvable.');
  }

  const canManage = hasPermission(user.role, 'meetings:manage');
  if (!canManage && !canAccessPollScope(user, meeting.scope)) {
    throw error(403, 'Accès refusé à cette réunion.');
  }

  const targetUserId = body.userId && canManage ? body.userId : user.id;
  const [existing] = await db
    .select()
    .from(meetingAttendances)
    .where(
      and(eq(meetingAttendances.meetingId, id), eq(meetingAttendances.userId, targetUserId))
    )
    .limit(1);

  const nextRsvp = body.rsvpStatus ?? existing?.rsvpStatus ?? 'present';
  const nextCheckedIn =
    body.checkedIn !== undefined && canManage ? body.checkedIn : (existing?.checkedIn ?? false);
  const nowIso = new Date().toISOString();

  if (existing) {
    await db
      .update(meetingAttendances)
      .set({ rsvpStatus: nextRsvp, checkedIn: nextCheckedIn, updatedAt: nowIso })
      .where(eq(meetingAttendances.id, existing.id));
  } else {
    await db.insert(meetingAttendances).values({
      meetingId: id,
      userId: targetUserId,
      rsvpStatus: nextRsvp,
      checkedIn: nextCheckedIn,
      updatedAt: nowIso
    });
  }

  return json({ ok: true, rsvpStatus: nextRsvp, checkedIn: nextCheckedIn });
};

export const PATCH: RequestHandler = async (event) => {
  const user = requireAuth(event, 'meetings:manage');
  const id = parsePositiveIntId(event.params.id, 'Réunion');
  const patch = await parseJsonBody(event.request, meetingPatchSchema);

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.scope !== undefined) updates.scope = patch.scope;
  if (patch.scheduledAt !== undefined) updates.scheduledAt = new Date(patch.scheduledAt).toISOString();
  if (patch.location !== undefined) updates.location = patch.location;
  if (patch.agenda !== undefined) updates.agendaJson = patch.agenda;
  if (patch.minutesText !== undefined) updates.minutesText = patch.minutesText;
  if (patch.status !== undefined) updates.status = patch.status;

  const [updated] = await db
    .update(meetings)
    .set(updates)
    .where(eq(meetings.id, id))
    .returning();

  if (!updated) {
    throw error(404, 'Réunion introuvable.');
  }

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'meeting:updated',
    targetType: 'meeting',
    targetId: id,
    details: { status: updated.status, hasMinutes: updated.minutesText.length > 0 }
  });

  return json({ meeting: { ...updated, agenda: updated.agendaJson } });
};

export const DELETE: RequestHandler = async (event) => {
  const user = requireAuth(event, 'meetings:manage');
  const id = parsePositiveIntId(event.params.id, 'Réunion');

  const [deleted] = await db
    .delete(meetings)
    .where(eq(meetings.id, id))
    .returning({ id: meetings.id, title: meetings.title });

  if (!deleted) {
    throw error(404, 'Réunion introuvable.');
  }

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'meeting:deleted',
    targetType: 'meeting',
    targetId: id,
    details: { title: deleted.title }
  });

  return json({ ok: true });
};

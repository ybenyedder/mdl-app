import { error, json } from '@sveltejs/kit';
import { asc, desc, eq } from 'drizzle-orm';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { meetingAttendances, meetings, users } from '$lib/server/db/schema';
import { parseJsonBody } from '$lib/server/http';
import { canAccessPollScope } from '$lib/server/polls';
import { getRoleLabel, hasPermission } from '$shared/permissions';
import { meetingCreateSchema } from '$shared/schemas';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const user = requireAuth(event, 'meetings:read');

  const [meetingRows, attendanceRows] = await Promise.all([
    db.select().from(meetings).orderBy(desc(meetings.scheduledAt), desc(meetings.id)),
    db
      .select({
        meetingId: meetingAttendances.meetingId,
        userId: meetingAttendances.userId,
        rsvpStatus: meetingAttendances.rsvpStatus,
        checkedIn: meetingAttendances.checkedIn,
        firstName: users.firstName,
        lastName: users.lastName,
        classe: users.classe,
        role: users.role,
        customTitle: users.customTitle
      })
      .from(meetingAttendances)
      .innerJoin(users, eq(meetingAttendances.userId, users.id))
      .orderBy(asc(users.lastName), asc(users.firstName))
  ]);

  const canManage = hasPermission(user.role, 'meetings:manage');
  const visibleMeetings = meetingRows.filter((m) =>
    canManage ? true : canAccessPollScope(user, m.scope)
  );

  const attendeesMap = new Map<number, typeof attendanceRows>();
  for (const row of attendanceRows) {
    const list = attendeesMap.get(row.meetingId) ?? [];
    list.push(row);
    attendeesMap.set(row.meetingId, list);
  }

  return json({
    meetings: visibleMeetings.map((m) => {
      const attendees = (attendeesMap.get(m.id) ?? []).map((a) => ({
        userId: a.userId,
        name: `${a.firstName} ${a.lastName}`,
        classe: a.classe,
        roleLabel: getRoleLabel(a.role, a.customTitle),
        rsvpStatus: a.rsvpStatus,
        checkedIn: a.checkedIn
      }));
      const myRsvp = attendees.find((a) => a.userId === user.id) ?? null;
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        scope: m.scope,
        scheduledAt: m.scheduledAt,
        location: m.location,
        agenda: m.agendaJson,
        minutesText: m.minutesText,
        status: m.status,
        attendees,
        myRsvp,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt
      };
    })
  });
};

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event, 'meetings:manage');
  const body = await parseJsonBody(event.request, meetingCreateSchema);

  const scheduledDate = new Date(body.scheduledAt);
  if (Number.isNaN(scheduledDate.getTime())) {
    throw error(400, 'Date de réunion invalide.');
  }

  const [created] = await db
    .insert(meetings)
    .values({
      title: body.title,
      description: body.description,
      scope: body.scope,
      scheduledAt: scheduledDate.toISOString(),
      location: body.location,
      agendaJson: body.agenda,
      minutesText: '',
      status: 'planifiee',
      createdBy: user.id
    })
    .returning();

  await db.insert(meetingAttendances).values({
    meetingId: created.id,
    userId: user.id,
    rsvpStatus: 'present',
    checkedIn: false
  });

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'meeting:created',
    targetType: 'meeting',
    targetId: created.id,
    details: { title: created.title, scope: created.scope, scheduledAt: created.scheduledAt }
  });

  return json(
    {
      meeting: {
        ...created,
        agenda: created.agendaJson
      }
    },
    { status: 201 }
  );
};

import type { AccessAuthorizationFact, Booking, User } from '../types.ts';
import { isConfidentialBooking } from './confidentiality.ts';
import type { OfficeDb } from './tools.ts';

export type IntegrationSubject = { userId: string; externalId: string };

export type CalendarSyncPayload = {
  bookingId: string;
  scheduleVersion: number;
  operation: 'UPSERT' | 'CANCEL';
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  attendees: string[];
  occurredAt: string;
};

export type AccessControlPayload = {
  bookingId: string;
  scheduleVersion: number;
  operation: 'GRANT' | 'REVOKE';
  resourceId: string;
  validFrom: string;
  validTo: string;
  subjects: IntegrationSubject[];
  reason: 'APPROVED' | 'CANCELLED' | 'RESCHEDULED' | 'EARLY_END' | 'ATTENDEE_REMOVED' | 'USER_DISABLED';
  occurredAt: string;
};

export type IntegrationEventPayload = CalendarSyncPayload | AccessControlPayload;
export type EnqueueIntegrationEvent = (event: { key: string; type: 'CALENDAR_SYNC' | 'ACCESS_CONTROL'; payload: IntegrationEventPayload }) => Promise<void>;

const scheduleVersion = (booking: Booking) => booking.scheduleVersion || 1;
const participantIds = (booking: Booking) => [...new Set([booking.userId, ...(booking.attendeeIds || [])])];

const subjectsFor = (booking: Booking, users: User[], userIds = participantIds(booking)) => userIds.flatMap(userId => {
  const user = users.find(item => item.id === userId && item.status !== 'DISABLED');
  return user ? [{ userId, externalId: user.externalId || user.id }] : [];
});

const factId = (booking: Booking, userId: string) => `access-fact:${booking.id}:v${scheduleVersion(booking)}:${userId}`;

const requestGrantFact = (db: OfficeDb, booking: Booking, subject: IntegrationSubject, at: string) => {
  const id = factId(booking, subject.userId);
  const facts = db.accessAuthorizationFacts || [];
  if (facts.some(item => item.id === id)) return;
  const fact: AccessAuthorizationFact = {
    id,
    bookingId: booking.id,
    scheduleVersion: scheduleVersion(booking),
    userId: subject.userId,
    resourceId: booking.resourceId,
    status: 'PENDING',
    validFrom: booking.startTime,
    validTo: booking.endTime,
    grantRequestedAt: at
  };
  db.accessAuthorizationFacts = [fact, ...facts].slice(0, 10000);
};

const revokeFact = (db: OfficeDb, booking: Booking, userId: string, at: string, reason: AccessControlPayload['reason']) => {
  const id = factId(booking, userId);
  const facts = db.accessAuthorizationFacts || [];
  const current = facts.find(item => item.id === id);
  const next: AccessAuthorizationFact = {
    id,
    bookingId: booking.id,
    scheduleVersion: scheduleVersion(booking),
    userId,
    resourceId: booking.resourceId,
    status: 'REVOKED',
    validFrom: current?.validFrom || booking.startTime,
    validTo: current?.validTo || booking.endTime,
    grantRequestedAt: current?.grantRequestedAt || booking.createdAt,
    grantAcknowledgedAt: current?.grantAcknowledgedAt,
    revokedAt: at,
    revocationAcknowledgedAt: undefined,
    revocationReason: reason
  };
  db.accessAuthorizationFacts = current
    ? facts.map(item => item.id === id ? next : item)
    : [next, ...facts].slice(0, 10000);
};

const enqueueCalendar = async (db: OfficeDb, booking: Booking, operation: CalendarSyncPayload['operation'], at: string, enqueue: EnqueueIntegrationEvent) => {
  const confidential = isConfidentialBooking(booking);
  const resource = (db.resources || []).find(item => item.id === booking.resourceId);
  const payload: CalendarSyncPayload = {
    bookingId: booking.id,
    scheduleVersion: scheduleVersion(booking),
    operation,
    title: confidential ? '涉密会议（请登录系统查看）' : booking.purpose,
    startTime: booking.startTime,
    endTime: booking.endTime,
    location: confidential ? undefined : resource?.name || booking.resourceId,
    attendees: subjectsFor(booking, db.users || []).map(item => item.externalId),
    occurredAt: at
  };
  await enqueue({
    key: `calendar:${booking.id}:v${payload.scheduleVersion}:${operation}`,
    type: 'CALENDAR_SYNC',
    payload
  });
};

const enqueueAccess = async (
  db: OfficeDb,
  booking: Booking,
  operation: AccessControlPayload['operation'],
  reason: AccessControlPayload['reason'],
  subjects: IntegrationSubject[],
  at: string,
  enqueue: EnqueueIntegrationEvent,
  scope = 'ALL'
) => {
  if (!subjects.length) return;
  const payload: AccessControlPayload = {
    bookingId: booking.id,
    scheduleVersion: scheduleVersion(booking),
    operation,
    resourceId: booking.resourceId,
    validFrom: booking.startTime,
    validTo: booking.endTime,
    subjects,
    reason,
    occurredAt: at
  };
  if (operation === 'GRANT') subjects.forEach(subject => requestGrantFact(db, booking, subject, at));
  else subjects.forEach(subject => revokeFact(db, booking, subject.userId, at, reason));
  await enqueue({
    key: `access:${booking.id}:v${payload.scheduleVersion}:${operation}:${scope}`,
    type: 'ACCESS_CONTROL',
    payload
  });
};

const revokeBooking = async (db: OfficeDb, booking: Booking, next: Booking | undefined, at: string, enqueue: EnqueueIntegrationEvent) => {
  await enqueueCalendar(db, booking, 'CANCEL', at, enqueue);
  const reason: AccessControlPayload['reason'] = next?.status === 'COMPLETED' || next?.endedEarlyAt
    ? 'EARLY_END'
    : next && scheduleVersion(next) !== scheduleVersion(booking) ? 'RESCHEDULED' : 'CANCELLED';
  await enqueueAccess(db, booking, 'REVOKE', reason, subjectsFor(booking, db.users || []), booking.accessRevokedAt || at, enqueue);
};

const grantBooking = async (db: OfficeDb, booking: Booking, at: string, enqueue: EnqueueIntegrationEvent) => {
  await enqueueCalendar(db, booking, 'UPSERT', at, enqueue);
  await enqueueAccess(db, booking, 'GRANT', 'APPROVED', subjectsFor(booking, db.users || []), at, enqueue);
};

export const syncIntegrationChanges = async (
  db: OfficeDb,
  previousBookings: Booking[],
  previousUsers: User[],
  enqueue: EnqueueIntegrationEvent,
  at = new Date().toISOString()
) => {
  const currentBookings = db.bookings || [];
  for (const previous of previousBookings) {
    if (previous.status !== 'APPROVED') continue;
    const next = currentBookings.find(item => item.id === previous.id);
    if (!next || next.status !== 'APPROVED' || scheduleVersion(next) !== scheduleVersion(previous)) {
      await revokeBooking(db, previous, next, at, enqueue);
      continue;
    }
    const removed = participantIds(previous).filter(userId => !participantIds(next).includes(userId));
    const removedSubjects = subjectsFor(previous, previousUsers, removed);
    for (const subject of removedSubjects) {
      await enqueueAccess(db, previous, 'REVOKE', 'ATTENDEE_REMOVED', [subject], at, enqueue, `USER:${subject.userId}`);
    }
  }
  for (const next of currentBookings) {
    if (next.status !== 'APPROVED') continue;
    const previous = previousBookings.find(item => item.id === next.id);
    if (!previous || previous.status !== 'APPROVED' || scheduleVersion(previous) !== scheduleVersion(next)) {
      await grantBooking(db, next, at, enqueue);
    }
  }
  const currentUsers = db.users || [];
  for (const previous of previousUsers) {
    if (previous.status === 'DISABLED') continue;
    const current = currentUsers.find(item => item.id === previous.id);
    if (!current || current.status !== 'DISABLED') continue;
    for (const booking of currentBookings.filter(item => item.status === 'APPROVED' && participantIds(item).includes(previous.id))) {
      await enqueueAccess(db, booking, 'REVOKE', 'USER_DISABLED', [{ userId: previous.id, externalId: previous.externalId || previous.id }], current.disabledAt || at, enqueue, `USER:${previous.id}`);
    }
  }
};

export const reconcileCurrentIntegrations = async (db: OfficeDb, enqueue: EnqueueIntegrationEvent) => {
  const active = (db.bookings || []).filter(booking => booking.status === 'APPROVED');
  const at = new Date().toISOString();
  for (const booking of active) await grantBooking(db, booking, at, enqueue);
  return { checkedBookings: active.length };
};

export const isIntegrationPayloadCurrent = (db: OfficeDb, payload: IntegrationEventPayload) => {
  const booking = (db.bookings || []).find(item => item.id === payload.bookingId);
  if (!booking) return payload.operation === 'CANCEL' || payload.operation === 'REVOKE';
  if (payload.operation === 'CANCEL') return booking.status !== 'APPROVED' || scheduleVersion(booking) !== payload.scheduleVersion;
  if (payload.operation === 'REVOKE') return true;
  if (booking.status !== 'APPROVED' || scheduleVersion(booking) !== payload.scheduleVersion) return false;
  if (payload.operation === 'UPSERT') return true;
  if (!('subjects' in payload)) return false;
  return payload.subjects.every(subject => participantIds(booking).includes(subject.userId)
    && (db.users || []).some(user => user.id === subject.userId && user.status !== 'DISABLED'));
};

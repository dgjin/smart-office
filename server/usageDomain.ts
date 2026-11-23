import crypto from 'node:crypto';
import type { Booking, BookingUsageFact, CheckInEvent, User } from '../types.ts';
import { DbError } from './errors.ts';
import { assertConfidentialOperation } from './confidentiality.ts';
import type { OfficeDb } from './tools.ts';
import { canManageServiceOperations, ensureServiceDomain, syncWorkOrdersForBookingChange } from './serviceDomain.ts';

const minutesBetween = (start?: string, end?: string) => start && end
  ? Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000))
  : 0;

export const upsertUsageFact = (db: OfficeDb, booking: Booking, source: BookingUsageFact['source'], at = new Date().toISOString()) => {
  ensureServiceDomain(db);
  const scheduleVersion = booking.scheduleVersion || 1;
  const current = (db.usageFacts || []).find(item => item.bookingId === booking.id && item.scheduleVersion === scheduleVersion);
  const fact: BookingUsageFact = {
    bookingId: booking.id,
    scheduleVersion,
    scheduledStartTime: booking.startTime,
    scheduledEndTime: booking.endTime,
    scheduledMinutes: minutesBetween(booking.startTime, booking.endTime),
    actualStartTime: booking.actualStartTime || booking.checkedInAt,
    actualEndTime: booking.actualEndTime,
    actualMinutes: minutesBetween(booking.actualStartTime || booking.checkedInAt, booking.actualEndTime),
    source,
    revision: (current?.revision || 0) + 1,
    releasedAt: booking.releasedAt,
    releaseReason: booking.releaseReason,
    unusedConfirmation: current?.unusedConfirmation
  };
  db.usageFacts = current
    ? (db.usageFacts || []).map(item => item === current ? fact : item)
    : [fact, ...(db.usageFacts || [])];
  return fact;
};

export type CheckInInput = {
  source: 'QR' | 'MANUAL';
  subjectUserId?: string;
  mode?: 'CHECK_IN' | 'CORRECT' | 'REVOKE';
  checkedInAt?: string;
  reason?: string;
  at?: string;
  scheduleVersion?: number;
};

export const recordCheckIn = (db: OfficeDb, current: Booking, actor: User, input: CheckInInput) => {
  ensureServiceDomain(db);
  const mode = input.mode || 'CHECK_IN';
  if (!['QR', 'MANUAL'].includes(input.source) || !['CHECK_IN', 'CORRECT', 'REVOKE'].includes(mode)) throw new DbError('INVALID_CHECK_IN_INPUT', 400);
  const operator = canManageServiceOperations(actor);
  const subjectUserId = input.subjectUserId || actor.id;
  if (current.status !== 'APPROVED') throw new DbError('BOOKING_NOT_CHECKABLE', 409);
  if (current.userId !== subjectUserId && !current.attendeeIds?.includes(subjectUserId)) throw new DbError('CHECK_IN_SUBJECT_NOT_PARTICIPANT', 403);
  if (actor.id !== subjectUserId && !operator) throw new DbError('FORBIDDEN', 403);
  assertConfidentialOperation(db, current, actor);
  if (input.source === 'QR') {
    if (actor.id !== subjectUserId) throw new DbError('QR_CHECK_IN_REQUIRES_SELF', 403);
    if (!Number.isSafeInteger(input.scheduleVersion) || (input.scheduleVersion || 0) < 1) throw new DbError('INVALID_QR_CHECK_IN', 400);
    if (input.scheduleVersion !== (current.scheduleVersion || 1)) throw new DbError('QR_CHECK_IN_SCHEDULE_STALE', 409);
  }
  if (mode !== 'CHECK_IN' && (!operator || !input.reason?.trim())) throw new DbError('CHECK_IN_CORRECTION_REASON_REQUIRED', 400);
  if (mode === 'CHECK_IN' && current.checkedInAt) throw new DbError('BOOKING_ALREADY_CHECKED_IN', 409);
  if (mode !== 'CHECK_IN' && !current.checkedInAt) throw new DbError('CHECK_IN_EVENT_NOT_FOUND', 409);
  const createdAt = input.at || new Date().toISOString();
  const checkedInAt = mode === 'REVOKE' ? undefined : mode === 'CORRECT' ? input.checkedInAt : createdAt;
  if (mode !== 'REVOKE' && (!checkedInAt || !Number.isFinite(Date.parse(checkedInAt)))) throw new DbError('INVALID_CHECK_IN_TIME', 400);
  if (checkedInAt) {
    const timestamp = Date.parse(checkedInAt);
    if (timestamp < Date.parse(current.startTime) - 15 * 60000 || timestamp >= Date.parse(current.endTime)) {
      throw new DbError('CHECK_IN_OUTSIDE_WINDOW', 409);
    }
    if (mode === 'CHECK_IN' && Date.parse(createdAt) < Date.parse(current.startTime) - 15 * 60000) throw new DbError('CHECK_IN_OUTSIDE_WINDOW', 409);
    if (mode === 'CHECK_IN' && Date.parse(createdAt) >= Date.parse(current.endTime)) throw new DbError('CHECK_IN_OUTSIDE_WINDOW', 409);
  }
  const event: CheckInEvent = {
    id: `checkin-${crypto.randomUUID()}`,
    bookingId: current.id,
    subjectUserId,
    operatorId: actor.id,
    source: mode === 'CHECK_IN' ? input.source : 'CORRECTION',
    action: mode,
    checkedInAt,
    createdAt,
    reason: input.reason?.trim() || undefined,
    supersedesId: mode === 'CHECK_IN' ? undefined : current.checkInEventId
  };
  const next: Booking = {
    ...current,
    checkedInAt,
    checkInEventId: event.id,
    checkInSource: event.source,
    checkInOperatorId: actor.id,
    actualStartTime: checkedInAt,
    actualEndTime: mode === 'REVOKE' ? undefined : current.actualEndTime,
    noShow: false,
    releasedAt: current.releasedAt,
    releaseReason: current.releaseReason
  };
  db.checkInEvents = [event, ...(db.checkInEvents || [])];
  upsertUsageFact(db, next, mode === 'CHECK_IN' ? 'CHECK_IN' : 'MANUAL', createdAt);
  return { booking: next, event };
};

export const releaseBooking = (
  db: OfficeDb,
  current: Booking,
  input: {
    reason: string;
    type: NonNullable<Booking['releaseType']>;
    actorId?: string;
    at?: string;
    noShow?: boolean;
    source?: BookingUsageFact['source'];
  }
) => {
  if (!['PENDING', 'APPROVED'].includes(current.status)) throw new DbError('BOOKING_NOT_RELEASABLE', 409);
  if (!input.reason.trim() || input.reason.trim().length > 500) throw new DbError('RELEASE_REASON_REQUIRED', 400);
  const at = input.at || new Date().toISOString();
  const next: Booking = {
    ...current,
    status: 'CANCELLED',
    noShow: Boolean(input.noShow),
    releasedAt: at,
    releaseReason: input.reason.trim(),
    releaseType: input.type,
    accessRevokedAt: at,
    cancellationReason: input.reason.trim(),
    cancelledBy: input.actorId,
    actualEndTime: current.actualStartTime || current.checkedInAt ? at : undefined
  };
  syncWorkOrdersForBookingChange(db, current, input.reason.trim(), input.actorId, at);
  upsertUsageFact(db, next, input.source || (input.actorId ? 'MANUAL' : 'SYSTEM'), at);
  return next;
};

export const completeBookingNormally = (db: OfficeDb, current: Booking, at = new Date().toISOString()) => {
  if (current.status !== 'APPROVED' || !current.checkedInAt) throw new DbError('BOOKING_NOT_COMPLETABLE', 409);
  if (Date.parse(at) < Date.parse(current.endTime)) throw new DbError('BOOKING_NOT_COMPLETABLE', 409);
  const next: Booking = {
    ...current,
    status: 'COMPLETED',
    endedEarlyAt: undefined,
    actualEndTime: current.endTime,
    accessRevokedAt: current.endTime
  };
  syncWorkOrdersForBookingChange(db, current, '会议正常结束，未执行服务同步关闭', undefined, current.endTime);
  upsertUsageFact(db, next, 'SYSTEM', current.endTime);
  return next;
};

export const completeBookingUsage = (db: OfficeDb, current: Booking, actorId: string, at = new Date().toISOString()) => {
  if (current.status !== 'APPROVED' || !current.checkedInAt) throw new DbError('BOOKING_NOT_COMPLETABLE', 409);
  const timestamp = Date.parse(at);
  if (timestamp < Date.parse(current.startTime) || timestamp >= Date.parse(current.endTime)) throw new DbError('BOOKING_NOT_COMPLETABLE', 409);
  const next: Booking = {
    ...current,
    status: 'COMPLETED',
    endedEarlyAt: at,
    actualEndTime: at,
    releasedAt: at,
    releaseReason: '提前结束并释放剩余时段',
    releaseType: 'MANUAL_EXCEPTION',
    accessRevokedAt: at
  };
  syncWorkOrdersForBookingChange(db, current, '会议提前结束，未执行服务同步撤销', actorId, at);
  upsertUsageFact(db, next, 'MANUAL', at);
  return next;
};

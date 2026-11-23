import crypto from 'node:crypto';
import type { Booking, Notification, UsageAppeal, User } from '../types.ts';
import { getApprovalRecipients } from '../utils/approval.ts';
import { addApprovalWorkingMinutes } from '../utils/approvalSchedule.ts';
import { findBookingConflicts, findRequesterConflicts, isResourceAcceptingBookings } from '../utils/bookingRules.ts';
import { getCurrentRuleSettings } from '../utils/resourceDomain.ts';
import { mutateDb } from './db.ts';
import { DbError } from './errors.ts';
import { BookingRuleError, buildBookingQuotaDetails } from './bookingService.ts';
import { assertConfidentialOperation, assertConfidentialWhitelist, bookingNoticePurpose, rebuildConfidentialAccessGrants } from './confidentiality.ts';
import { assertCancellationAuthorized, canManageServiceOperations, createBookingWorkOrders, ensureServiceDomain } from './serviceDomain.ts';
import { completeBookingUsage, recordCheckIn, releaseBooking, upsertUsageFact, type CheckInInput } from './usageDomain.ts';

const notice = (userId: string, title: string, content: string, type: Notification['type'] = 'INFO'): Notification => ({
  id: crypto.randomUUID(), userId, title, content, type, timestamp: new Date().toISOString(), isRead: false
});

export const checkInBooking = async (actor: User, bookingId: string, input: CheckInInput) => mutateDb(async (db, { audit }) => {
  const current = (db.bookings || []).find(item => item.id === bookingId);
  if (!current) throw new DbError('BOOKING_NOT_FOUND', 404);
  const eventInput = !input || (input.mode || 'CHECK_IN') === 'CHECK_IN' ? { ...input, at: new Date().toISOString() } : input;
  const { booking, event } = recordCheckIn(db, current, actor, eventInput);
  db.bookings = (db.bookings || []).map(item => item.id === booking.id ? booking : item);
  await audit({ actorId: actor.id, action: event.action === 'CORRECT' ? 'BOOKING_CHECK_IN_CORRECT' : event.action === 'REVOKE' ? 'BOOKING_CHECK_IN_REVOKE' : 'BOOKING_CHECK_IN', entityType: 'BOOKING', entityId: booking.id, details: { eventId: event.id, source: event.source, subjectUserId: event.subjectUserId, checkedInAt: event.checkedInAt, reason: event.reason } });
  db.notifications = [notice(event.subjectUserId, event.action === 'REVOKE' ? '签到已撤销' : '签到已记录', `${bookingNoticePurpose(booking)}的签到事实已更新。`, 'SUCCESS'), ...(db.notifications || [])].slice(0, 1000);
  return { booking, event };
});

export const releaseBookingByActor = async (actor: User, bookingId: string, input: any) => mutateDb(async (db, { audit }) => {
  if (!canManageServiceOperations(actor)) throw new DbError('FORBIDDEN', 403);
  const current = (db.bookings || []).find(item => item.id === bookingId);
  if (!current) throw new DbError('BOOKING_NOT_FOUND', 404);
  assertConfidentialOperation(db, current, actor);
  const reason = typeof input?.reason === 'string' ? input.reason : '';
  const booking = releaseBooking(db, current, { reason, type: 'MANUAL_EXCEPTION', actorId: actor.id, source: 'MANUAL' });
  db.bookings = (db.bookings || []).map(item => item.id === booking.id ? booking : item);
  await audit({ actorId: actor.id, action: 'BOOKING_MANUAL_RELEASE', entityType: 'BOOKING', entityId: booking.id, details: { reason: booking.releaseReason, previousStatus: current.status } });
  const recipients = [...new Set([booking.userId, ...(booking.attendeeIds || [])])];
  db.notifications = [...recipients.map(userId => notice(userId, '会议室已人工释放', `${bookingNoticePurpose(booking)}已释放：${booking.releaseReason}`, 'WARNING')), ...(db.notifications || [])].slice(0, 1000);
  return booking;
});

export const confirmBookingUsage = async (actor: User, bookingId: string, input: any) => mutateDb(async (db, { audit }) => {
  const current = (db.bookings || []).find(item => item.id === bookingId);
  if (!current) throw new DbError('BOOKING_NOT_FOUND', 404);
  if (current.userId !== actor.id && !canManageServiceOperations(actor)) throw new DbError('FORBIDDEN', 403);
  assertConfidentialOperation(db, current, actor);
  if (current.status !== 'APPROVED') throw new DbError('BOOKING_NOT_CONFIRMABLE', 409);
  if (!['IN_USE', 'UNUSED'].includes(input?.decision)) throw new DbError('INVALID_USAGE_CONFIRMATION', 400);
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > 500 || (input.decision === 'UNUSED' && !note)) throw new DbError('USAGE_CONFIRMATION_NOTE_REQUIRED', 400);
  const now = Date.now();
  if (now < Date.parse(current.startTime) - 15 * 60000 || now >= Date.parse(current.endTime)) {
    throw new DbError('USAGE_CONFIRMATION_OUTSIDE_WINDOW', 409);
  }
  if (input.decision === 'UNUSED') {
    assertCancellationAuthorized(current, (db.resources || []).find(resource => resource.id === current.resourceId), getCurrentRuleSettings(db.ruleVersions), actor, now);
  }
  upsertUsageFact(db, current, 'MANUAL');
  db.usageFacts = (db.usageFacts || []).map(fact => fact.bookingId === current.id && fact.scheduleVersion === (current.scheduleVersion || 1)
    ? { ...fact, unusedConfirmation: { status: input.decision, requestedAt: fact.unusedConfirmation?.requestedAt || new Date().toISOString(), confirmedAt: new Date().toISOString(), confirmedBy: actor.id, note } }
    : fact);
  let booking = current;
  if (input.decision === 'UNUSED') {
    booking = releaseBooking(db, current, { reason: `未使用确认：${note}`, type: 'UNUSED_CONFIRMED', actorId: actor.id, source: 'MANUAL' });
    db.usageFacts = (db.usageFacts || []).map(fact => fact.bookingId === booking.id && fact.scheduleVersion === (booking.scheduleVersion || 1)
      ? { ...fact, unusedConfirmation: { status: 'UNUSED', requestedAt: fact.unusedConfirmation?.requestedAt || new Date().toISOString(), confirmedAt: new Date().toISOString(), confirmedBy: actor.id, note } }
      : fact);
    db.bookings = (db.bookings || []).map(item => item.id === booking.id ? booking : item);
  }
  await audit({ actorId: actor.id, action: 'BOOKING_USAGE_CONFIRM', entityType: 'BOOKING', entityId: booking.id, details: { decision: input.decision, note } });
  db.notifications = [notice(booking.userId, '实际使用已确认', input.decision === 'UNUSED' ? `${bookingNoticePurpose(booking)}已按未使用释放。` : `${bookingNoticePurpose(booking)}已确认正常使用。`, 'SUCCESS'), ...(db.notifications || [])].slice(0, 1000);
  return booking;
});

export const createUsageAppeal = async (actor: User, bookingId: string, input: any) => mutateDb(async (db, { audit }) => {
  ensureServiceDomain(db);
  const booking = (db.bookings || []).find(item => item.id === bookingId);
  if (!booking) throw new DbError('BOOKING_NOT_FOUND', 404);
  if (booking.userId !== actor.id || booking.status !== 'CANCELLED'
    || !booking.releaseType || !['NO_SHOW', 'MANUAL_EXCEPTION', 'UNUSED_CONFIRMED'].includes(booking.releaseType)) {
    throw new DbError('BOOKING_NOT_APPEALABLE', 409);
  }
  assertConfidentialOperation(db, booking, actor);
  if ((db.usageAppeals || []).some(item => item.bookingId === booking.id && item.status === 'PENDING')) throw new DbError('USAGE_APPEAL_EXISTS', 409);
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 2 || reason.length > 1000) throw new DbError('USAGE_APPEAL_REASON_REQUIRED', 400);
  const appeal: UsageAppeal = { id: `appeal-${crypto.randomUUID()}`, bookingId, requesterId: actor.id, reason, status: 'PENDING', createdAt: new Date().toISOString() };
  db.usageAppeals = [appeal, ...(db.usageAppeals || [])];
  await audit({ actorId: actor.id, action: 'USAGE_APPEAL_CREATE', entityType: 'USAGE_APPEAL', entityId: appeal.id, details: { bookingId } });
  const recipients = (db.users || []).filter(user => canManageServiceOperations(user) || user.role.includes('APPROVAL_ADMIN')).map(user => user.id);
  db.notifications = [...recipients.map(userId => notice(userId, '新的释放申诉待处理', `${bookingNoticePurpose(booking)}：${reason}`, 'WARNING')), ...(db.notifications || [])].slice(0, 1000);
  return appeal;
});

export const resolveUsageAppeal = async (actor: User, appealId: string, input: any) => mutateDb(async (db, { audit, scheduleJob }) => {
  if (!canManageServiceOperations(actor) && !actor.role.includes('APPROVAL_ADMIN')) throw new DbError('FORBIDDEN', 403);
  ensureServiceDomain(db);
  const appeal = (db.usageAppeals || []).find(item => item.id === appealId);
  if (!appeal || appeal.status !== 'PENDING') throw new DbError('USAGE_APPEAL_NOT_FOUND', 404);
  if (!['RESTORE', 'REJECT'].includes(input?.decision)) throw new DbError('INVALID_USAGE_APPEAL_DECISION', 400);
  const resolutionNote = typeof input.note === 'string' ? input.note.trim() : '';
  if (!resolutionNote || resolutionNote.length > 1000) throw new DbError('USAGE_APPEAL_RESOLUTION_NOTE_REQUIRED', 400);
  const current = (db.bookings || []).find(item => item.id === appeal.bookingId);
  if (!current) throw new DbError('BOOKING_NOT_FOUND', 404);
  assertConfidentialOperation(db, current, actor);
  let booking = current;
  const restored = input.decision === 'RESTORE';
  if (restored) {
    if (current.status !== 'CANCELLED' || Date.parse(current.endTime) <= Date.now()) throw new DbError('BOOKING_RESTORE_WINDOW_CLOSED', 409);
    const resource = (db.resources || []).find(item => item.id === current.resourceId);
    if (!resource || !isResourceAcceptingBookings(resource)) throw new DbError('RESOURCE_NOT_ACCEPTING_BOOKINGS', 409);
    if (findBookingConflicts(db.bookings || [], current, current.id).length) throw new DbError('CONFLICT', 409);
    if (findRequesterConflicts(db.bookings || [], current, current.id).length) throw new DbError('REQUESTER_TIME_CONFLICT', 409);
    try {
      buildBookingQuotaDetails(db, current, getCurrentRuleSettings(db.ruleVersions), [], current.id);
    } catch (error) {
      if (error instanceof BookingRuleError) throw new DbError(error.code, error.status, error.details);
      throw error;
    }
    assertConfidentialWhitelist(db, current);
    const restoredAt = new Date().toISOString();
    const settings = getCurrentRuleSettings(db.ruleVersions);
    const bookingSettings = current.ruleSettingsSnapshot || settings;
    const requiresApproval = Boolean(current.approvalWorkflow?.length);
    booking = {
      ...current,
      status: requiresApproval ? 'PENDING' : 'APPROVED',
      scheduleVersion: (current.scheduleVersion || 1) + 1,
      currentNodeIndex: requiresApproval ? 0 : current.currentNodeIndex,
      approvalHistory: requiresApproval ? [] : current.approvalHistory,
      approvalSubmittedAt: requiresApproval ? restoredAt : current.approvalSubmittedAt,
      approvalClosedAt: undefined,
      approvalCloseReason: undefined,
      noShow: false,
      noShowReleaseNotBefore: requiresApproval ? undefined : new Date(Date.parse(restoredAt) + bookingSettings.noShowReleaseAfterStartMinutes * 60000).toISOString(),
      releasedAt: undefined,
      releaseReason: undefined,
      releaseType: undefined,
      accessRevokedAt: undefined,
      cancellationReason: undefined,
      cancelledBy: undefined,
      actualEndTime: undefined
    };
    db.bookings = (db.bookings || []).map(item => item.id === booking.id ? booking : item);
    rebuildConfidentialAccessGrants(db, [booking], actor.id);
    const scheduleVersion = booking.scheduleVersion || 1;
    if (requiresApproval) {
      const submittedAt = new Date(booking.approvalSubmittedAt!);
      const submissionToken = String(submittedAt.getTime());
      const payload = { bookingId: booking.id, nodeIndex: 0, submittedAt: submittedAt.toISOString() };
      await scheduleJob({ key: `approval-reminder:${booking.id}:${submissionToken}:0`, type: 'APPROVAL_REMINDER', runAt: addApprovalWorkingMinutes(submittedAt, settings.approvalReminderAfterMinutes, settings), payload });
      await scheduleJob({ key: `approval-escalation:${booking.id}:${submissionToken}:0`, type: 'APPROVAL_ESCALATION', runAt: addApprovalWorkingMinutes(submittedAt, settings.approvalEscalationAfterMinutes, settings), payload });
      await scheduleJob({ key: `approval-close:${booking.id}:${submissionToken}`, type: 'APPROVAL_CLOSE', runAt: new Date(Date.parse(booking.startTime) - settings.unapprovedCloseBeforeStartMinutes * 60000), payload: { bookingId: booking.id, submittedAt: submittedAt.toISOString() } });
      const recipients = getApprovalRecipients(booking, db.workflow || [], {
        users: db.users || [], resources: db.resources || [], departments: db.departments || [], delegates: db.approvalDelegates || []
      });
      db.notifications = [...recipients.map(user => notice(user.id, '恢复预约待重新审批', `${bookingNoticePurpose(booking)}已恢复至首个审批节点。`, 'WARNING')), ...(db.notifications || [])].slice(0, 1000);
    } else {
      await createBookingWorkOrders(db, booking, { audit, scheduleJob });
      const startAt = Date.parse(booking.startTime);
      const payload = { bookingId: booking.id, scheduleVersion };
      await scheduleJob({ key: `reminder:${booking.id}:v${scheduleVersion}`, type: 'BOOKING_REMINDER', runAt: new Date(startAt - 15 * 60000), payload });
      await scheduleJob({ key: `completion:${booking.id}:v${scheduleVersion}`, type: 'BOOKING_COMPLETION', runAt: new Date(booking.endTime), payload });
      if (booking.type === 'ROOM') {
        await scheduleJob({ key: `check-in-reminder:${booking.id}:v${scheduleVersion}`, type: 'BOOKING_CHECK_IN_REMINDER', runAt: new Date(startAt + bookingSettings.checkInReminderAfterStartMinutes * 60000), payload });
        const noShowAt = Math.max(startAt + bookingSettings.noShowReleaseAfterStartMinutes * 60000, Date.parse(booking.noShowReleaseNotBefore!));
        await scheduleJob({ key: `noshow:${booking.id}:v${scheduleVersion}`, type: 'BOOKING_NO_SHOW', runAt: new Date(noShowAt), payload });
      }
      upsertUsageFact(db, booking, 'MANUAL');
    }
  }
  const next: UsageAppeal = { ...appeal, status: restored ? 'RESTORED' : 'REJECTED', resolvedAt: new Date().toISOString(), resolvedBy: actor.id, resolutionNote };
  db.usageAppeals = (db.usageAppeals || []).map(item => item.id === appeal.id ? next : item);
  await audit({ actorId: actor.id, action: restored ? 'USAGE_APPEAL_RESTORE' : 'USAGE_APPEAL_REJECT', entityType: 'USAGE_APPEAL', entityId: appeal.id, details: { bookingId: booking.id, note: resolutionNote, scheduleVersion: booking.scheduleVersion } });
  db.notifications = [notice(appeal.requesterId, restored ? '预约申诉已恢复' : '预约申诉未通过', `${bookingNoticePurpose(booking)}：${resolutionNote}`, restored ? 'SUCCESS' : 'WARNING'), ...(db.notifications || [])].slice(0, 1000);
  return { appeal: next, booking };
});

export const completeBookingEarly = async (actor: User, bookingId: string) => mutateDb(async (db, { audit }) => {
  const current = (db.bookings || []).find(item => item.id === bookingId);
  if (!current) throw new DbError('BOOKING_NOT_FOUND', 404);
  if (current.userId !== actor.id && !canManageServiceOperations(actor)) throw new DbError('FORBIDDEN', 403);
  assertConfidentialOperation(db, current, actor);
  const booking = completeBookingUsage(db, current, actor.id);
  db.bookings = (db.bookings || []).map(item => item.id === booking.id ? booking : item);
  await audit({ actorId: actor.id, action: 'BOOKING_COMPLETE_EARLY', entityType: 'BOOKING', entityId: booking.id, details: { actualStartTime: booking.actualStartTime, actualEndTime: booking.actualEndTime } });
  const recipients = [...new Set([booking.userId, ...(booking.attendeeIds || [])])];
  db.notifications = [...recipients.map(userId => notice(userId, '会议已提前结束', `${bookingNoticePurpose(booking)}已结束，剩余时段、额度、服务与门禁授权已释放。`, 'SUCCESS')), ...(db.notifications || [])].slice(0, 1000);
  return { booking, message: '会议已提前结束' };
});

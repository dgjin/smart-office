import crypto from 'node:crypto';
import type { Booking, ConfidentialAccessGrant, User } from '../types.ts';
import { canApproveBooking } from '../utils/approval.ts';
import type { OfficeDb } from './tools.ts';

export class ConfidentialityError extends Error {
  status: number;
  code: string;

  constructor(code: string, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export const isConfidentialBooking = (booking: Booking) =>
  booking.confidentialityChoice === 'CONFIDENTIAL' || booking.meetingType === 'CONFIDENTIAL';

export const bookingNoticePurpose = (booking: Booking) => isConfidentialBooking(booking) ? '涉密会议' : `「${booking.purpose}」`;

export const redactBooking = (booking: Booking): Booking => ({
  ...booking,
  userId: '',
  purpose: '已预约',
  participants: undefined,
  approvalHistory: [],
  currentNodeIndex: 0,
  attendeeIds: [],
  overlapParticipantIds: isConfidentialBooking(booking) ? [] : [...new Set([booking.userId, ...(booking.attendeeIds || [])])],
  hasLeader: false,
  leaderDetails: undefined,
  isVideoConference: false,
  needsTeaService: false,
  requiredFeatures: [],
  checkedInAt: undefined,
  checkInEventId: undefined,
  checkInSource: undefined,
  checkInOperatorId: undefined,
  actualStartTime: undefined,
  actualEndTime: undefined,
  releasedAt: undefined,
  releaseReason: undefined,
  releaseType: undefined,
  accessRevokedAt: undefined,
  cancellationReason: undefined,
  cancelledBy: undefined,
  endedEarlyAt: undefined,
  noShow: false,
  noShowReleaseNotBefore: undefined,
  requesterDepartmentId: undefined,
  resourceCampus: undefined,
  meetingType: undefined,
  confidentialityChoice: undefined,
  contactSnapshot: undefined,
  serviceRequirements: [],
  auditoriumSetup: undefined,
  quotaDetails: [],
  exclusiveRequestReason: undefined,
  exclusiveAccessType: undefined,
  attendeeWarnings: [],
  approvalRuleSetVersion: undefined,
  approvalRuleId: undefined,
  approvalRuleExplanation: [],
  approvalSubmittedAt: undefined,
  approvalClosedAt: undefined,
  approvalCloseReason: undefined,
  approvalWorkflow: [],
  securityAuthorizationIds: undefined
});

export const assertConfidentialWhitelist = (db: OfficeDb, booking: Booking) => {
  if (!isConfidentialBooking(booking)) return;
  const whitelist = new Set((db.confidentialWhitelist || []).map(item => item.userId));
  const required = [...new Set([booking.userId, ...(booking.attendeeIds || [])])];
  if (required.some(userId => !whitelist.has(userId))) {
    throw new ConfidentialityError('CONFIDENTIAL_WHITELIST_REQUIRED', 403);
  }
};

export const rebuildConfidentialAccessGrants = (db: OfficeDb, bookings: Booking[], actorId: string) => {
  const ids = new Set(bookings.map(booking => booking.id));
  db.confidentialAccessGrants = (db.confidentialAccessGrants || []).filter(item => !ids.has(item.bookingId));
  const grantedAt = new Date().toISOString();
  const grants: ConfidentialAccessGrant[] = [];
  for (const booking of bookings) {
    if (!isConfidentialBooking(booking)) continue;
    const entries = new Map<string, ConfidentialAccessGrant['access']>([[booking.userId, 'REQUESTER']]);
    (booking.attendeeIds || []).forEach(userId => entries.set(userId, 'ATTENDEE'));
    (db.users || []).filter(user => user.role.includes('SECURITY_ADMIN')).forEach(user => entries.set(user.id, 'SECURITY'));
    for (const [userId, access] of entries) grants.push({
      id: `cag-${crypto.randomUUID()}`, bookingId: booking.id, userId, access, grantedBy: actorId, grantedAt
    });
  }
  db.confidentialAccessGrants = [...grants, ...(db.confidentialAccessGrants || [])];
};

export const canReadConfidentialBooking = (db: OfficeDb, booking: Booking, actor: User) => {
  if (!isConfidentialBooking(booking)) return true;
  if ((db.confidentialAccessGrants || []).some(item => item.bookingId === booking.id && item.userId === actor.id)) return true;
  return canApproveBooking(booking, db.workflow || [], actor, {
    users: db.users || [], resources: db.resources || [], departments: db.departments || [], delegates: db.approvalDelegates || []
  });
};

export const assertConfidentialOperation = (db: OfficeDb, booking: Booking, actor: User) => {
  if (!canReadConfidentialBooking(db, booking, actor)) {
    throw new ConfidentialityError('CONFIDENTIAL_OPERATION_FORBIDDEN', 403);
  }
};

export const canReadBookingDetails = (db: OfficeDb, booking: Booking, actor: User) => {
  if (isConfidentialBooking(booking)) return canReadConfidentialBooking(db, booking, actor);
  const isAdmin = actor.role.includes('SYSTEM_ADMIN');
  const serviceOperator = actor.role.includes('SERVICE_COORDINATOR') || actor.role.includes('FRONT_DESK');
  return Boolean(isAdmin || serviceOperator || booking.userId === actor.id || booking.attendeeIds?.includes(actor.id)
    || (db.workOrders || []).some(order => order.bookingId === booking.id && (isAdmin || actor.role.includes(order.assigneeRole)))
    || (actor.role.includes('APPROVAL_ADMIN') && (db.usageAppeals || []).some(appeal => appeal.bookingId === booking.id))
    || canApproveBooking(booking, db.workflow || [], actor, {
      users: db.users || [], resources: db.resources || [], departments: db.departments || [], delegates: db.approvalDelegates || []
    }));
};

export const getActorDbView = (db: OfficeDb, actor: User): OfficeDb => ({
  ...db,
  bookings: (db.bookings || []).map(booking => canReadBookingDetails(db, booking, actor) ? booking : redactBooking(booking)),
  workOrders: (db.workOrders || []).filter(order => {
    const booking = (db.bookings || []).find(item => item.id === order.bookingId);
    const manager = actor.role.includes('SYSTEM_ADMIN') || actor.role.includes(order.assigneeRole);
    if (manager) return true;
    if (booking?.userId !== actor.id) return false;
    return !isConfidentialBooking(booking) || canReadConfidentialBooking(db, booking, actor);
  })
});

import { DbError, readDb, readSnapshot } from './db.ts';
import type { User } from '../types.ts';
import { getCurrentRuleSettings } from '../utils/resourceDomain.ts';
import { recordAudit } from './audit.ts';
import { canReadBookingDetails, getActorDbView, isConfidentialBooking } from './confidentiality.ts';
import { canManageServiceOperations } from './serviceDomain.ts';
import { publicDevice } from './devices.ts';

export const getWorkspace = async (actor: User) => {
  const { db, revision } = await readSnapshot();
  const isAdmin = actor.role.includes('SYSTEM_ADMIN');
  const canManageConfidentiality = isAdmin || actor.role.includes('SECURITY_ADMIN');
  const view = getActorDbView(db, actor);
  const users = (db.users || []).map(user => isAdmin ? user : {
    ...user,
    landline: undefined,
    mobile: undefined
  });
  return {
    roles: db.roles || [],
    users,
    resources: db.resources || [],
    bookings: view.bookings,
    departments: db.departments || [],
    workflow: db.workflow || [],
    workflowVersions: isAdmin ? db.workflowVersions || [] : undefined,
    approvalRuleSetVersions: isAdmin ? db.approvalRuleSetVersions || [] : undefined,
    approvalDelegates: (db.approvalDelegates || []).filter(item => isAdmin || item.delegatorId === actor.id || item.delegateId === actor.id),
    workOrders: view.workOrders,
    devices: isAdmin ? (db.devices || []).map(publicDevice) : undefined,
    serviceCatalog: db.serviceCatalog || [],
    serviceAreas: canManageServiceOperations(actor) ? db.serviceAreas || [] : undefined,
    serviceShifts: canManageServiceOperations(actor) ? db.serviceShifts || [] : undefined,
    serviceInspections: canManageServiceOperations(actor) ? db.serviceInspections || [] : undefined,
    checkInEvents: (db.checkInEvents || []).filter(event => {
      const booking = (db.bookings || []).find(item => item.id === event.bookingId);
      return booking && canReadBookingDetails(db, booking, actor);
    }),
    usageFacts: (db.usageFacts || []).filter(fact => {
      const booking = (db.bookings || []).find(item => item.id === fact.bookingId);
      return booking && canReadBookingDetails(db, booking, actor);
    }),
    usageAppeals: (db.usageAppeals || []).filter(appeal => {
      if (appeal.requesterId === actor.id) return true;
      if (!canManageServiceOperations(actor) && !actor.role.includes('APPROVAL_ADMIN')) return false;
      const booking = (db.bookings || []).find(item => item.id === appeal.bookingId);
      return booking && canReadBookingDetails(db, booking, actor);
    }),
    confidentialWhitelist: canManageConfidentiality ? db.confidentialWhitelist || [] : undefined,
    confidentialAuthorizationTargets: canManageConfidentiality ? (db.bookings || [])
      .filter(booking => ['PENDING', 'APPROVED'].includes(booking.status) && isConfidentialBooking(booking))
      .map(booking => ({
        id: booking.id,
        userId: booking.userId,
        startTime: booking.startTime,
        status: booking.status,
        meetingType: booking.meetingType,
        confidentialityChoice: booking.confidentialityChoice
      })) : undefined,
    confidentialityAuthorizations: (db.confidentialityAuthorizations || []).filter(item => {
      if (canManageConfidentiality) return true;
      return (db.bookings || []).some(booking => booking.id === item.bookingId && booking.userId === actor.id);
    }),
    ruleSettings: getCurrentRuleSettings(db.ruleVersions),
    revision
  };
};

export const recordConfidentialBookingRead = async (actor: User, bookingId: string) => {
  const db = await readDb();
  const booking = (db.bookings || []).find(item => item.id === bookingId);
  if (!booking) throw new DbError('BOOKING_NOT_FOUND', 404);
  if (!isConfidentialBooking(booking)) throw new DbError('CONFIDENTIAL_READ_NOT_APPLICABLE', 400);
  if (!canReadBookingDetails(db, booking, actor)) throw new DbError('CONFIDENTIAL_READ_FORBIDDEN', 403);
  await recordAudit({
    actorId: actor.id,
    action: 'CONFIDENTIAL_READ',
    entityType: 'BOOKING',
    entityId: booking.id,
    details: { source: 'BOOKING_DETAIL' }
  });
  return { recorded: true };
};

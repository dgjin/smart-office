import { readSnapshot } from './db.ts';
import { canApproveBooking } from '../utils/approval.ts';
import type { Booking, User } from '../types.ts';

const redactBooking = (booking: Booking): Booking => ({
  ...booking,
  userId: '',
  purpose: '已预约',
  participants: undefined,
  approvalHistory: [],
  currentNodeIndex: 0,
  attendeeIds: [],
  hasLeader: false,
  leaderDetails: undefined,
  isVideoConference: false,
  needsTeaService: false,
  requiredFeatures: [],
  checkedInAt: undefined,
  endedEarlyAt: undefined,
  noShow: false,
  requesterDepartmentId: undefined,
  resourceCampus: undefined
});

export const getWorkspace = async (actor: User) => {
  const { db, revision } = await readSnapshot();
  const isAdmin = actor.role.includes('SYSTEM_ADMIN');
  const workOrders = (db.workOrders || []).filter(order => isAdmin || actor.role.includes(order.assigneeRole));
  const orderBookingIds = new Set(workOrders.map(order => order.bookingId));
  const approvalContext = {
    users: db.users || [], resources: db.resources || [], departments: db.departments || [],
    delegates: db.approvalDelegates || []
  };
  const bookings = (db.bookings || []).map(booking => {
    const readable = isAdmin || booking.userId === actor.id || booking.attendeeIds?.includes(actor.id)
      || orderBookingIds.has(booking.id) || canApproveBooking(booking, db.workflow || [], actor, approvalContext);
    return readable ? booking : redactBooking(booking);
  });
  const users = (db.users || []).map(user => isAdmin ? user : {
    ...user,
    landline: undefined,
    mobile: undefined
  });
  return {
    roles: db.roles || [],
    users,
    resources: db.resources || [],
    bookings,
    departments: db.departments || [],
    workflow: db.workflow || [],
    approvalDelegates: (db.approvalDelegates || []).filter(item => isAdmin || item.delegatorId === actor.id || item.delegateId === actor.id),
    workOrders,
    revision
  };
};

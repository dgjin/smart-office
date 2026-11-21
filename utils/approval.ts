import type { ApprovalDelegate, ApprovalNode, ApprovalRecord, Booking, Department, Resource, User } from '../types';

export type ApprovalContext = {
  users: User[];
  resources: Resource[];
  departments: Department[];
  delegates?: ApprovalDelegate[];
  now?: Date;
};

export type ApprovalAuthority = {
  allowed: boolean;
  delegator?: User;
};

export const getBookingWorkflow = (booking: Booking, workflow: ApprovalNode[]) => booking.approvalWorkflow || workflow;

const departmentInScope = (booking: Booking, node: ApprovalNode, context: ApprovalContext) => {
  if (!node.departmentIds?.length) return true;
  const requester = context.users.find(user => user.id === booking.userId);
  let departmentId = booking.requesterDepartmentId
    || context.departments.find(department => department.name === requester?.department)?.id;
  const visited = new Set<string>();
  while (departmentId && !visited.has(departmentId)) {
    if (node.departmentIds.includes(departmentId)) return true;
    visited.add(departmentId);
    departmentId = context.departments.find(department => department.id === departmentId)?.parentId;
  }
  return false;
};

const campusInScope = (booking: Booking, node: ApprovalNode, context: ApprovalContext) => {
  if (!node.campuses?.length) return true;
  const campus = booking.resourceCampus || context.resources.find(resource => resource.id === booking.resourceId)?.campus;
  return Boolean(campus && node.campuses.includes(campus));
};

const canDirectApprove = (booking: Booking, workflow: ApprovalNode[], actor: User, context: ApprovalContext) => {
  const node = getBookingWorkflow(booking, workflow)[booking.currentNodeIndex];
  return booking.status === 'PENDING'
    && booking.userId !== actor.id
    && Boolean(node && actor.role.includes(node.approverRole))
    && departmentInScope(booking, node, context)
    && campusInScope(booking, node, context);
};

export const getApprovalAuthority = (
  booking: Booking,
  workflow: ApprovalNode[],
  actor: User,
  context: ApprovalContext
): ApprovalAuthority => {
  if (booking.userId === actor.id) return { allowed: false };
  if (canDirectApprove(booking, workflow, actor, context)) return { allowed: true };
  const now = (context.now || new Date()).getTime();
  const delegation = (context.delegates || []).find(item => {
    const startsAt = Date.parse(item.startsAt);
    const endsAt = Date.parse(item.endsAt);
    return item.delegateId === actor.id
      && Number.isFinite(startsAt) && Number.isFinite(endsAt)
      && startsAt <= now && now < endsAt
      && context.users.some(user => user.id === item.delegatorId
        && canDirectApprove(booking, workflow, user, context));
  });
  if (!delegation) return { allowed: false };
  return {
    allowed: true,
    delegator: context.users.find(user => user.id === delegation.delegatorId)
  };
};

export const canApproveBooking = (
  booking: Booking,
  workflow: ApprovalNode[],
  actor: User,
  context: ApprovalContext
) => getApprovalAuthority(booking, workflow, actor, context).allowed;

export const getApprovalRecipients = (
  booking: Booking,
  workflow: ApprovalNode[],
  context: ApprovalContext
) => context.users.filter(user => canApproveBooking(booking, workflow, user, context));

export type ApprovalGroup = { booking: Booking; seriesBookings: Booking[] };

export const getApprovalGroups = (
  bookings: Booking[],
  workflow: ApprovalNode[],
  actor: User,
  context: ApprovalContext
): ApprovalGroup[] => {
  const groups = bookings.filter(booking => canApproveBooking(booking, workflow, actor, context)).reduce((result, booking) => {
    const key = booking.seriesKind === 'LONG_TERM' && booking.seriesId
      ? `${booking.seriesId}:${booking.workflowVersion || 0}:${booking.currentNodeIndex}`
      : booking.id;
    const group = result.get(key);
    if (group) group.seriesBookings.push(booking);
    else result.set(key, { booking, seriesBookings: [booking] });
    return result;
  }, new Map<string, ApprovalGroup>());
  return [...groups.values()].map(group => {
    const seriesBookings = [...group.seriesBookings].sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
    return { booking: seriesBookings[0], seriesBookings };
  });
};

export const isLastApprovalNode = (booking: Booking, workflow: ApprovalNode[]) =>
  booking.currentNodeIndex === getBookingWorkflow(booking, workflow).length - 1;

export const approveBooking = (
  booking: Booking,
  workflow: ApprovalNode[],
  approverName: string,
  comment?: string,
  timestamp = new Date().toISOString(),
  identity: Pick<ApprovalRecord, 'approverId' | 'delegatorName' | 'delegatorId'> = {}
): Booking => {
  const effectiveWorkflow = getBookingWorkflow(booking, workflow);
  const node = effectiveWorkflow[booking.currentNodeIndex];
  if (!node || booking.status !== 'PENDING') return booking;
  const isLast = isLastApprovalNode(booking, effectiveWorkflow);
  return {
    ...booking,
    currentNodeIndex: isLast ? booking.currentNodeIndex : booking.currentNodeIndex + 1,
    status: isLast ? 'APPROVED' : 'PENDING',
    approvalHistory: [
      ...booking.approvalHistory,
      { nodeName: node.name, approverName, ...identity, status: 'APPROVED', comment: comment || undefined, timestamp }
    ]
  };
};

export const rejectBooking = (
  booking: Booking,
  workflow: ApprovalNode[],
  approverName: string,
  comment: string,
  timestamp = new Date().toISOString(),
  identity: Pick<ApprovalRecord, 'approverId' | 'delegatorName' | 'delegatorId'> = {}
): Booking => {
  const node = getBookingWorkflow(booking, workflow)[booking.currentNodeIndex];
  if (!node || booking.status !== 'PENDING') return booking;
  return {
    ...booking,
    status: 'REJECTED',
    approvalHistory: [
      ...booking.approvalHistory,
      { nodeName: node.name, approverName, ...identity, status: 'REJECTED', comment, timestamp }
    ]
  };
};

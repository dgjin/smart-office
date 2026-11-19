import type { ApprovalNode, Booking } from '../types';

export const canApproveBooking = (booking: Booking, workflow: ApprovalNode[], roles: string[]) =>
  booking.status === 'PENDING' && roles.includes(workflow[booking.currentNodeIndex]?.approverRole);

export const isLastApprovalNode = (booking: Booking, workflow: ApprovalNode[]) =>
  booking.currentNodeIndex === workflow.length - 1;

export const approveBooking = (
  booking: Booking,
  workflow: ApprovalNode[],
  approverName: string,
  comment?: string,
  timestamp = new Date().toISOString()
): Booking => {
  const node = workflow[booking.currentNodeIndex];
  if (!node || booking.status !== 'PENDING') return booking;
  const isLast = isLastApprovalNode(booking, workflow);
  return {
    ...booking,
    currentNodeIndex: isLast ? booking.currentNodeIndex : booking.currentNodeIndex + 1,
    status: isLast ? 'APPROVED' : 'PENDING',
    approvalHistory: [
      ...booking.approvalHistory,
      { nodeName: node.name, approverName, status: 'APPROVED', comment: comment || undefined, timestamp }
    ]
  };
};

export const rejectBooking = (
  booking: Booking,
  workflow: ApprovalNode[],
  approverName: string,
  comment: string,
  timestamp = new Date().toISOString()
): Booking => {
  const node = workflow[booking.currentNodeIndex];
  if (!node || booking.status !== 'PENDING') return booking;
  return {
    ...booking,
    status: 'REJECTED',
    approvalHistory: [
      ...booking.approvalHistory,
      { nodeName: node.name, approverName, status: 'REJECTED', comment, timestamp }
    ]
  };
};

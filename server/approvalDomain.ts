import crypto from 'node:crypto';
import type { Booking, Notification, User } from '../types.ts';
import { approveBooking, getApprovalAuthority, getApprovalRecipients, getBookingWorkflow, rejectBooking } from '../utils/approval.ts';
import { addApprovalWorkingMinutes } from '../utils/approvalSchedule.ts';
import { getCurrentRuleSettings, getLatestRuleVersion } from '../utils/resourceDomain.ts';
import { validateBookingBatch } from './bookingService.ts';
import { assertConfidentialWhitelist, bookingNoticePurpose } from './confidentiality.ts';
import type { MutationContext } from './db.ts';
import { createBookingWorkOrders } from './serviceDomain.ts';
import type { OfficeDb } from './tools.ts';

const notice = (userId: string, title: string, content: string, type: Notification['type'] = 'INFO'): Notification => ({
  id: crypto.randomUUID(), userId, title, content, type, timestamp: new Date().toISOString(), isRead: false
});

export const applyApprovalDecision = async (
  db: OfficeDb,
  me: User,
  input: { bookingId: string; bookingIds?: string[]; decision: 'APPROVE' | 'REJECT'; comment?: string },
  { audit, scheduleJob }: Pick<MutationContext, 'audit' | 'scheduleJob'>
) => {
  const bookings = db.bookings || [];
  const approvalContext = {
    users: db.users || [], resources: db.resources || [], departments: db.departments || [], delegates: db.approvalDelegates || []
  };
  const notifications: Notification[] = [];
  const requestedIds = [...new Set(input.bookingIds?.length ? input.bookingIds : [input.bookingId])];
  const targetBookings = requestedIds.map(id => bookings.find(booking => booking.id === id));
  if (!targetBookings.length || targetBookings.some(booking => !booking)) {
    throw Object.assign(new Error('部分申请已不存在，请刷新待办后重试'), { status: 409 });
  }
  const authorities = new Map<string, ReturnType<typeof getApprovalAuthority>>();
  targetBookings.forEach(booking => {
    if (booking!.status !== 'PENDING') throw Object.assign(new Error('部分申请已被处理，请刷新待办后重试'), { status: 409 });
    const authority = getApprovalAuthority(booking!, db.workflow || [], me, approvalContext);
    if (!authority.allowed) throw Object.assign(new Error('不允许自审或申请不在你的审批范围内'), { status: 403 });
    authorities.set(booking!.id, authority);
  });
  if (input.decision === 'REJECT' && !input.comment?.trim()) {
    throw Object.assign(new Error('驳回必须填写审批意见'), { status: 400 });
  }
  const timestamp = new Date().toISOString();
  const decisions = new Map<string, { current: Booking; next: Booking; isLast: boolean }>();
  targetBookings.forEach(current => {
    const booking = current!;
    const effectiveWorkflow = getBookingWorkflow(booking, db.workflow || []);
    const isLast = booking.currentNodeIndex >= effectiveWorkflow.length - 1;
    const delegator = authorities.get(booking.id)?.delegator;
    const identity = { approverId: me.id, delegatorId: delegator?.id, delegatorName: delegator?.name };
    if (input.decision === 'APPROVE' && isLast) {
      const requester = (db.users || []).find(user => user.id === booking.userId);
      if (!requester) throw Object.assign(new Error('REQUESTER_NOT_FOUND'), { status: 409 });
      validateBookingBatch({
        db,
        incoming: [booking],
        requester,
        settings: getCurrentRuleSettings(db.ruleVersions),
        ruleVersion: getLatestRuleVersion(db.ruleVersions)?.version || booking.ruleVersion || 1,
        editingId: booking.id
      });
      assertConfidentialWhitelist(db, booking);
    }
    const next = input.decision === 'REJECT'
      ? rejectBooking(booking, effectiveWorkflow, me.name, input.comment || '', timestamp, identity)
      : approveBooking(booking, effectiveWorkflow, me.name, input.comment, timestamp, identity);
    decisions.set(booking.id, { current: booking, next, isLast });
  });
  db.bookings = bookings.map(booking => decisions.get(booking.id)?.next || booking);
  for (const { current: booking, next, isLast } of decisions.values()) {
    const delegator = authorities.get(booking.id)?.delegator;
    const purpose = bookingNoticePurpose(booking);
    notifications.push(notice(booking.userId, input.decision === 'REJECT' ? '预约已驳回' : isLast ? '预约已核准' : '审批节点已通过',
      input.decision === 'REJECT' ? `${purpose}被驳回：${input.comment}` : `${purpose}已通过当前审批节点。`,
      input.decision === 'REJECT' ? 'WARNING' : 'SUCCESS'));
    if (input.decision === 'APPROVE' && !isLast) {
      const settings = getCurrentRuleSettings(db.ruleVersions);
      const submissionToken = String(Date.parse(booking.approvalSubmittedAt || booking.createdAt));
      await scheduleJob({ key: `approval-reminder:${booking.id}:${submissionToken}:${next.currentNodeIndex}`, type: 'APPROVAL_REMINDER', runAt: addApprovalWorkingMinutes(timestamp, settings.approvalReminderAfterMinutes, settings), payload: { bookingId: booking.id, nodeIndex: next.currentNodeIndex, submittedAt: booking.approvalSubmittedAt || booking.createdAt } });
      await scheduleJob({ key: `approval-escalation:${booking.id}:${submissionToken}:${next.currentNodeIndex}`, type: 'APPROVAL_ESCALATION', runAt: addApprovalWorkingMinutes(timestamp, settings.approvalEscalationAfterMinutes, settings), payload: { bookingId: booking.id, nodeIndex: next.currentNodeIndex, submittedAt: booking.approvalSubmittedAt || booking.createdAt } });
      getApprovalRecipients(next, db.workflow || [], approvalContext).forEach(user =>
        notifications.push(notice(user.id, '新预约待审批', `${purpose}已进入你负责的审批节点。`)));
    }
    if (input.decision === 'APPROVE' && isLast) {
      (booking.attendeeIds || []).forEach(id => notifications.push(notice(id, '受邀会议已核准', `${purpose}已核准，请按时参加。`, 'SUCCESS')));
      const newOrders = await createBookingWorkOrders(db, next, { audit, scheduleJob });
      newOrders.forEach(order =>
        (db.users || []).filter(user => user.role.includes(order.assigneeRole)).forEach(user =>
          notifications.push(notice(user.id, '新服务工单待处理', order.title))));
    }
    await audit({
      actorId: me.id, action: input.decision === 'REJECT' ? 'BOOKING_REJECT' : 'BOOKING_APPROVE', entityType: 'BOOKING', entityId: booking.id,
      details: { fromNode: booking.currentNodeIndex, toNode: next.currentNodeIndex, status: next.status, workflowVersion: booking.workflowVersion, delegatorId: delegator?.id }
    });
  }
  return {
    notifications,
    message: input.decision === 'REJECT' ? `已驳回 ${targetBookings.length} 项申请` : `已通过 ${targetBookings.length} 项审批`
  };
};

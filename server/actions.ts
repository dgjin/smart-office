import { mutateDb } from './db.ts';
import { approveBooking, getApprovalAuthority, getApprovalRecipients, getBookingWorkflow, rejectBooking } from '../utils/approval.ts';
import { isActiveBooking } from '../utils/bookingRules.ts';
import type { AgentAction } from './tools.ts';
import type { Booking, Notification } from '../types.ts';

const notice = (userId: string, title: string, content: string, type: Notification['type'] = 'INFO'): Notification => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  userId, title, content, type, timestamp: new Date().toISOString(), isRead: false
});

export const executeAgentAction = async (userId: string, action: AgentAction) => mutateDb(async (db, { audit }) => {
  const me = (db.users || []).find(u => u.id === userId);
  if (!me) throw Object.assign(new Error('无法识别当前用户'), { status: 401 });
  const bookings = db.bookings || [];
  const approvalContext = {
    users: db.users || [], resources: db.resources || [], departments: db.departments || [],
    delegates: db.approvalDelegates || []
  };
  const notifications: Notification[] = [];
  let message = '操作已完成';

  if (action.type === 'PROPOSE_CANCEL') {
    const booking = bookings.find(b => b.id === action.bookingId);
    if (!booking || booking.userId !== userId || !isActiveBooking(booking)) throw Object.assign(new Error('只能取消自己的有效预订'), { status: 403 });
    db.bookings = bookings.map(b => b.id === booking.id ? { ...b, status: 'CANCELLED' as const } : b);
    await audit({ actorId: userId, action: 'BOOKING_CANCEL', entityType: 'BOOKING', entityId: booking.id, details: { previousStatus: booking.status } });
    notifications.push(notice(userId, '申请已撤销', `「${booking.purpose}」已取消，相关资源已释放。`, 'SUCCESS'));
    message = '预订已取消';
  } else if (action.type === 'PROPOSE_APPROVAL') {
    const requestedIds = [...new Set(action.bookingIds?.length ? action.bookingIds : [action.bookingId])];
    const targetBookings = requestedIds.map(id => bookings.find(booking => booking.id === id));
    if (!targetBookings.length || targetBookings.some(booking => !booking)) {
      throw Object.assign(new Error('部分申请已不存在，请刷新待办后重试'), { status: 409 });
    }
    const authorities = new Map<string, ReturnType<typeof getApprovalAuthority>>();
    targetBookings.forEach(booking => {
      if (booking!.status !== 'PENDING') {
        throw Object.assign(new Error('部分申请已被处理，请刷新待办后重试'), { status: 409 });
      }
      const authority = getApprovalAuthority(booking!, db.workflow || [], me, approvalContext);
      if (!authority.allowed) throw Object.assign(new Error('不允许自审或申请不在你的审批范围内'), { status: 403 });
      authorities.set(booking!.id, authority);
    });
    if (action.decision === 'REJECT' && !action.comment?.trim()) {
      throw Object.assign(new Error('驳回必须填写审批意见'), { status: 400 });
    }
    const timestamp = new Date().toISOString();
    const decisions = new Map<string, { current: Booking; next: Booking; isLast: boolean }>();
    targetBookings.forEach(current => {
      const booking = current!;
      const effectiveWorkflow = getBookingWorkflow(booking, db.workflow || []);
      const isLast = booking.currentNodeIndex >= effectiveWorkflow.length - 1;
      const delegator = authorities.get(booking.id)?.delegator;
      const identity = {
        approverId: me.id,
        delegatorId: delegator?.id,
        delegatorName: delegator?.name
      };
      const next = action.decision === 'REJECT'
        ? rejectBooking(booking, effectiveWorkflow, me.name, action.comment || '', timestamp, identity)
        : approveBooking(booking, effectiveWorkflow, me.name, action.comment, timestamp, identity);
      decisions.set(booking.id, { current: booking, next, isLast });
    });
    db.bookings = bookings.map(booking => decisions.get(booking.id)?.next || booking);
    for (const { current: booking, next, isLast } of decisions.values()) {
      const delegator = authorities.get(booking.id)?.delegator;
      notifications.push(notice(booking.userId, action.decision === 'REJECT' ? '预约已驳回' : isLast ? '预约已核准' : '审批节点已通过',
        action.decision === 'REJECT' ? `「${booking.purpose}」被驳回：${action.comment}` : `「${booking.purpose}」已通过当前审批节点。`,
        action.decision === 'REJECT' ? 'WARNING' : 'SUCCESS'));
      if (action.decision === 'APPROVE' && !isLast) {
        getApprovalRecipients(next, db.workflow || [], approvalContext).forEach(user =>
          notifications.push(notice(user.id, '新预约待审批', `「${booking.purpose}」已进入你负责的审批节点。`)));
      }
      if (action.decision === 'APPROVE' && isLast) {
        (booking.attendeeIds || []).forEach(id => notifications.push(notice(id, '受邀会议已核准', `「${booking.purpose}」已核准，请按时参加。`, 'SUCCESS')));
        const existingOrderIds = new Set((db.workOrders || []).map(order => order.id));
        const newOrders = [
          ...(next.needsTeaService ? [{ id: `wo-${next.id}-TEA`, bookingId: next.id, type: 'TEA' as const, title: `「${next.purpose}」茶水服务`, assigneeRole: 'APPROVAL_ADMIN', status: 'TODO' as const, createdAt: timestamp }] : []),
          ...(next.isVideoConference ? [{ id: `wo-${next.id}-VIDEO`, bookingId: next.id, type: 'VIDEO' as const, title: `「${next.purpose}」视频会议保障`, assigneeRole: 'SYSTEM_ADMIN', status: 'TODO' as const, createdAt: timestamp }] : [])
        ].filter(order => !existingOrderIds.has(order.id));
        db.workOrders = [...newOrders, ...(db.workOrders || [])];
        newOrders.forEach(order =>
          (db.users || []).filter(user => user.role.includes(order.assigneeRole)).forEach(user =>
            notifications.push(notice(user.id, '新服务工单待处理', order.title))));
      }
      await audit({
        actorId: me.id, action: action.decision === 'REJECT' ? 'BOOKING_REJECT' : 'BOOKING_APPROVE', entityType: 'BOOKING', entityId: booking.id,
        details: { fromNode: booking.currentNodeIndex, toNode: next.currentNodeIndex, status: next.status, workflowVersion: booking.workflowVersion, delegatorId: delegator?.id }
      });
    }
    message = action.decision === 'REJECT' ? `已驳回 ${targetBookings.length} 项申请` : `已通过 ${targetBookings.length} 项审批`;
  } else if (action.type === 'PROPOSE_CHECK_IN') {
    const booking = bookings.find(b => b.id === action.bookingId);
    const now = Date.now();
    if (!booking || booking.status !== 'APPROVED' || booking.checkedInAt
      || (booking.userId !== userId && !booking.attendeeIds?.includes(userId))
      || now < +new Date(booking.startTime) - 15 * 60000 || now >= +new Date(booking.endTime)) {
      throw Object.assign(new Error('当前不可签到，请在开始前 15 分钟至会议结束前操作'), { status: 409 });
    }
    const checkedInAt = new Date(now).toISOString();
    db.bookings = bookings.map(b => b.id === booking.id ? { ...b, checkedInAt, noShow: false } : b);
    await audit({ actorId: userId, action: 'BOOKING_CHECK_IN', entityType: 'BOOKING', entityId: booking.id });
    notifications.push(notice(userId, '签到成功', `「${booking.purpose}」已完成签到。`, 'SUCCESS'));
    message = '签到成功';
  } else if (action.type === 'PROPOSE_WORK_ORDER') {
    const order = (db.workOrders || []).find(o => o.id === action.workOrderId);
    if (!order || order.status !== 'TODO' || (!me.role.includes('SYSTEM_ADMIN') && !me.role.includes(order.assigneeRole))) {
      throw Object.assign(new Error('该工单不在你的待办范围内'), { status: 403 });
    }
    db.workOrders = (db.workOrders || []).map(o => o.id === order.id ? { ...o, status: 'DONE' as const, completedAt: new Date().toISOString() } : o);
    await audit({ actorId: userId, action: 'WORK_ORDER_COMPLETE', entityType: 'WORK_ORDER', entityId: order.id, details: { bookingId: order.bookingId } });
    const booking = bookings.find(b => b.id === order.bookingId);
    if (booking) notifications.push(notice(booking.userId, '服务需求已处理', `${order.title}已完成。`, 'SUCCESS'));
    message = '工单已完成';
  } else {
    throw Object.assign(new Error('该动作需要在前端表单中完成'), { status: 400 });
  }

  db.notifications = [...notifications, ...(db.notifications || [])].slice(0, 1000);
  return { message, notifications };
});

export const completeBookingEarly = async (userId: string, bookingId: string) => mutateDb(async (db, { audit }) => {
  const booking = (db.bookings || []).find(item => item.id === bookingId);
  const now = Date.now();
  if (!booking || booking.userId !== userId || booking.status !== 'APPROVED' || !booking.checkedInAt
    || now < +new Date(booking.startTime) || now >= +new Date(booking.endTime)) {
    throw Object.assign(new Error('当前不可提前结束该会议'), { status: 409 });
  }
  const endedEarlyAt = new Date(now).toISOString();
  db.bookings = (db.bookings || []).map(item => item.id === bookingId
    ? { ...item, status: 'COMPLETED' as const, endedEarlyAt }
    : item);
  await audit({ actorId: userId, action: 'BOOKING_COMPLETE_EARLY', entityType: 'BOOKING', entityId: bookingId });
  const notifications = [...new Set([booking.userId, ...(booking.attendeeIds || [])])].map(id =>
    notice(id, '会议已提前结束', `「${booking.purpose}」已结束，剩余时段已释放。`, 'SUCCESS'));
  db.notifications = [...notifications, ...(db.notifications || [])].slice(0, 1000);
  return { message: '会议已提前结束', notifications };
});

import { mutateDb } from './db.ts';
import { isActiveBooking } from '../utils/bookingRules.ts';
import { getCurrentRuleSettings } from '../utils/resourceDomain.ts';
import { bookingNoticePurpose } from './confidentiality.ts';
import type { AgentAction } from './tools.ts';
import type { Notification } from '../types.ts';
import { applyApprovalDecision } from './approvalDomain.ts';
import { assertCancellationAuthorized, createBookingWorkOrders } from './serviceDomain.ts';
import { applyWorkOrderTransition } from './serviceOperations.ts';
import { recordCheckIn, releaseBooking } from './usageDomain.ts';

const notice = (userId: string, title: string, content: string, type: Notification['type'] = 'INFO'): Notification => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  userId, title, content, type, timestamp: new Date().toISOString(), isRead: false
});

export const executeAgentAction = async (userId: string, action: AgentAction) => mutateDb(async (db, { audit, scheduleJob }) => {
  const me = (db.users || []).find(u => u.id === userId);
  if (!me) throw Object.assign(new Error('无法识别当前用户'), { status: 401 });
  const bookings = db.bookings || [];
  const notifications: Notification[] = [];
  let message = '操作已完成';

  if (action.type === 'PROPOSE_CANCEL') {
    const booking = bookings.find(b => b.id === action.bookingId);
    if (!booking || booking.userId !== userId || !isActiveBooking(booking)) throw Object.assign(new Error('只能取消自己的有效预订'), { status: 403 });
    const settings = getCurrentRuleSettings(db.ruleVersions);
    const resource = (db.resources || []).find(item => item.id === booking.resourceId);
    const authorization = assertCancellationAuthorized(booking, resource, settings, me);
    const affectedOrders = (db.workOrders || []).filter(order => order.bookingId === booking.id && !['DONE', 'CANCELLED', 'EXCEPTION'].includes(order.status));
    const reason = action.reason?.trim() || '申请人撤销预约';
    const next = releaseBooking(db, booking, { reason, type: 'CANCELLED', actorId: userId, source: 'MANUAL' });
    db.bookings = bookings.map(b => b.id === booking.id ? next : b);
    await audit({ actorId: userId, action: 'BOOKING_CANCEL', entityType: 'BOOKING', entityId: booking.id, details: { previousStatus: booking.status, ...authorization } });
    notifications.push(notice(userId, '申请已撤销', `${bookingNoticePurpose(booking)}已取消，资源、额度、服务和门禁授权已释放。`, 'SUCCESS'));
    affectedOrders.forEach(order => (db.users || []).filter(user => user.role.includes(order.assigneeRole)).forEach(user =>
      notifications.push(notice(user.id, '关联服务单已撤销', `${order.title}：${reason}`, 'WARNING'))));
    message = '预订已取消';
  } else if (action.type === 'PROPOSE_APPROVAL') {
    const result = await applyApprovalDecision(db, me, action, { audit, scheduleJob });
    notifications.push(...result.notifications);
    message = result.message;
  } else if (action.type === 'PROPOSE_CHECK_IN') {
    const booking = bookings.find(b => b.id === action.bookingId);
    if (!booking) throw Object.assign(new Error('BOOKING_NOT_FOUND'), { status: 404 });
    const result = recordCheckIn(db, booking, me, { source: 'MANUAL' });
    db.bookings = bookings.map(b => b.id === booking.id ? result.booking : b);
    await audit({ actorId: userId, action: 'BOOKING_CHECK_IN', entityType: 'BOOKING', entityId: booking.id, details: { eventId: result.event.id, source: result.event.source } });
    notifications.push(notice(userId, '签到成功', `${bookingNoticePurpose(booking)}已完成签到。`, 'SUCCESS'));
    message = '签到成功';
  } else if (action.type === 'PROPOSE_WORK_ORDER') {
    const order = (db.workOrders || []).find(o => o.id === action.workOrderId);
    if (!order || order.status !== 'TODO' || (!me.role.includes('SYSTEM_ADMIN') && !me.role.includes(order.assigneeRole))) {
      throw Object.assign(new Error('该工单不在你的待办范围内'), { status: 403 });
    }
    const started = applyWorkOrderTransition(db, order, me, { action: 'START', reason: '会务待办开始处理' });
    const completed = applyWorkOrderTransition(db, started, me, { action: 'COMPLETE', executionResult: '会务人员确认服务已完成' });
    db.workOrders = (db.workOrders || []).map(o => o.id === order.id ? completed : o);
    await audit({ actorId: userId, action: 'WORK_ORDER_COMPLETE', entityType: 'WORK_ORDER', entityId: order.id, details: { bookingId: order.bookingId, executionResult: completed.executionResult } });
    const booking = bookings.find(b => b.id === order.bookingId);
    if (booking) notifications.push(notice(booking.userId, '服务需求已处理', `${order.title}已完成。`, 'SUCCESS'));
    message = '工单已完成';
  } else {
    throw Object.assign(new Error('该动作需要在前端表单中完成'), { status: 400 });
  }

  db.notifications = [...notifications, ...(db.notifications || [])].slice(0, 1000);
  return { message, notifications };
});

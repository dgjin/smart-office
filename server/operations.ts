import type {
  Booking,
  DashboardSnapshot,
  ExceptionActionRecord,
  OperationalException,
  User
} from '../types.ts';
import { getCurrentRuleSettings } from '../utils/resourceDomain.ts';
import { canReadBookingDetails, isConfidentialBooking } from './confidentiality.ts';
import { mutateDb, readSnapshot } from './db.ts';
import { DbError } from './errors.ts';
import type { OfficeDb } from './tools.ts';

const deviceOfflineAfterMs = () => Math.max(10, Number(process.env.SMART_OFFICE_DEVICE_OFFLINE_AFTER_SECONDS) || 120) * 1000;
const exceptionTitle = (booking: Booking, suffix: string) => `${isConfidentialBooking(booking) ? '涉密会议' : `「${booking.purpose}」`}${suffix}`;

const scopedBookings = (db: OfficeDb, actor: User) => (db.bookings || []).filter(booking => canReadBookingDetails(db, booking, actor));
const scopedWorkOrders = (db: OfficeDb, actor: User, bookings: Booking[]) => {
  const bookingIds = new Set(bookings.map(booking => booking.id));
  return (db.workOrders || []).filter(order => bookingIds.has(order.bookingId)
    && (actor.role.includes('SYSTEM_ADMIN') || actor.role.includes(order.assigneeRole)
      || bookings.some(booking => booking.id === order.bookingId && booking.userId === actor.id)));
};

const baseException = (input: Pick<OperationalException, 'id' | 'kind' | 'severity' | 'title' | 'entityId' | 'ownerRole' | 'occurredAt' | 'closeCondition'>
  & Partial<Pick<OperationalException, 'bookingId' | 'workOrderId' | 'deviceId' | 'resourceId' | 'dueAt'>>): OperationalException => ({
    ...input,
    status: 'OPEN',
    updatedAt: input.occurredAt,
    history: []
  });

const currentExceptions = (db: OfficeDb, actor: User, now: Date): OperationalException[] => {
  const bookings = scopedBookings(db, actor);
  const orders = scopedWorkOrders(db, actor, bookings);
  const bookingById = new Map(bookings.map(booking => [booking.id, booking]));
  const nowMs = now.getTime();
  const rows: OperationalException[] = [];
  for (const booking of bookings) {
    if (booking.status === 'PENDING') {
      const settings = booking.ruleSettingsSnapshot || getCurrentRuleSettings(db.ruleVersions);
      const submittedAt = Date.parse(booking.approvalSubmittedAt || booking.createdAt);
      const dueAt = new Date(submittedAt + settings.approvalEscalationAfterMinutes * 60000);
      if (Number.isFinite(submittedAt) && dueAt.getTime() <= nowMs) {
        const workflow = booking.approvalWorkflow?.length ? booking.approvalWorkflow : db.workflow || [];
        rows.push(baseException({
          id: `approval-overdue:${booking.id}:${booking.currentNodeIndex}`,
          kind: 'APPROVAL_OVERDUE', severity: 'WARNING', entityId: booking.id, bookingId: booking.id,
          resourceId: booking.resourceId, ownerRole: workflow[booking.currentNodeIndex]?.approverRole || 'APPROVAL_ADMIN',
          title: exceptionTitle(booking, '审批已超时'), occurredAt: dueAt.toISOString(), dueAt: dueAt.toISOString(),
          closeCondition: '当前审批节点完成核准或驳回后自动关闭。'
        }));
      }
    }
    if (booking.noShow || booking.releaseType === 'NO_SHOW') {
      const occurredAt = booking.releasedAt || booking.endTime;
      rows.push(baseException({
        id: `no-show:${booking.id}:${booking.scheduleVersion || 1}`,
        kind: 'NO_SHOW', severity: 'CRITICAL', entityId: booking.id, bookingId: booking.id,
        resourceId: booking.resourceId, ownerRole: 'FRONT_DESK', title: exceptionTitle(booking, '未签到并已释放'),
        occurredAt, closeCondition: '会务复核资源、额度、服务与门禁释放结果后，填写复核记录关闭。'
      }));
    }
  }
  for (const order of orders) {
    const booking = bookingById.get(order.bookingId);
    const open = !['DONE', 'CANCELLED'].includes(order.status);
    const exceptional = order.status === 'EXCEPTION';
    const overdue = open && order.responseDueAt && Date.parse(order.responseDueAt) <= nowMs && !order.respondedAt;
    if (!exceptional && !overdue) continue;
    const occurredAt = exceptional
      ? order.statusHistory?.filter(item => item.to === 'EXCEPTION').at(-1)?.at || order.createdAt
      : order.responseDueAt!;
    rows.push(baseException({
      id: `service:${order.id}:${exceptional ? 'exception' : 'sla'}`,
      kind: 'SERVICE_EXCEPTION', severity: exceptional ? 'CRITICAL' : 'WARNING', entityId: order.id,
      bookingId: order.bookingId, workOrderId: order.id, resourceId: booking?.resourceId,
      ownerRole: order.assigneeRole,
      title: `${booking ? exceptionTitle(booking, '') : '会务工单'}会务服务·${exceptional ? '执行异常' : '响应超时'}`,
      occurredAt, dueAt: order.responseDueAt,
      closeCondition: '工单恢复执行、完成或取消后自动关闭；处理记录保留在状态历史中。'
    }));
  }
  if (actor.role.includes('SYSTEM_ADMIN')) {
    for (const device of db.devices || []) {
      if (device.status !== 'ACTIVE') continue;
      const heartbeatAt = device.lastHeartbeatAt ? Date.parse(device.lastHeartbeatAt) : 0;
      if (heartbeatAt && nowMs - heartbeatAt <= deviceOfflineAfterMs()) continue;
      const occurredAt = heartbeatAt ? new Date(heartbeatAt + deviceOfflineAfterMs()).toISOString() : device.updatedAt;
      rows.push(baseException({
        id: `device-offline:${device.id}`, kind: 'DEVICE_OFFLINE', severity: 'CRITICAL',
        entityId: device.id, deviceId: device.id, resourceId: device.resourceId, ownerRole: 'SYSTEM_ADMIN',
        title: `门口屏「${device.name}」离线`, occurredAt,
        closeCondition: '设备使用有效独立凭证恢复心跳后自动关闭。'
      }));
    }
  }
  return rows;
};

const withActionRecords = (current: OperationalException[], records: ExceptionActionRecord[], actor: User) => {
  const currentIds = new Set(current.map(item => item.id));
  const visible = current.map(item => {
    const record = records.find(action => action.id === item.id);
    if (!record) return item;
    return {
      ...item,
      status: record.status,
      ownerId: record.ownerId,
      resolutionNote: record.note,
      updatedAt: record.updatedAt,
      history: record.history
    };
  });
  const closed = records.filter(record => !currentIds.has(record.id)
    && (actor.role.includes('SYSTEM_ADMIN') || actor.role.includes(record.ownerRole)
      || record.ownerId === actor.id || record.history.some(entry => entry.actorId === actor.id))).map(record => ({
    id: record.id, kind: record.kind, severity: 'WARNING' as const, title: record.title,
    entityId: record.entityId, ownerRole: record.ownerRole, ownerId: record.ownerId,
    status: 'RESOLVED' as const, occurredAt: record.history[0]?.at || record.updatedAt,
    closeCondition: '异常事实已消除，自动关闭。', resolutionNote: record.note,
    updatedAt: record.updatedAt, history: record.history
  }));
  return [...visible, ...closed].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 300);
};

export const getDashboard = async (actor: User): Promise<DashboardSnapshot> => {
  const { db, revision } = await readSnapshot();
  const now = new Date();
  const bookings = scopedBookings(db, actor);
  const orders = scopedWorkOrders(db, actor, bookings);
  const resources = (db.resources || []).filter(resource => actor.role.includes('SYSTEM_ADMIN')
    || actor.role.includes('SERVICE_COORDINATOR') || actor.role.includes('FRONT_DESK') || resource.isPublic !== false);
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const todayBookings = bookings.filter(booking => Date.parse(booking.startTime) < dayEnd.getTime() && Date.parse(booking.endTime) > dayStart.getTime());
  const actualMinutes = todayBookings.reduce((total, booking) => {
    const fact = (db.usageFacts || []).find(item => item.bookingId === booking.id && item.scheduleVersion === (booking.scheduleVersion || 1));
    return total + (fact?.actualMinutes || 0);
  }, 0);
  const scheduledMinutes = todayBookings.reduce((total, booking) => {
    const start = Math.max(dayStart.getTime(), Date.parse(booking.startTime));
    const end = Math.min(dayEnd.getTime(), Date.parse(booking.actualEndTime || booking.endTime));
    return total + Math.max(0, end - start) / 60000;
  }, 0);
  const next = bookings.filter(booking => booking.status === 'APPROVED' && Date.parse(booking.endTime) >= now.getTime()
    && (booking.userId === actor.id || (booking.attendeeIds || []).includes(actor.id)))
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))[0];
  const exceptions = withActionRecords(currentExceptions(db, actor, now), db.exceptionActions || [], actor);
  return {
    generatedAt: now.toISOString(), revision,
    scope: actor.role.includes('SYSTEM_ADMIN') ? 'ENTERPRISE'
      : actor.role.some(role => ['APPROVAL_ADMIN', 'SERVICE_COORDINATOR', 'FRONT_DESK', 'SECURITY_ADMIN'].includes(role)) ? 'OPERATIONS' : 'PERSONAL',
    stats: {
      totalResources: resources.length,
      availableRooms: resources.filter(resource => resource.type === 'ROOM' && resource.status === 'AVAILABLE').length,
      availableDesks: resources.filter(resource => resource.type === 'DESK' && resource.status === 'AVAILABLE').length,
      activeBookings: bookings.filter(booking => booking.status === 'APPROVED').length,
      pendingBookings: bookings.filter(booking => booking.status === 'PENDING').length,
      openWorkOrders: orders.filter(order => !['DONE', 'CANCELLED'].includes(order.status)).length,
      openExceptions: exceptions.filter(item => item.status !== 'RESOLVED').length
    },
    today: {
      bookingCount: todayBookings.length,
      scheduledMinutes: Math.round(scheduledMinutes),
      actualMinutes: Math.round(actualMinutes)
    },
    nextBooking: next ? {
      id: next.id, resourceId: next.resourceId, startTime: next.startTime, endTime: next.endTime,
      purpose: isConfidentialBooking(next) ? '涉密会议' : next.purpose
    } : undefined
  };
};

export const getExceptionCenter = async (actor: User) => {
  const { db, revision } = await readSnapshot();
  const now = new Date();
  return {
    generatedAt: now.toISOString(), revision,
    exceptions: withActionRecords(currentExceptions(db, actor, now), db.exceptionActions || [], actor)
  };
};

const canHandle = (actor: User, exception: OperationalException, db: OfficeDb) => {
  if (actor.role.includes('SYSTEM_ADMIN')) return true;
  if (exception.kind === 'DEVICE_OFFLINE') return false;
  if (exception.kind === 'NO_SHOW') return actor.role.includes('FRONT_DESK') || actor.role.includes('APPROVAL_ADMIN');
  if (exception.kind === 'APPROVAL_OVERDUE') return actor.role.includes('APPROVAL_ADMIN') || actor.role.includes(exception.ownerRole);
  const order = (db.workOrders || []).find(item => item.id === exception.workOrderId);
  return Boolean(order && actor.role.includes(order.assigneeRole));
};

export const actOnException = async (actor: User, id: string, input: any) => mutateDb(async (db, { audit }) => {
  if (!['ACKNOWLEDGE', 'RESOLVE'].includes(input?.action)) throw new DbError('INVALID_EXCEPTION_ACTION', 400);
  const note = String(input?.note || '').trim();
  if (note.length < 2 || note.length > 500) throw new DbError('EXCEPTION_NOTE_REQUIRED', 400);
  const now = new Date();
  const exception = currentExceptions(db, actor, now).find(item => item.id === id);
  if (!exception) throw new DbError('EXCEPTION_NOT_FOUND', 404);
  if (!canHandle(actor, exception, db)) throw new DbError('FORBIDDEN', 403);
  if (input.action === 'RESOLVE' && exception.kind !== 'NO_SHOW') throw new DbError('EXCEPTION_CLOSE_CONDITION_UNMET', 409);
  const records = db.exceptionActions || [];
  const previous = records.find(item => item.id === id);
  if (previous?.status === 'RESOLVED') throw new DbError('EXCEPTION_ALREADY_RESOLVED', 409);
  const status = input.action === 'RESOLVE' ? 'RESOLVED' as const : 'ACKNOWLEDGED' as const;
  const record: ExceptionActionRecord = {
    id, kind: exception.kind, title: exception.title, entityId: exception.entityId, ownerRole: exception.ownerRole,
    status, ownerId: actor.id, note, updatedAt: now.toISOString(),
    history: [...(previous?.history || []), { status, actorId: actor.id, note, at: now.toISOString() }]
  };
  db.exceptionActions = [record, ...records.filter(item => item.id !== id)];
  await audit({ actorId: actor.id, action: `EXCEPTION_${input.action}`, entityType: exception.kind, entityId: exception.entityId, details: { exceptionId: id, note } });
  return { ...exception, status, ownerId: actor.id, resolutionNote: note, updatedAt: record.updatedAt, history: record.history };
});

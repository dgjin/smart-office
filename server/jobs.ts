import crypto from 'node:crypto';
import { getDbPool, mutateDb } from './db.ts';
import type { Booking, Notification, ServiceInspection } from '../types.ts';
import { getApprovalRecipients } from '../utils/approval.ts';
import { addApprovalWorkingMinutes } from '../utils/approvalSchedule.ts';
import { getCurrentRuleSettings } from '../utils/resourceDomain.ts';
import { bookingNoticePurpose } from './confidentiality.ts';
import { logEvent } from './observability.ts';
import { createBookingWorkOrders, ensureServiceDomain, isHeavyServiceBooking } from './serviceDomain.ts';
import { releaseBooking } from './usageDomain.ts';
import { deliverExternalNotification } from './externalMessages.ts';
import { deliverIntegrationEvent, recordIntegrationDelivery } from './externalIntegrations.ts';

const workerId = crypto.randomUUID();
const intervalMs = Math.max(50, Number(process.env.SMART_OFFICE_JOB_INTERVAL_MS || 1000));
const leaseMs = Math.max(1000, Number(process.env.SMART_OFFICE_JOB_LEASE_MS || 30000));
let timer: NodeJS.Timeout | null = null;
let active: Promise<void> | null = null;

const notice = (id: string, userId: string, title: string, content: string, type: Notification['type']): Notification => ({
  id, userId, title, content, type, timestamp: new Date().toISOString(), isRead: false
});

const reconcileJobs = async () => mutateDb(async (db, context) => {
  ensureServiceDomain(db);
  let changed = false;
  const settings = getCurrentRuleSettings(db.ruleVersions);
  for (const booking of db.bookings || []) {
    if (booking.status === 'PENDING') {
      const submittedAt = booking.approvalSubmittedAt || booking.createdAt;
      const submissionToken = String(Date.parse(submittedAt));
      const nodeStartedAt = booking.currentNodeIndex > 0
        ? booking.approvalHistory[booking.approvalHistory.length - 1]?.timestamp || submittedAt
        : submittedAt;
      await context.scheduleJob({ key: `approval-reminder:${booking.id}:${submissionToken}:${booking.currentNodeIndex}`, type: 'APPROVAL_REMINDER', runAt: addApprovalWorkingMinutes(nodeStartedAt, settings.approvalReminderAfterMinutes, settings), payload: { bookingId: booking.id, nodeIndex: booking.currentNodeIndex, submittedAt } });
      await context.scheduleJob({ key: `approval-escalation:${booking.id}:${submissionToken}:${booking.currentNodeIndex}`, type: 'APPROVAL_ESCALATION', runAt: addApprovalWorkingMinutes(nodeStartedAt, settings.approvalEscalationAfterMinutes, settings), payload: { bookingId: booking.id, nodeIndex: booking.currentNodeIndex, submittedAt } });
      await context.scheduleJob({ key: `approval-close:${booking.id}:${submissionToken}`, type: 'APPROVAL_CLOSE', runAt: new Date(Date.parse(booking.startTime) - settings.unapprovedCloseBeforeStartMinutes * 60000), payload: { bookingId: booking.id, submittedAt } });
      continue;
    }
    if (booking.status !== 'APPROVED') continue;
    const start = new Date(booking.startTime);
    const scheduleVersion = booking.scheduleVersion || 1;
    const payload = { bookingId: booking.id, scheduleVersion };
    await context.scheduleJob({ key: `reminder:${booking.id}:v${scheduleVersion}`, type: 'BOOKING_REMINDER', runAt: new Date(start.getTime() - 15 * 60000), payload });
    if (booking.type === 'ROOM') {
      const bookingSettings = booking.ruleSettingsSnapshot || settings;
      await context.scheduleJob({ key: `check-in-reminder:${booking.id}:v${scheduleVersion}`, type: 'BOOKING_CHECK_IN_REMINDER', runAt: new Date(start.getTime() + bookingSettings.checkInReminderAfterStartMinutes * 60000), payload });
      const noShowAt = Math.max(start.getTime() + bookingSettings.noShowReleaseAfterStartMinutes * 60000, Date.parse(booking.noShowReleaseNotBefore || '') || 0);
      await context.scheduleJob({ key: `noshow:${booking.id}:v${scheduleVersion}`, type: 'BOOKING_NO_SHOW', runAt: new Date(noShowAt), payload });
    }
    const created = await createBookingWorkOrders(db, booking, context);
    if (created.length) changed = true;
    const resource = (db.resources || []).find(item => item.id === booking.resourceId);
    const inspectionKinds: Array<ServiceInspection['kind']> = ['PRE_OPEN'];
    if (booking.meetingType !== 'NORMAL' || isHeavyServiceBooking(booking, resource)) inspectionKinds.push('IMPORTANT_PRE_30');
    if (Date.parse(booking.endTime) - start.getTime() > 2 * 3600000) inspectionKinds.push('ROUTINE_2H');
    for (const kind of inspectionKinds) {
      const id = `inspection-${booking.id}-v${scheduleVersion}-${kind}`;
      if ((db.serviceInspections || []).some(item => item.id === id)) continue;
      const dueAt = new Date(start.getTime() + (kind === 'ROUTINE_2H' ? 120 : -30) * 60000);
      if (dueAt.getTime() < Date.now() - 60000) continue;
      const inspection: ServiceInspection = {
        id, areaId: (db.serviceAreas || []).find(area => area.resourceIds.includes(booking.resourceId))?.id || 'area-default',
        bookingId: booking.id, kind, dueAt: dueAt.toISOString(), status: 'PENDING'
      };
      db.serviceInspections = [inspection, ...(db.serviceInspections || [])];
      await context.scheduleJob({ key: `service-inspection:${id}`, type: 'SERVICE_INSPECTION', runAt: dueAt, payload: { bookingId: booking.id, inspectionId: id, areaId: inspection.areaId, scheduleVersion } });
      changed = true;
    }
  }
  for (const order of db.workOrders || []) {
    if (!['TODO', 'PENDING_INFO', 'IN_PROGRESS'].includes(order.status) || order.respondedAt || !order.responseDueAt) continue;
    await context.scheduleJob({
      key: `service-sla:${order.id}`, type: 'SERVICE_SLA_ESCALATION', runAt: new Date(order.responseDueAt),
      payload: { bookingId: order.bookingId, workOrderId: order.id, scheduleVersion: order.scheduleVersion || 1 }
    });
  }
  return changed;
}, { snapshot: result => result });

const claimJob = async () => {
  const conn = await getDbPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<any[]>(`SELECT * FROM scheduled_jobs
      WHERE (status = 'PENDING' AND run_at <= UTC_TIMESTAMP(3))
        OR (status = 'RUNNING' AND lease_expires_at <= UTC_TIMESTAMP(3))
      ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const job = rows[0];
    if (!job) {
      await conn.commit();
      return null;
    }
    if (Number(job.attempts) >= Number(job.max_attempts)) {
      await conn.query("UPDATE scheduled_jobs SET status = 'FAILED', lease_owner = NULL, lease_expires_at = NULL WHERE id = ?", [job.id]);
      await conn.commit();
      return null;
    }
    await conn.query(`UPDATE scheduled_jobs SET status = 'RUNNING', lease_owner = ?,
      lease_expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MICROSECOND), attempts = attempts + 1 WHERE id = ?`, [workerId, leaseMs * 1000, job.id]);
    await conn.commit();
    return job;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const finishJob = async (id: string, error?: unknown, attempts = 0, maxAttempts = 8) => {
  if (!error) {
    await getDbPool().query("UPDATE scheduled_jobs SET status = 'DONE', lease_owner = NULL, lease_expires_at = NULL, completed_at = UTC_TIMESTAMP(3), last_error = NULL WHERE id = ?", [id]);
    return;
  }
  const message = String((error as any)?.message || error).slice(0, 2000);
  const retry = attempts < maxAttempts;
  await getDbPool().query(`UPDATE scheduled_jobs SET status = ?, run_at = IF(?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL LEAST(60, POW(2, ?)) SECOND), run_at),
    lease_owner = NULL, lease_expires_at = NULL, last_error = ? WHERE id = ?`, [retry ? 'PENDING' : 'FAILED', retry, attempts, message, id]);
};

const isCurrentApprovalJob = (booking: Booking, payload: any) =>
  (!payload.submittedAt || payload.submittedAt === (booking.approvalSubmittedAt || booking.createdAt))
  && (payload.nodeIndex === undefined || payload.nodeIndex === booking.currentNodeIndex);

const processJob = async (job: any) => {
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
  await mutateDb(async (db, { audit }) => {
    const booking = (db.bookings || []).find(item => item.id === payload.bookingId);
    if (!booking) return false;
    const now = Date.now();
    const start = new Date(booking.startTime).getTime();
    const recipients = [...new Set([booking.userId, ...(booking.attendeeIds || [])])];
    const resource = (db.resources || []).find(item => item.id === booking.resourceId);
    const approvalContext = {
      users: db.users || [], resources: db.resources || [], departments: db.departments || [], delegates: db.approvalDelegates || []
    };
    const approvalRecipients = getApprovalRecipients(booking, db.workflow || [], approvalContext);
    const notifications: Notification[] = [];
    let changed = false;
    const scheduleVersion = booking.scheduleVersion || 1;
    const jobScheduleVersion = payload.scheduleVersion || 1;
    if (['BOOKING_REMINDER', 'BOOKING_CHECK_IN_REMINDER', 'BOOKING_NO_SHOW', 'SERVICE_SLA_ESCALATION', 'SERVICE_INSPECTION'].includes(job.job_type)
      && jobScheduleVersion !== scheduleVersion) return false;
    if (job.job_type === 'BOOKING_REMINDER') {
      if (booking.status !== 'APPROVED' || start <= now || start - now > 15 * 60000) return false;
      recipients.forEach(userId => notifications.push(notice(`reminder-${booking.id}-v${scheduleVersion}-${userId}`, userId, '会前 15 分钟提醒', `${bookingNoticePurpose(booking)}将于 ${new Date(booking.startTime).toLocaleString('zh-CN')} 在 ${resource?.name || '预约空间'} 开始，请准时到场。`, 'INFO')));
    } else if (job.job_type === 'BOOKING_CHECK_IN_REMINDER') {
      const settings = booking.ruleSettingsSnapshot || getCurrentRuleSettings(db.ruleVersions);
      if (booking.type !== 'ROOM' || booking.status !== 'APPROVED' || booking.checkedInAt || now < start + settings.checkInReminderAfterStartMinutes * 60000) return false;
      recipients.forEach(userId => notifications.push(notice(`check-in-reminder-${booking.id}-v${scheduleVersion}-${userId}`, userId, '会议签到提醒', `${bookingNoticePurpose(booking)}已开始 ${settings.checkInReminderAfterStartMinutes} 分钟，请完成签到；未签到将在 ${settings.noShowReleaseAfterStartMinutes} 分钟释放。`, 'WARNING')));
    } else if (job.job_type === 'BOOKING_NO_SHOW') {
      const settings = booking.ruleSettingsSnapshot || getCurrentRuleSettings(db.ruleVersions);
      if (booking.type !== 'ROOM' || booking.status !== 'APPROVED' || booking.checkedInAt || booking.exclusiveAccessType
        || now < start + settings.noShowReleaseAfterStartMinutes * 60000
        || now < (Date.parse(booking.noShowReleaseNotBefore || '') || 0)) return false;
      const affectedOrders = (db.workOrders || []).filter(order => order.bookingId === booking.id && !['DONE', 'CANCELLED', 'EXCEPTION'].includes(order.status));
      const reason = `会议开始 ${settings.noShowReleaseAfterStartMinutes} 分钟后仍未签到，系统自动释放`;
      const next = releaseBooking(db, booking, { reason, type: 'NO_SHOW', noShow: true, source: 'SYSTEM' });
      db.bookings = (db.bookings || []).map(item => item.id === booking.id ? next : item);
      await audit({ action: 'BOOKING_NO_SHOW_CANCEL', entityType: 'BOOKING', entityId: booking.id, details: { previousStatus: booking.status, resourceId: booking.resourceId, scheduleVersion } });
      recipients.forEach(userId => notifications.push(notice(`noshow-${booking.id}-v${scheduleVersion}-${userId}`, userId, '未签到，会议室已释放', `${bookingNoticePurpose(booking)}${reason}，${resource?.name || '会议室'} 的剩余时段、额度、服务和门禁授权已释放。`, 'WARNING')));
      affectedOrders.forEach(order => (db.users || []).filter(user => user.role.includes(order.assigneeRole)).forEach(user =>
        notifications.push(notice(`noshow-service-${booking.id}-v${scheduleVersion}-${order.id}-${user.id}`, user.id, '未执行服务已联动撤销', `${order.title}：${reason}`, 'WARNING'))));
      changed = true;
    } else if (job.job_type === 'APPROVAL_REMINDER') {
      if (booking.status !== 'PENDING' || !isCurrentApprovalJob(booking, payload)) return false;
      const submissionToken = String(Date.parse(booking.approvalSubmittedAt || booking.createdAt));
      approvalRecipients.forEach(user => notifications.push(notice(`approval-reminder-${booking.id}-${submissionToken}-${booking.currentNodeIndex}-${user.id}`, user.id, '审批待办提醒', `${bookingNoticePurpose(booking)}已到达当前节点的审批提醒时限，请及时处理。`, 'INFO')));
    } else if (job.job_type === 'APPROVAL_ESCALATION') {
      if (booking.status !== 'PENDING' || !isCurrentApprovalJob(booking, payload)) return false;
      const escalated = new Map(approvalRecipients.map(user => [user.id, user]));
      (db.users || []).filter(user => user.role.includes('SYSTEM_ADMIN')).forEach(user => escalated.set(user.id, user));
      const submissionToken = String(Date.parse(booking.approvalSubmittedAt || booking.createdAt));
      escalated.forEach(user => notifications.push(notice(`approval-escalation-${booking.id}-${submissionToken}-${booking.currentNodeIndex}-${user.id}`, user.id, '审批超时升级', '一项申请已到达当前节点的审批升级时限，请尽快协调处理。', 'WARNING')));
      await audit({ action: 'APPROVAL_ESCALATED', entityType: 'BOOKING', entityId: booking.id, details: { nodeIndex: booking.currentNodeIndex, workflowVersion: booking.workflowVersion } });
    } else if (job.job_type === 'APPROVAL_CLOSE') {
      const settings = getCurrentRuleSettings(db.ruleVersions);
      if (booking.status !== 'PENDING' || !isCurrentApprovalJob(booking, payload)
        || now < start - settings.unapprovedCloseBeforeStartMinutes * 60000) return false;
      const approvalClosedAt = new Date(now).toISOString();
      const released = releaseBooking(db, booking, { reason: '会前未完成核准，自动关闭', type: 'CANCELLED', source: 'SYSTEM', at: approvalClosedAt });
      const next = { ...released, approvalClosedAt, approvalCloseReason: 'UNAPPROVED_BEFORE_START' as const };
      db.bookings = (db.bookings || []).map(item => item.id === booking.id ? next : item);
      await audit({ action: 'APPROVAL_AUTO_CLOSE', entityType: 'BOOKING', entityId: booking.id, details: { nodeIndex: booking.currentNodeIndex, reason: 'UNAPPROVED_BEFORE_START' } });
      const notified = new Set([...recipients, ...approvalRecipients.map(user => user.id)]);
      notified.forEach(userId => notifications.push(notice(`approval-close-${booking.id}-${userId}`, userId, '预约未核准，已自动关闭', `${bookingNoticePurpose(booking)}未在规定时限内完成核准，预约已关闭并释放资源。`, 'WARNING')));
      changed = true;
    } else if (job.job_type === 'SERVICE_SLA_ESCALATION') {
      const order = (db.workOrders || []).find(item => item.id === payload.workOrderId);
      if (!order || order.bookingId !== booking.id || order.respondedAt || !order.responseDueAt
        || !['TODO', 'PENDING_INFO', 'IN_PROGRESS'].includes(order.status) || now < Date.parse(order.responseDueAt)) return false;
      const serviceUsers = new Map((db.users || []).filter(user => user.role.includes(order.assigneeRole) || user.role.includes('SYSTEM_ADMIN')).map(user => [user.id, user]));
      (db.serviceShifts || []).filter(shift => shift.areaId === order.areaId && Date.parse(shift.startsAt) <= now && Date.parse(shift.endsAt) > now)
        .forEach(shift => {
          const user = (db.users || []).find(item => item.id === shift.assigneeId);
          if (user) serviceUsers.set(user.id, user);
        });
      serviceUsers.forEach(user => notifications.push(notice(`service-sla-${order.id}-${user.id}`, user.id, '会务服务响应超时', `${order.title}已超过 ${order.requirementSnapshot?.catalogSnapshot?.slaResponseMinutes || 10} 分钟响应时限，请立即处理。`, 'WARNING')));
      await audit({ action: 'SERVICE_SLA_ESCALATED', entityType: 'WORK_ORDER', entityId: order.id, details: { bookingId: booking.id, responseDueAt: order.responseDueAt } });
    } else if (job.job_type === 'SERVICE_INSPECTION') {
      const inspection = (db.serviceInspections || []).find(item => item.id === payload.inspectionId);
      if (!inspection || inspection.status !== 'PENDING' || now < Date.parse(inspection.dueAt)) return false;
      const serviceUsers = new Map((db.users || []).filter(user => user.role.includes('SERVICE_COORDINATOR') || user.role.includes('FRONT_DESK')).map(user => [user.id, user]));
      (db.serviceShifts || []).filter(shift => shift.areaId === inspection.areaId && Date.parse(shift.startsAt) <= now && Date.parse(shift.endsAt) > now)
        .forEach(shift => {
          const user = (db.users || []).find(item => item.id === shift.assigneeId);
          if (user) serviceUsers.set(user.id, user);
        });
      serviceUsers.forEach(user => notifications.push(notice(`service-inspection-${inspection.id}-${user.id}`, user.id, '会务巡查待执行', `${bookingNoticePurpose(booking)}的 ${inspection.kind} 巡查已到执行时间。`, 'INFO')));
    }
    const existing = new Set((db.notifications || []).map(item => item.id));
    db.notifications = [...notifications.filter(item => !existing.has(item.id)), ...(db.notifications || [])].slice(0, 1000);
    return changed;
  }, { snapshot: result => result });
};

const claimOutbox = async () => {
  const conn = await getDbPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<any[]>(`SELECT * FROM outbox_events
      WHERE (status = 'PENDING' AND available_at <= UTC_TIMESTAMP(3))
        OR (status = 'RUNNING' AND lease_expires_at <= UTC_TIMESTAMP(3))
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const event = rows[0];
    if (!event) {
      await conn.commit();
      return null;
    }
    if (Number(event.attempts) >= Number(event.max_attempts)) {
      await conn.query("UPDATE outbox_events SET status = 'FAILED', lease_owner = NULL, lease_expires_at = NULL WHERE id = ?", [event.id]);
      await conn.commit();
      return null;
    }
    await conn.query(`UPDATE outbox_events SET status = 'RUNNING', lease_owner = ?,
      lease_expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MICROSECOND), attempts = attempts + 1 WHERE id = ?`, [workerId, leaseMs * 1000, event.id]);
    await conn.commit();
    return event;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const finishOutbox = async (id: string, error?: unknown, attempts = 0, maxAttempts = 8) => {
  if (!error) {
    await getDbPool().query("UPDATE outbox_events SET status = 'DONE', lease_owner = NULL, lease_expires_at = NULL, processed_at = UTC_TIMESTAMP(3), last_error = NULL WHERE id = ?", [id]);
    return;
  }
  const message = String((error as any)?.message || error).slice(0, 2000);
  const retry = attempts < maxAttempts;
  await getDbPool().query(`UPDATE outbox_events SET status = ?, available_at = IF(?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL LEAST(60, POW(2, ?)) SECOND), available_at),
    lease_owner = NULL, lease_expires_at = NULL, last_error = ? WHERE id = ?`, [retry ? 'PENDING' : 'FAILED', retry, attempts, message, id]);
};

const processOutbox = async (event: any) => {
  const item = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
  if (event.event_type === 'IN_APP_NOTIFICATION') {
    await getDbPool().query(`INSERT IGNORE INTO notifications (id, user_id, title, content, timestamp, is_read, type, link_view)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [item.id, item.userId, item.title, item.content, new Date(item.timestamp), item.isRead, item.type, item.linkView || null]);
    return;
  }
  if (event.event_type === 'EXTERNAL_NOTIFICATION') {
    const result = await deliverExternalNotification(item, event.event_key);
    logEvent('info', result.outcome === 'DELIVERED' ? 'external_message.delivered' : 'external_message.skipped', {
      eventKey: event.event_key,
      channel: item.channel,
      ...(result.outcome === 'DELIVERED' ? { status: result.status } : { reason: result.reason })
    });
    return;
  }
  if (['CALENDAR_SYNC', 'ACCESS_CONTROL'].includes(event.event_type)) {
    const eventType = event.event_type as 'CALENDAR_SYNC' | 'ACCESS_CONTROL';
    try {
      const result = await deliverIntegrationEvent(eventType, item, event.event_key);
      await recordIntegrationDelivery(event.event_key, eventType, item, result);
      logEvent('info', result.outcome === 'DELIVERED' ? 'integration.delivered' : 'integration.skipped', {
        eventKey: event.event_key, eventType,
        ...(result.outcome === 'DELIVERED' ? { status: result.status } : { reason: result.reason, outcome: result.outcome })
      });
    } catch (error) {
      const reason = String((error as any)?.message || 'INTEGRATION_DELIVERY_FAILED').slice(0, 200);
      await recordIntegrationDelivery(event.event_key, eventType, item, { outcome: 'FAILED', reason });
      throw error;
    }
    return;
  }
  throw new Error(`不支持的 Outbox 类型 ${event.event_type}`);
};

const tick = async () => {
  await reconcileJobs();
  for (;;) {
    const job = await claimJob();
    if (!job) break;
    try {
      await processJob(job);
      await finishJob(job.id);
    } catch (err) {
      await finishJob(job.id, err, Number(job.attempts) + 1, Number(job.max_attempts));
    }
  }
  for (;;) {
    const event = await claimOutbox();
    if (!event) break;
    try {
      await processOutbox(event);
      await finishOutbox(event.id);
    } catch (err) {
      await finishOutbox(event.id, err, Number(event.attempts) + 1, Number(event.max_attempts));
    }
  }
};

export const startJobWorker = () => {
  if (timer) return;
  const run = () => {
    if (active) return;
    active = tick().catch((err: any) => logEvent('error', 'jobs.tick_failed', { errorName: err?.name, code: err?.code })).finally(() => { active = null; });
  };
  run();
  timer = setInterval(run, intervalMs);
  timer.unref();
};

export const stopJobWorker = async () => {
  if (timer) clearInterval(timer);
  timer = null;
  await active;
};

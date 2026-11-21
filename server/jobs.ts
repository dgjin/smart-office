import crypto from 'node:crypto';
import { getDbPool, mutateDb } from './db.ts';
import type { Notification, WorkOrder } from '../types.ts';
import { logEvent } from './observability.ts';

const workerId = crypto.randomUUID();
const intervalMs = Math.max(50, Number(process.env.SMART_OFFICE_JOB_INTERVAL_MS || 1000));
const leaseMs = Math.max(1000, Number(process.env.SMART_OFFICE_JOB_LEASE_MS || 30000));
let timer: NodeJS.Timeout | null = null;
let active: Promise<void> | null = null;

const notice = (id: string, userId: string, title: string, content: string, type: Notification['type']): Notification => ({
  id, userId, title, content, type, timestamp: new Date().toISOString(), isRead: false
});

const reconcileJobs = async () => mutateDb(async (db, context) => {
  let changed = false;
  for (const booking of db.bookings || []) {
    if (booking.status !== 'APPROVED') continue;
    const start = new Date(booking.startTime);
    await context.scheduleJob({ key: `reminder:${booking.id}`, type: 'BOOKING_REMINDER', runAt: new Date(start.getTime() - 15 * 60000), payload: { bookingId: booking.id } });
    if (booking.type === 'ROOM') {
      await context.scheduleJob({ key: `noshow:${booking.id}`, type: 'BOOKING_NO_SHOW', runAt: new Date(start.getTime() + 15 * 60000), payload: { bookingId: booking.id } });
    }
    const orders: WorkOrder[] = [
      ...(booking.needsTeaService ? [{ id: `wo-${booking.id}-TEA`, bookingId: booking.id, type: 'TEA' as const, title: `「${booking.purpose}」茶水服务`, assigneeRole: 'APPROVAL_ADMIN', status: 'TODO' as const, createdAt: new Date().toISOString() }] : []),
      ...(booking.isVideoConference ? [{ id: `wo-${booking.id}-VIDEO`, bookingId: booking.id, type: 'VIDEO' as const, title: `「${booking.purpose}」视频会议保障`, assigneeRole: 'SYSTEM_ADMIN', status: 'TODO' as const, createdAt: new Date().toISOString() }] : [])
    ];
    for (const order of orders) {
      if ((db.workOrders || []).some(item => item.id === order.id)) continue;
      db.workOrders = [order, ...(db.workOrders || [])];
      await context.audit({ action: 'WORK_ORDER_AUTO_CREATE', entityType: 'WORK_ORDER', entityId: order.id, details: { bookingId: booking.id, type: order.type } });
      changed = true;
    }
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

const processJob = async (job: any) => {
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
  await mutateDb(async (db, { audit }) => {
    const booking = (db.bookings || []).find(item => item.id === payload.bookingId);
    if (!booking) return false;
    const now = Date.now();
    const start = new Date(booking.startTime).getTime();
    const recipients = [...new Set([booking.userId, ...(booking.attendeeIds || [])])];
    const resource = (db.resources || []).find(item => item.id === booking.resourceId);
    const notifications: Notification[] = [];
    if (job.job_type === 'BOOKING_REMINDER') {
      if (booking.status !== 'APPROVED' || start <= now || start - now > 15 * 60000) return false;
      recipients.forEach(userId => notifications.push(notice(`reminder-${booking.id}-${userId}`, userId, '会前 15 分钟提醒', `「${booking.purpose}」将于 ${new Date(booking.startTime).toLocaleString('zh-CN')} 在 ${resource?.name || '预约空间'} 开始，请准时到场。`, 'INFO')));
    } else if (job.job_type === 'BOOKING_NO_SHOW') {
      if (booking.type !== 'ROOM' || booking.status !== 'APPROVED' || booking.checkedInAt || now < start + 15 * 60000) return false;
      db.bookings = (db.bookings || []).map(item => item.id === booking.id ? { ...item, status: 'CANCELLED' as const, noShow: true } : item);
      await audit({ action: 'BOOKING_NO_SHOW_CANCEL', entityType: 'BOOKING', entityId: booking.id, details: { previousStatus: booking.status, resourceId: booking.resourceId } });
      recipients.forEach(userId => notifications.push(notice(`noshow-${booking.id}-${userId}`, userId, '未签到，会议室已释放', `「${booking.purpose}」开始 15 分钟后仍未签到，${resource?.name || '会议室'} 已自动释放。`, 'WARNING')));
    }
    const existing = new Set((db.notifications || []).map(item => item.id));
    db.notifications = [...notifications.filter(item => !existing.has(item.id)), ...(db.notifications || [])].slice(0, 1000);
    return job.job_type === 'BOOKING_NO_SHOW';
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
  if (event.event_type !== 'IN_APP_NOTIFICATION') throw new Error(`不支持的 Outbox 类型 ${event.event_type}`);
  const item = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
  await getDbPool().query(`INSERT IGNORE INTO notifications (id, user_id, title, content, timestamp, is_read, type, link_view)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [item.id, item.userId, item.title, item.content, new Date(item.timestamp), item.isRead, item.type, item.linkView || null]);
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

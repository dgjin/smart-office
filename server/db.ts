import crypto from 'node:crypto';
import mysql, { type PoolConnection } from 'mysql2/promise';
import type { OfficeDb } from './tools.ts';
import type { Booking, Notification, Resource, User } from '../types.ts';
import { getResourceUpdateError, isLongTermSeriesWithinLimit, validateBookingResource } from '../utils/bookingRules.ts';
import { getApprovalRecipients } from '../utils/approval.ts';
import { dbConfig, REQUIRED_MIGRATION } from './config.ts';
import { enqueueOutbox, scheduleJob, type JobInstruction } from './jobStore.ts';
import type { AuditInput } from './audit.ts';

const STATE_KEYS = ['roles', 'users', 'resources', 'departments', 'workflow', 'workflowVersions', 'approvalDelegates', 'workOrders'] as const;

let pool: ReturnType<typeof mysql.createPool> | null = null;
export const getDbPool = () => {
  if (!pool) pool = mysql.createPool(dbConfig());
  return pool;
};

let schemaReady: Promise<void> | null = null;
const ensureSchemaReady = () => {
  if (!schemaReady) schemaReady = (async () => {
    const [rows] = await getDbPool().query<any[]>('SELECT version FROM schema_migrations WHERE version = ?', [REQUIRED_MIGRATION]);
    if (!rows.length) throw new DbError(`数据库未就绪，请执行迁移 ${REQUIRED_MIGRATION}`, 503);
  })().catch(err => { schemaReady = null; throw err; });
  return schemaReady;
};

export const closeDbPool = async () => {
  const current = pool;
  pool = null;
  schemaReady = null;
  if (current) await current.end();
};

const json = (value: any) => JSON.stringify(value ?? []);
const parseJson = (value: any) => typeof value === 'string' ? JSON.parse(value) : (value || []);

const readWith = async (conn: PoolConnection): Promise<OfficeDb> => {
  const db: OfficeDb = {};
  const [states] = await conn.query<any[]>(`SELECT state_key, payload FROM office_state WHERE state_key IN (${STATE_KEYS.map(() => '?').join(',')})`, [...STATE_KEYS]);
  for (const row of states) (db as any)[row.state_key] = parseJson(row.payload);
  const [bookingRows] = await conn.query<any[]>('SELECT payload FROM bookings ORDER BY created_at DESC');
  db.bookings = bookingRows.map(row => parseJson(row.payload));
  const [notificationRows] = await conn.query<any[]>('SELECT * FROM notifications ORDER BY timestamp DESC LIMIT 1000');
  db.notifications = notificationRows.map(row => ({
    id: row.id, userId: row.user_id, title: row.title, content: row.content,
    timestamp: new Date(row.timestamp).toISOString(), isRead: Boolean(row.is_read), type: row.type,
    linkView: row.link_view || undefined
  }));
  return db;
};

const writeCollections = async (conn: PoolConnection, db: OfficeDb) => {
  for (const key of STATE_KEYS) {
    if (!Array.isArray(db[key])) continue;
    await conn.query('INSERT INTO office_state (state_key, payload) VALUES (?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload)', [key, json(db[key])]);
  }
};

const writeBookings = async (conn: PoolConnection, bookings: Booking[]) => {
  for (const b of bookings) {
    if (!b?.id || !b.resourceId || !b.startTime || !b.endTime) continue;
    await conn.query(`INSERT INTO bookings (id, user_id, resource_id, start_time, end_time, status, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), resource_id=VALUES(resource_id),
      start_time=VALUES(start_time), end_time=VALUES(end_time), status=VALUES(status), payload=VALUES(payload), created_at=VALUES(created_at)`,
      [b.id, b.userId, b.resourceId, new Date(b.startTime), new Date(b.endTime), b.status, json(b), new Date(b.createdAt || Date.now())]);
  }
};

const writeNotifications = async (conn: PoolConnection, notifications: OfficeDb['notifications']) => {
  for (const n of notifications || []) {
    if (!n?.id || !n.userId) continue;
    const [result] = await conn.query<any>(`INSERT INTO notifications (id, user_id, title, content, timestamp, is_read, type, link_view)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE is_read=VALUES(is_read), link_view=VALUES(link_view)`,
      [n.id, n.userId, n.title, n.content, new Date(n.timestamp), n.isRead, n.type, n.linkView || null]);
    if (result.affectedRows === 1) await enqueueOutbox(conn, { key: `notification:${n.id}`, type: 'IN_APP_NOTIFICATION', payload: n });
  }
};

export class DbError extends Error {
  status: number;
  details: any;
  constructor(message: string, status = 400, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const validateResource = (resource: Resource) => {
  const capacity = resource?.type === 'DESK' ? resource.capacity ?? 0 : resource?.capacity;
  if (!resource?.id || !resource.name?.trim() || !['ROOM', 'DESK'].includes(resource.type)
    || !Number.isInteger(capacity) || (capacity || 0) < (resource.type === 'ROOM' ? 1 : 0)
    || !['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'PENDING'].includes(resource.status)
    || (resource.campus !== undefined && (typeof resource.campus !== 'string' || !resource.campus.trim() || resource.campus.length > 100))
    || !Array.isArray(resource.features) || resource.features.some(feature => typeof feature !== 'string')) {
    throw new DbError('INVALID_RESOURCE', 400);
  }
};

const assertBookingResource = (db: OfficeDb, booking: Booking) => {
  const resource = (db.resources || []).find(item => item.id === booking.resourceId);
  const error = validateBookingResource(resource, booking);
  if (error) throw new DbError(error, error === 'RESOURCE_NOT_FOUND' ? 404 : error === 'INVALID_TIME_RANGE' || error === 'INVALID_PARTICIPANTS' ? 400 : 409);
};

const assertResourceUpdate = (current: Resource, next: Resource, bookings: Booking[]) => {
  const impact = getResourceUpdateError(current, next, bookings);
  if (impact) throw new DbError(impact.code, 409, impact.bookings);
};

type MutationContext = {
  scheduleJob: (job: JobInstruction) => Promise<void>;
  audit: (input: AuditInput) => Promise<void>;
};
type MutateOptions<T> = { expectedRevision?: number; snapshot?: boolean | ((result: T) => boolean); replaceBookings?: boolean };

export const mutateDb = async <T>(mutator: (db: OfficeDb, context: MutationContext) => T | Promise<T>, options: MutateOptions<T> = {}): Promise<T> => {
  await ensureSchemaReady();
  const conn = await getDbPool().getConnection();
  let locked = false;
  try {
    const [lockRows] = await conn.query<any[]>("SELECT GET_LOCK('smart_office_write', 10) AS acquired");
    if (!lockRows[0]?.acquired) throw new DbError('数据库正忙，请稍后重试', 503);
    locked = true;
    await conn.beginTransaction();
    const [metaRows] = await conn.query<any[]>('SELECT revision FROM office_snapshot_meta WHERE id = 1 FOR UPDATE');
    const currentRevision = Number(metaRows[0]?.revision || 0);
    if (!currentRevision) throw new DbError('数据库快照版本未初始化', 503);
    if (options.expectedRevision !== undefined && options.expectedRevision !== currentRevision) {
      throw new DbError('STALE_SNAPSHOT', 412, { currentRevision });
    }
    const db = await readWith(conn);
    const result = await mutator(db, {
      scheduleJob: job => scheduleJob(conn, job),
      audit: input => conn.query(`INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?, ?)`, [
        crypto.randomUUID(), input.actorId || null, input.action, input.entityType, input.entityId,
        JSON.stringify(input.details || {})
      ]).then(() => undefined)
    });
    await writeCollections(conn, db);
    if (options.replaceBookings) await conn.query('DELETE FROM bookings');
    await writeBookings(conn, db.bookings || []);
    await writeNotifications(conn, db.notifications);
    const advanceSnapshot = typeof options.snapshot === 'function' ? options.snapshot(result) : options.snapshot !== false;
    if (advanceSnapshot) await conn.query('UPDATE office_snapshot_meta SET revision = revision + 1 WHERE id = 1');
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK('smart_office_write')").catch(() => {});
    conn.release();
  }
};

export const readSnapshot = async (): Promise<{ db: OfficeDb; revision: number }> => {
  await ensureSchemaReady();
  const conn = await getDbPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<any[]>('SELECT revision FROM office_snapshot_meta WHERE id = 1');
    const db = await readWith(conn);
    await conn.commit();
    return { db, revision: Number(rows[0]?.revision || 0) };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

export const readDb = async (): Promise<OfficeDb> => (await readSnapshot()).db;

export const saveResource = async (incoming: Resource, actorId: string, editingId?: string) => mutateDb(async (db, { audit }) => {
  validateResource(incoming);
  const resources = db.resources || [];
  const current = editingId ? resources.find(resource => resource.id === editingId) : undefined;
  if (editingId && !current) throw new DbError('RESOURCE_NOT_FOUND', 404);
  if (!editingId && resources.some(item => item.id === incoming.id)) throw new DbError('DUPLICATE_RESOURCE_ID', 409);
  const resource = { ...incoming, id: editingId || incoming.id };
  if (resources.some(item => item.id !== resource.id && item.name === resource.name)) throw new DbError('DUPLICATE_RESOURCE_NAME', 409);
  if (current) assertResourceUpdate(current, resource, db.bookings || []);
  db.resources = editingId ? resources.map(item => item.id === editingId ? resource : item) : [...resources, resource];
  await audit({ actorId, action: editingId ? 'RESOURCE_UPDATE' : 'RESOURCE_CREATE', entityType: 'RESOURCE', entityId: resource.id });
  return resource;
});

export const saveBookings = async (incoming: Booking[], actor: User, editingId?: string) => mutateDb(async (db, { audit }) => {
  const existing = db.bookings || [];
  const editing = editingId ? existing.find(booking => booking.id === editingId) : undefined;
  if (editingId && !editing) throw new DbError('BOOKING_NOT_FOUND', 404);
  if (editing && editing.userId !== actor.id && !actor.role.includes('SYSTEM_ADMIN')) throw new DbError('FORBIDDEN', 403);
  if (editing && editing.status !== 'PENDING') throw new DbError('BOOKING_NOT_EDITABLE', 409);
  const versions = db.workflowVersions || [];
  const currentVersion = [...versions].sort((a, b) => b.version - a.version)[0] || {
    version: 1, nodes: db.workflow || [], createdAt: new Date().toISOString(), createdBy: 'system'
  };
  if (!versions.length) db.workflowVersions = [currentVersion];
  const status = currentVersion.nodes.length ? 'PENDING' as const : 'APPROVED' as const;
  const requester = editing ? (db.users || []).find(user => user.id === editing.userId) : actor;
  const prepared = incoming.map((booking, index) => {
    const resource = (db.resources || []).find(item => item.id === booking.resourceId);
    return {
      ...booking,
      id: editingId || booking.id || `bk-${crypto.randomUUID()}`,
      userId: editing?.userId || actor.id,
      type: resource?.type || booking.type,
      status,
      createdAt: editing?.createdAt || new Date().toISOString(),
      currentNodeIndex: 0,
      approvalHistory: [],
      workflowVersion: currentVersion.version,
      approvalWorkflow: structuredClone(currentVersion.nodes),
      requesterDepartmentId: (db.departments || []).find(department => department.name === requester?.department)?.id,
      resourceCampus: resource?.campus,
      checkedInAt: undefined,
      endedEarlyAt: undefined,
      noShow: false,
      recurrenceIndex: booking.recurrenceIndex ?? index
    } as Booking;
  });
  const longTerm = prepared.filter(booking => booking.seriesKind === 'LONG_TERM');
  if (longTerm.length) {
    if (longTerm.length !== prepared.length || new Set(longTerm.map(booking => booking.seriesId)).size !== 1 || !longTerm[0].seriesId) {
      throw new DbError('INVALID_LONG_TERM_SERIES', 400);
    }
    if (!isLongTermSeriesWithinLimit(longTerm)) throw new DbError('LONG_TERM_LIMIT_EXCEEDED', 400);
    const renewalOfSeriesId = longTerm[0].renewalOfSeriesId;
    if (longTerm.some(booking => booking.renewalOfSeriesId !== renewalOfSeriesId)) throw new DbError('INVALID_RENEWAL', 400);
    if (renewalOfSeriesId) {
      const previous = existing.filter(booking => booking.seriesId === renewalOfSeriesId && booking.seriesKind === 'LONG_TERM');
      if (!previous.length || previous.some(booking => booking.resourceId !== longTerm[0].resourceId || booking.userId !== longTerm[0].userId)) {
        throw new DbError('INVALID_RENEWAL', 400);
      }
      if (existing.some(booking => booking.renewalOfSeriesId === renewalOfSeriesId && (booking.status === 'PENDING' || booking.status === 'APPROVED'))) {
        throw new DbError('RENEWAL_EXISTS', 409);
      }
      const previousLastStart = Math.max(...previous.map(booking => new Date(booking.startTime).getTime()));
      if (Math.min(...longTerm.map(booking => new Date(booking.startTime).getTime())) <= previousLastStart) {
        throw new DbError('INVALID_RENEWAL_START', 400);
      }
    }
  }
  const accepted: Booking[] = [];
  const conflicts: any[] = [];
  prepared.forEach((booking, index) => {
    assertBookingResource(db, booking);
    const start = new Date(booking.startTime);
    const end = new Date(booking.endTime);
    const overlapping = [...existing, ...accepted].filter(item => item.id !== (editingId || booking.id)
      && item.resourceId === booking.resourceId && (item.status === 'APPROVED' || item.status === 'PENDING')
      && start < new Date(item.endTime) && end > new Date(item.startTime));
    if (overlapping.length) conflicts.push({ index, conflicts: overlapping });
    else accepted.push(booking);
  });
  if (conflicts.length) throw new DbError('CONFLICT', 409, conflicts);
  if (editingId) db.bookings = existing.map(booking => booking.id === editingId ? accepted[0] : booking);
  else db.bookings = [...accepted, ...existing];

  const createdAt = new Date().toISOString();
  const notice = (userId: string, title: string, content: string): Notification => ({
    id: crypto.randomUUID(), userId, title, content, timestamp: createdAt, isRead: false, type: 'INFO'
  });
  const first = accepted[0];
  const purpose = first.purpose;
  const notifications: Notification[] = [notice(actor.id, editingId ? '预约已修改' : '预约申请已提交',
    editingId ? `「${purpose}」已更新并重新进入审批流程。` : `已提交 ${accepted.length} 次「${purpose}」预约。`)];
  const attendeeIds = [...new Set(accepted.flatMap(booking => booking.attendeeIds || []))].filter(id => id !== actor.id);
  attendeeIds.forEach(userId => notifications.push(notice(userId, '会议邀请', `${actor.name} 邀请您参加「${purpose}」。`)));
  const approvalContext = {
    users: db.users || [], resources: db.resources || [], departments: db.departments || [],
    delegates: db.approvalDelegates || []
  };
  getApprovalRecipients(first, db.workflow || [], approvalContext).forEach(user => {
    notifications.push(notice(user.id, '新预约待审批', `${actor.name} 提交了「${purpose}」，请处理审批。`));
  });
  if (status === 'APPROVED') {
    const existingOrderIds = new Set((db.workOrders || []).map(order => order.id));
    const orders = accepted.flatMap(booking => [
      ...(booking.needsTeaService ? [{ id: `wo-${booking.id}-TEA`, bookingId: booking.id, type: 'TEA' as const, title: `「${booking.purpose}」茶水服务`, assigneeRole: 'APPROVAL_ADMIN', status: 'TODO' as const, createdAt }] : []),
      ...(booking.isVideoConference ? [{ id: `wo-${booking.id}-VIDEO`, bookingId: booking.id, type: 'VIDEO' as const, title: `「${booking.purpose}」视频会议保障`, assigneeRole: 'SYSTEM_ADMIN', status: 'TODO' as const, createdAt }] : [])
    ]).filter(order => !existingOrderIds.has(order.id));
    db.workOrders = [...orders, ...(db.workOrders || [])];
    orders.forEach(order => (db.users || []).filter(user => user.role.includes(order.assigneeRole)).forEach(user => {
      notifications.push(notice(user.id, '新服务工单待处理', order.title));
    }));
  }
  db.notifications = [...notifications, ...(db.notifications || [])].slice(0, 1000);
  for (const booking of accepted) {
    await audit({
      actorId: actor.id, action: editingId ? 'BOOKING_UPDATE' : 'BOOKING_CREATE', entityType: 'BOOKING', entityId: booking.id,
      details: { status: booking.status, workflowVersion: booking.workflowVersion, seriesId: booking.seriesId }
    });
  }
  return accepted;
});

export const databaseHealth = async () => {
  await ensureSchemaReady();
  await getDbPool().query('SELECT 1');
  return { ok: true };
};

import crypto from 'node:crypto';
import mysql, { type PoolConnection } from 'mysql2/promise';
import type { OfficeDb } from './tools.ts';
import type { Booking, BookingRuleSettings, Notification, Resource, User } from '../types.ts';
import { getResourceUpdateError, isLongTermSeriesWithinLimit } from '../utils/bookingRules.ts';
import { BookingRuleError, validateBookingBatch } from './bookingService.ts';
import { BUILDING_FLOORS, BUILDING_NAMES, getCurrentRuleSettings, getRoomCategory, parseResourceBuilding, parseResourceFloor } from '../utils/resourceDomain.ts';
import { getApprovalRecipients } from '../utils/approval.ts';
import { ensureApprovalPolicy, resolveApprovalPolicy } from '../utils/approvalPolicy.ts';
import { addApprovalWorkingMinutes } from '../utils/approvalSchedule.ts';
import { assertConfidentialOperation, assertConfidentialWhitelist, bookingNoticePurpose, isConfidentialBooking, rebuildConfidentialAccessGrants } from './confidentiality.ts';
import { dbConfig, REQUIRED_MIGRATION } from './config.ts';
import { enqueueOutbox, scheduleJob, type JobInstruction } from './jobStore.ts';
import { externalNotificationEvents } from './externalMessages.ts';
import type { AuditInput } from './audit.ts';
import { DbError } from './errors.ts';
import { assertCancellationAuthorized, createBookingWorkOrders, ensureServiceDomain, syncWorkOrdersForBookingChange } from './serviceDomain.ts';
import { syncIntegrationChanges } from './integrationDomain.ts';
import { publishMonitoringChange } from './monitoringEvents.ts';

export { DbError } from './errors.ts';

const STATE_KEYS = [
  'roles', 'users', 'resources', 'departments', 'workflow', 'workflowVersions', 'approvalRuleSetVersions',
  'approvalDelegates', 'workOrders', 'ruleVersions', 'resourceImportBatches', 'confidentialWhitelist',
  'confidentialityAuthorizations', 'confidentialAccessGrants', 'serviceCatalog', 'serviceAreas', 'serviceShifts',
  'serviceInspections', 'checkInEvents', 'usageFacts', 'usageAppeals', 'devices', 'exceptionActions',
  'organizationSyncBatches', 'externalCallbacks', 'externalCompensations', 'accessAuthorizationFacts', 'integrationDeliveries'
] as const;

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

const writeCollections = async (conn: PoolConnection, db: OfficeDb, previous: Map<string, string>) => {
  for (const key of STATE_KEYS) {
    if (!Array.isArray(db[key])) continue;
    const payload = json(db[key]);
    if (previous.get(key) === payload) continue;
    await conn.query('INSERT INTO office_state (state_key, payload) VALUES (?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload)', [key, payload]);
  }
};

const writeBookings = async (conn: PoolConnection, bookings: Booking[], previous?: Booking[]) => {
  const previousById = previous ? new Map(previous.map(booking => [booking.id, json(booking)])) : undefined;
  for (const b of bookings) {
    if (!b?.id || !b.resourceId || !b.startTime || !b.endTime) continue;
    if (previousById?.get(b.id) === json(b)) continue;
    await conn.query(`INSERT INTO bookings (id, user_id, resource_id, start_time, end_time, status, rule_version, workflow_version, approval_rule_set_version, approval_rule_id, approval_submitted_at, schedule_version, actual_start_time, actual_end_time, released_at, release_reason, release_type, access_revoked_at, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), resource_id=VALUES(resource_id),
      start_time=VALUES(start_time), end_time=VALUES(end_time), status=VALUES(status), rule_version=VALUES(rule_version), workflow_version=VALUES(workflow_version),
      approval_rule_set_version=VALUES(approval_rule_set_version), approval_rule_id=VALUES(approval_rule_id), approval_submitted_at=VALUES(approval_submitted_at),
      schedule_version=VALUES(schedule_version), actual_start_time=VALUES(actual_start_time), actual_end_time=VALUES(actual_end_time), released_at=VALUES(released_at),
      release_reason=VALUES(release_reason), release_type=VALUES(release_type), access_revoked_at=VALUES(access_revoked_at), payload=VALUES(payload), created_at=VALUES(created_at)`,
      [b.id, b.userId, b.resourceId, new Date(b.startTime), new Date(b.endTime), b.status, b.ruleVersion ?? null, b.workflowVersion ?? null,
        b.approvalRuleSetVersion ?? null, b.approvalRuleId ?? null, b.approvalSubmittedAt ? new Date(b.approvalSubmittedAt) : null, b.scheduleVersion ?? null,
        b.actualStartTime ? new Date(b.actualStartTime) : null, b.actualEndTime ? new Date(b.actualEndTime) : null, b.releasedAt ? new Date(b.releasedAt) : null,
        b.releaseReason ?? null, b.releaseType ?? null, b.accessRevokedAt ? new Date(b.accessRevokedAt) : null, json(b), new Date(b.createdAt || Date.now())]);
  }
};

const writeNotifications = async (conn: PoolConnection, notifications: OfficeDb['notifications'], users: User[], previous: Notification[]) => {
  const previousById = new Map(previous.map(notification => [notification.id, json(notification)]));
  for (const n of notifications || []) {
    if (!n?.id || !n.userId || previousById.get(n.id) === json(n)) continue;
    const [result] = await conn.query<any>(`INSERT INTO notifications (id, user_id, title, content, timestamp, is_read, type, link_view)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE is_read=VALUES(is_read), link_view=VALUES(link_view)`,
      [n.id, n.userId, n.title, n.content, new Date(n.timestamp), n.isRead, n.type, n.linkView || null]);
    if (result.affectedRows !== 1) continue;
    await enqueueOutbox(conn, { key: `notification:${n.id}`, type: 'IN_APP_NOTIFICATION', payload: n });
    for (const event of externalNotificationEvents(n, users)) await enqueueOutbox(conn, event);
  }
};

const resourceText = (value: unknown, field: string, max = 200, required = true) => {
  if (value === undefined || value === null || value === '') {
    if (!required) return undefined;
    throw new DbError(`INVALID_RESOURCE_${field}`, 400);
  }
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new DbError(`INVALID_RESOURCE_${field}`, 400);
  return value.trim();
};

export const normalizeResource = (input: any, editingId?: string, settings?: BookingRuleSettings): Resource => {
  if (!input || !['ROOM', 'DESK'].includes(input.type)) throw new DbError('INVALID_RESOURCE_TYPE', 400);
  const id = resourceText(editingId || input.id, 'ID', 128) as string;
  const code = (resourceText(input.code || id, 'CODE', 64) as string).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(code)) throw new DbError('INVALID_RESOURCE_CODE', 400);
  const type = input.type as Resource['type'];
  const capacity = type === 'DESK' ? input.capacity ?? 0 : input.capacity;
  if (!Number.isInteger(capacity) || capacity < (type === 'ROOM' ? 1 : 0) || capacity > 100000) {
    throw new DbError('INVALID_RESOURCE_CAPACITY', 400);
  }
  if (!['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'PENDING'].includes(input.status)) throw new DbError('INVALID_RESOURCE_STATUS', 400);
  if (!Array.isArray(input.features) || input.features.length > 30 || input.features.some((feature: any) => typeof feature !== 'string' || !feature.trim() || feature.trim().length > 50)) {
    throw new DbError('INVALID_RESOURCE_FEATURES', 400);
  }
  const rawLocation = resourceText(input.location, 'LOCATION', 200, false);
  let building = input.building;
  if (building !== undefined && !['MAIN', 'ANNEX'].includes(building)) throw new DbError('INVALID_RESOURCE_BUILDING', 400);
  if (type === 'ROOM' && !building && rawLocation && /(?:1|一|2|二)\s*号楼|主楼|配楼/i.test(rawLocation)) building = parseResourceBuilding(rawLocation);
  if (type === 'DESK') building = undefined;
  let floor = type === 'ROOM' ? input.floor : undefined;
  if (floor === undefined && building && rawLocation) floor = parseResourceFloor(rawLocation, BUILDING_FLOORS[building as keyof typeof BUILDING_FLOORS]) ?? undefined;
  if (floor !== undefined && (!Number.isInteger(floor) || !building || floor < 1 || floor > BUILDING_FLOORS[building as keyof typeof BUILDING_FLOORS])) {
    throw new DbError('INVALID_RESOURCE_FLOOR', 400);
  }
  const roomNumber = type === 'ROOM' ? resourceText(input.roomNumber, 'ROOM_NUMBER', 50, false) : undefined;
  const location = rawLocation || (building && floor ? `${BUILDING_NAMES[building as keyof typeof BUILDING_NAMES]} ${floor}层${roomNumber ? ` · ${roomNumber}` : ''}` : '');
  if (!location) throw new DbError('INVALID_RESOURCE_LOCATION', 400);
  if (input.isExclusive !== undefined && typeof input.isExclusive !== 'boolean') throw new DbError('INVALID_RESOURCE_EXCLUSIVE', 400);
  const isExclusive = type === 'ROOM' && input.isExclusive === true;
  const exclusiveLeaderLevel = isExclusive ? resourceText(input.exclusiveLeaderLevel, 'LEADER_LEVEL', 100) : undefined;
  if (input.isPublic !== undefined && typeof input.isPublic !== 'boolean') throw new DbError('INVALID_RESOURCE_PUBLIC', 400);
  const openStart = resourceText(input.openStart, 'OPEN_START', 5, false);
  const openEnd = resourceText(input.openEnd, 'OPEN_END', 5, false);
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  if ((openStart && !openEnd) || (!openStart && openEnd) || (openStart && (!timePattern.test(openStart) || !timePattern.test(openEnd || '') || openStart >= openEnd!))) {
    throw new DbError('INVALID_RESOURCE_OPEN_HOURS', 400);
  }
  return {
    id,
    code,
    name: resourceText(input.name, 'NAME') as string,
    type,
    capacity,
    location,
    building,
    floor,
    roomNumber,
    roomCategory: type === 'ROOM' ? getRoomCategory(capacity, input.roomCategory === 'AUDITORIUM', settings) : undefined,
    campus: resourceText(input.campus, 'CAMPUS', 100, false),
    features: [...new Set((input.features as string[]).map(feature => feature.trim()))],
    status: input.status,
    isExclusive,
    exclusiveLeaderLevel,
    openStart,
    openEnd,
    isPublic: input.isPublic ?? !isExclusive,
    notes: resourceText(input.notes, 'NOTES', 500, false)
  };
};

export const validateResource = (resource: Resource) => {
  normalizeResource(resource);
};

const assertResourceUpdate = (current: Resource, next: Resource, bookings: Booking[]) => {
  const impact = getResourceUpdateError(current, next, bookings);
  if (impact) throw new DbError(impact.code, 409, impact.bookings);
};

export type MutationContext = {
  revision: number;
  connection: PoolConnection;
  scheduleJob: (job: JobInstruction) => Promise<void>;
  enqueueOutbox: (event: { key: string; type: string; payload: unknown }) => Promise<void>;
  audit: (input: AuditInput) => Promise<void>;
  revokeUserSessions: (userIds: string[]) => Promise<void>;
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
    const previousBookings = structuredClone(db.bookings || []);
    const previousUsers = structuredClone(db.users || []);
    const previousNotifications = structuredClone(db.notifications || []);
    const previousCollections = new Map(STATE_KEYS
      .filter(key => Array.isArray(db[key]))
      .map(key => [key, json(db[key])] as const));
    const result = await mutator(db, {
      revision: currentRevision,
      connection: conn,
      scheduleJob: job => scheduleJob(conn, job),
      enqueueOutbox: event => enqueueOutbox(conn, event),
      audit: input => conn.query(`INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?, ?)`, [
        crypto.randomUUID(), input.actorId || null, input.action, input.entityType, input.entityId,
        JSON.stringify(input.details || {})
      ]).then(() => undefined),
      revokeUserSessions: async userIds => {
        if (userIds.length) await conn.query(`UPDATE sessions SET revoked_at = NOW(3)
          WHERE user_id IN (${userIds.map(() => '?').join(',')}) AND revoked_at IS NULL`, userIds);
      }
    });
    await syncIntegrationChanges(db, previousBookings, previousUsers, event => enqueueOutbox(conn, event));
    await writeCollections(conn, db, previousCollections);
    if (options.replaceBookings) await conn.query('DELETE FROM bookings');
    await writeBookings(conn, db.bookings || [], options.replaceBookings ? undefined : previousBookings);
    await writeNotifications(conn, db.notifications, db.users || [], previousNotifications);
    const advanceSnapshot = typeof options.snapshot === 'function' ? options.snapshot(result) : options.snapshot !== false;
    if (advanceSnapshot) await conn.query('UPDATE office_snapshot_meta SET revision = revision + 1 WHERE id = 1');
    await conn.commit();
    publishMonitoringChange('workspace');
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
  const resources = db.resources || [];
  const current = editingId ? resources.find(resource => resource.id === editingId) : undefined;
  if (editingId && !current) throw new DbError('RESOURCE_NOT_FOUND', 404);
  const resource = normalizeResource({ ...current, ...incoming, id: editingId || incoming.id }, editingId, getCurrentRuleSettings(db.ruleVersions));
  if (!editingId && resources.some(item => item.id === resource.id)) throw new DbError('DUPLICATE_RESOURCE_ID', 409);
  const currentCode = current?.code || current?.id.toUpperCase();
  if (currentCode && resource.code !== currentCode) throw new DbError('RESOURCE_CODE_IMMUTABLE', 409);
  if (resources.some(item => item.id !== resource.id && (item.code || item.id.toUpperCase()) === resource.code)) throw new DbError('DUPLICATE_RESOURCE_CODE', 409);
  if (resources.some(item => item.id !== resource.id && item.name === resource.name)) throw new DbError('DUPLICATE_RESOURCE_NAME', 409);
  if (current) assertResourceUpdate(current, resource, db.bookings || []);
  db.resources = editingId ? resources.map(item => item.id === editingId ? resource : item) : [...resources, resource];
  await audit({ actorId, action: editingId ? 'RESOURCE_UPDATE' : 'RESOURCE_CREATE', entityType: 'RESOURCE', entityId: resource.id, details: { before: current || null, after: resource } });
  return resource;
});

export const deleteResource = async (id: string, actorId: string) => mutateDb(async (db, { audit, connection }) => {
  const resource = (db.resources || []).find(item => item.id === id);
  if (!resource) throw new DbError('RESOURCE_NOT_FOUND', 404);
  if ((db.bookings || []).some(booking => booking.resourceId === id)) throw new DbError('RESOURCE_HAS_BOOKINGS', 409);
  if ((db.devices || []).some(device => device.resourceId === id)) throw new DbError('RESOURCE_HAS_DEVICES', 409);
  db.resources = (db.resources || []).filter(item => item.id !== id);
  db.serviceAreas = (db.serviceAreas || []).map(area => ({ ...area, resourceIds: area.resourceIds.filter(resourceId => resourceId !== id) }));
  await connection.query('DELETE FROM hq3d_room_resource WHERE resource_id = ?', [id]);
  await audit({
    actorId,
    action: 'RESOURCE_DELETE',
    entityType: 'RESOURCE',
    entityId: id,
    details: { before: resource, after: null }
  });
  return { ok: true };
});

export const saveBookings = async (incoming: Booking[], actor: User, editingId?: string) => mutateDb(async (db, { audit, scheduleJob }) => {
  const existing = db.bookings || [];
  const editing = editingId ? existing.find(booking => booking.id === editingId) : undefined;
  if (editingId && !editing) throw new DbError('BOOKING_NOT_FOUND', 404);
  if (editing && editing.userId !== actor.id && !actor.role.includes('SYSTEM_ADMIN')) throw new DbError('FORBIDDEN', 403);
  if (editing && !['PENDING', 'APPROVED'].includes(editing.status)) throw new DbError('BOOKING_NOT_EDITABLE', 409);
  if (editing) assertConfidentialOperation(db, editing, actor);
  ensureApprovalPolicy(db);
  ensureServiceDomain(db);
  const settings = getCurrentRuleSettings(db.ruleVersions);
  if (editing) assertCancellationAuthorized(editing, (db.resources || []).find(resource => resource.id === editing.resourceId), settings, actor);
  const ruleVersion = [...(db.ruleVersions || [])].sort((a, b) => b.version - a.version)[0]?.version || 1;
  const requester = editing ? (db.users || []).find(user => user.id === editing.userId) : actor;
  if (!requester) throw new DbError('REQUESTER_NOT_FOUND', 404);
  const prepared = incoming.map((booking, index) => {
    const resource = (db.resources || []).find(item => item.id === booking.resourceId);
    const candidate = {
      ...booking,
      id: editingId || booking.id || `bk-${crypto.randomUUID()}`,
      userId: editing?.userId || actor.id,
      type: resource?.type || booking.type,
      createdAt: editing?.createdAt || new Date().toISOString(),
      currentNodeIndex: 0,
      approvalHistory: [],
      approvalSubmittedAt: new Date().toISOString(),
      requesterDepartmentId: (db.departments || []).find(department => department.name === requester?.department)?.id,
      resourceCampus: resource?.campus,
      checkedInAt: undefined,
      checkInEventId: undefined,
      checkInSource: undefined,
      checkInOperatorId: undefined,
      actualStartTime: undefined,
      actualEndTime: undefined,
      releasedAt: undefined,
      releaseReason: undefined,
      releaseType: undefined,
      accessRevokedAt: undefined,
      cancellationReason: undefined,
      cancelledBy: undefined,
      endedEarlyAt: undefined,
      noShow: false,
      scheduleVersion: editing ? (editing.scheduleVersion || 1) + 1 : booking.scheduleVersion || 1,
      approvalClosedAt: undefined,
      approvalCloseReason: undefined,
      recurrenceIndex: booking.recurrenceIndex ?? index
    } as Booking;
    const policy = resolveApprovalPolicy(db, candidate, resource);
    return {
      ...candidate,
      status: policy.nodes.length ? 'PENDING' as const : 'APPROVED' as const,
      approvalHistory: policy.nodes.length ? [] : [{
        nodeName: '系统自动核准', approverName: '预约规则引擎', approverId: 'system', status: 'APPROVED' as const,
        comment: policy.explanation.join('；'), timestamp: candidate.approvalSubmittedAt!
      }],
      workflowVersion: policy.workflowVersion,
      approvalWorkflow: policy.nodes,
      approvalRuleSetVersion: policy.ruleSetVersion,
      approvalRuleId: policy.ruleId,
      approvalRuleExplanation: policy.explanation
    };
  });
  const longTerm = prepared.filter(booking => booking.seriesKind === 'LONG_TERM');
  if (longTerm.length) {
    if (longTerm.length !== prepared.length || new Set(longTerm.map(booking => booking.seriesId)).size !== 1 || !longTerm[0].seriesId) {
      throw new DbError('INVALID_LONG_TERM_SERIES', 400);
    }
    if (!isLongTermSeriesWithinLimit(longTerm, settings.longTermMaxCalendarMonths)) throw new DbError('LONG_TERM_LIMIT_EXCEEDED', 400);
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
  const securityAuthorizations: Array<{ id: string; authorizedBy: string; action: string }> = [];
  if (editing) {
    const candidate = prepared[0];
    const declassify = isConfidentialBooking(editing) && !isConfidentialBooking(candidate);
    const attendeeChange = isConfidentialBooking(editing)
      && JSON.stringify([...(editing.attendeeIds || [])].sort()) !== JSON.stringify([...(candidate.attendeeIds || [])].sort());
    const required = [
      ...(declassify ? [{ action: 'DECLASSIFY', count: 2 }] : []),
      ...(attendeeChange ? [{ action: 'ATTENDEE_CHANGE', count: 1 }] : [])
    ];
    const ids = [...new Set(candidate.securityAuthorizationIds || [])];
    if (required.reduce((sum, item) => sum + item.count, 0) !== ids.length) {
      throw new DbError(declassify ? 'CONFIDENTIAL_DECLASSIFY_DUAL_AUTHORIZATION_REQUIRED' : 'CONFIDENTIAL_ATTENDEE_AUTHORIZATION_REQUIRED', 403);
    }
    const grants = (db.confidentialityAuthorizations || []).filter(item => ids.includes(item.id) && item.bookingId === editing.id && !item.usedAt);
    for (const requirement of required) {
      const matched = grants.filter(item => item.action === requirement.action);
      if (matched.length !== requirement.count || new Set(matched.map(item => item.authorizedBy)).size !== requirement.count) {
        throw new DbError('INVALID_CONFIDENTIALITY_AUTHORIZATION', 403);
      }
      matched.forEach(item => securityAuthorizations.push(item));
    }
    if (securityAuthorizations.length !== ids.length || securityAuthorizations.some(item => {
      const authorizer = (db.users || []).find(user => user.id === item.authorizedBy);
      return !authorizer || (!authorizer.role.includes('SECURITY_ADMIN') && !authorizer.role.includes('SYSTEM_ADMIN'));
    })) throw new DbError('INVALID_CONFIDENTIALITY_AUTHORIZATION', 403);
  }
  let accepted: Booking[];
  try {
    accepted = validateBookingBatch({ db, incoming: prepared, requester, settings, ruleVersion, editingId });
  } catch (error) {
    if (error instanceof BookingRuleError) throw new DbError(error.code, error.status, error.details);
    throw error;
  }
  accepted.forEach(booking => assertConfidentialWhitelist(db, booking));
  const securityAuthorizationIds = new Set(securityAuthorizations.map(item => item.id));
  if (securityAuthorizationIds.size) {
    const usedAt = new Date().toISOString();
    db.confidentialityAuthorizations = (db.confidentialityAuthorizations || []).map(item =>
      securityAuthorizationIds.has(item.id) ? { ...item, usedAt } : item);
  }
  if (editing) syncWorkOrdersForBookingChange(db, editing, '预约已修改并重新提交审批', actor.id);
  if (editingId) db.bookings = existing.map(booking => booking.id === editingId ? accepted[0] : booking);
  else db.bookings = [...accepted, ...existing];
  rebuildConfidentialAccessGrants(db, accepted, actor.id);
  const autoApproved = accepted.every(booking => booking.status === 'APPROVED');
  for (const booking of accepted) {
    if (booking.status !== 'PENDING') continue;
    const submittedAt = new Date(booking.approvalSubmittedAt || booking.createdAt);
    const submissionToken = String(submittedAt.getTime());
    await scheduleJob({ key: `approval-reminder:${booking.id}:${submissionToken}:0`, type: 'APPROVAL_REMINDER', runAt: addApprovalWorkingMinutes(submittedAt, settings.approvalReminderAfterMinutes, settings), payload: { bookingId: booking.id, nodeIndex: 0, submittedAt: submittedAt.toISOString() } });
    await scheduleJob({ key: `approval-escalation:${booking.id}:${submissionToken}:0`, type: 'APPROVAL_ESCALATION', runAt: addApprovalWorkingMinutes(submittedAt, settings.approvalEscalationAfterMinutes, settings), payload: { bookingId: booking.id, nodeIndex: 0, submittedAt: submittedAt.toISOString() } });
    await scheduleJob({ key: `approval-close:${booking.id}:${submissionToken}`, type: 'APPROVAL_CLOSE', runAt: new Date(new Date(booking.startTime).getTime() - settings.unapprovedCloseBeforeStartMinutes * 60000), payload: { bookingId: booking.id, submittedAt: submittedAt.toISOString() } });
  }

  const createdAt = new Date().toISOString();
  const notice = (userId: string, title: string, content: string): Notification => ({
    id: crypto.randomUUID(), userId, title, content, timestamp: createdAt, isRead: false, type: 'INFO'
  });
  const first = accepted[0];
  const confidential = isConfidentialBooking(first);
  const purpose = bookingNoticePurpose(first);
  const notifications: Notification[] = [notice(actor.id, autoApproved ? '预约已自动核准' : editingId ? '预约已修改' : '预约申请已提交',
    autoApproved ? `${accepted.length} 次${purpose}预约已通过全部规则校验并自动核准。` : editingId ? `${purpose}已更新并重新进入审批流程。` : `已提交 ${accepted.length} 次${purpose}预约。`)];
  const attendeeIds = [...new Set(accepted.flatMap(booking => booking.attendeeIds || []))].filter(id => id !== actor.id);
  attendeeIds.forEach(userId => notifications.push(notice(userId, autoApproved ? '受邀会议已核准' : '会议邀请',
    confidential ? '您有一项涉密会议邀请，请在授权工作区查看。' : autoApproved ? `${purpose}已核准，请按时参加。` : `${actor.name} 邀请您参加${purpose}。`)));
  const approvalContext = {
    users: db.users || [], resources: db.resources || [], departments: db.departments || [],
    delegates: db.approvalDelegates || []
  };
  getApprovalRecipients(first, db.workflow || [], approvalContext).forEach(user => {
    notifications.push(notice(user.id, '新预约待审批', confidential ? '一项涉密会议申请已进入您的审批节点，请在授权工作区处理。' : `${actor.name} 提交了${purpose}，请处理审批。`));
  });
  for (const booking of accepted.filter(item => item.status === 'APPROVED')) {
    const orders = await createBookingWorkOrders(db, booking, { audit, scheduleJob });
    orders.forEach(order => (db.users || []).filter(user => user.role.includes(order.assigneeRole)).forEach(user => {
      notifications.push(notice(user.id, '新服务工单待处理', order.title));
    }));
  }
  db.notifications = [...notifications, ...(db.notifications || [])].slice(0, 1000);
  for (const booking of accepted) {
    await audit({
      actorId: actor.id, action: editingId ? 'BOOKING_UPDATE' : 'BOOKING_CREATE', entityType: 'BOOKING', entityId: booking.id,
      details: { status: booking.status, workflowVersion: booking.workflowVersion, approvalRuleSetVersion: booking.approvalRuleSetVersion, approvalRuleId: booking.approvalRuleId, ruleVersion: booking.ruleVersion, meetingType: booking.meetingType, seriesId: booking.seriesId }
    });
    if (booking.status === 'APPROVED' && !booking.approvalRuleId) await audit({
      actorId: actor.id, action: 'BOOKING_AUTO_APPROVE', entityType: 'BOOKING', entityId: booking.id,
      details: {
        status: booking.status, ruleVersion: booking.ruleVersion, approvalRuleSetVersion: booking.approvalRuleSetVersion,
        workflowVersion: booking.workflowVersion, checks: ['RESOURCE', 'CONFLICT', 'QUOTA', 'CONFIDENTIALITY', 'CONSISTENCY']
      }
    });
    if (securityAuthorizations.length) await audit({
      actorId: actor.id, action: 'CONFIDENTIALITY_CHANGE_AUTHORIZED', entityType: 'BOOKING', entityId: booking.id,
      details: { authorizationIds: securityAuthorizations.map(item => item.id), actions: securityAuthorizations.map(item => item.action), meetingType: booking.meetingType, confidentialityChoice: booking.confidentialityChoice }
    });
    if (booking.exclusiveAccessType) await audit({
      actorId: actor.id,
      action: 'EXCLUSIVE_ACCESS_REQUEST',
      entityType: 'BOOKING',
      entityId: booking.id,
      details: { resourceId: booking.resourceId, accessType: booking.exclusiveAccessType, reason: booking.exclusiveRequestReason, startTime: booking.startTime }
    });
  }
  return accepted;
});

export const databaseHealth = async () => {
  await ensureSchemaReady();
  await getDbPool().query('SELECT 1');
  return { ok: true };
};

import crypto from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import type { Booking, Notification } from '../types.ts';
import { bookingNoticePurpose } from './confidentiality.ts';
import { mutateDb, type MutationContext } from './db.ts';
import { DbError } from './errors.ts';
import type { OfficeDb } from './tools.ts';
import { releaseBooking } from './usageDomain.ts';

export type Hq3dDecisionBasis = 'EXPLICIT' | 'SAFE_DEFAULT';
export type Hq3dDisposition = 'DISPLAY_ONLY' | 'BOOKABLE_CANDIDATE';

export type Hq3dSyncPlan = {
  planId: string;
  authorization: {
    mode: string;
    requestedBy: string;
    requestedAt: string;
    note: string;
  };
  mappings: Array<{
    resourceId: string;
    roomUid: string;
    decisionRef: string;
    decisionBasis: Hq3dDecisionBasis;
    note?: string;
  }>;
  deferredResourceIds: string[];
  dispositions: Array<{
    roomUid: string;
    disposition: Hq3dDisposition;
    decisionBasis: Hq3dDecisionBasis;
    note?: string;
  }>;
  retireResources: Array<{
    resourceId: string;
    expectedBookingCount: number;
    expectedActiveBookingCount: number;
    reason: string;
  }>;
  alreadyAbsentResourceIds: string[];
  pendingResourceIds: string[];
};

export type Hq3dSyncResult = {
  planId: string;
  mappingsWritten: number;
  mappingsUnchanged: number;
  dispositionsWritten: number;
  dispositionsUnchanged: number;
  retiredResourceIds: string[];
  alreadyRetiredResourceIds: string[];
  cancelledBookingIds: string[];
  deferredResourceCount: number;
  pendingResourceCount: number;
};

const text = (value: unknown, field: string, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new DbError('INVALID_HQ3D_SYNC_PLAN', 400, { field });
  }
  return value.trim();
};

const unique = (values: string[], field: string) => {
  if (new Set(values).size !== values.length) throw new DbError('INVALID_HQ3D_SYNC_PLAN', 400, { field, reason: 'DUPLICATE' });
};

export const validateHq3dSyncPlan = (plan: Hq3dSyncPlan) => {
  if (!plan || !Array.isArray(plan.mappings) || !Array.isArray(plan.dispositions) || !Array.isArray(plan.retireResources)
    || !Array.isArray(plan.deferredResourceIds) || !Array.isArray(plan.alreadyAbsentResourceIds) || !Array.isArray(plan.pendingResourceIds)) {
    throw new DbError('INVALID_HQ3D_SYNC_PLAN', 400);
  }
  text(plan.planId, 'planId', 64);
  text(plan.authorization?.mode, 'authorization.mode', 64);
  text(plan.authorization?.requestedBy, 'authorization.requestedBy', 128);
  text(plan.authorization?.requestedAt, 'authorization.requestedAt', 32);
  text(plan.authorization?.note, 'authorization.note', 500);
  unique(plan.mappings.map(item => text(item.resourceId, 'mappings.resourceId', 128)), 'mappings.resourceId');
  unique(plan.mappings.map(item => text(item.roomUid, 'mappings.roomUid', 255)), 'mappings.roomUid');
  unique(plan.dispositions.map(item => text(item.roomUid, 'dispositions.roomUid', 255)), 'dispositions.roomUid');
  unique(plan.retireResources.map(item => text(item.resourceId, 'retireResources.resourceId', 128)), 'retireResources.resourceId');
  unique(plan.deferredResourceIds, 'deferredResourceIds');
  unique(plan.alreadyAbsentResourceIds, 'alreadyAbsentResourceIds');
  unique(plan.pendingResourceIds, 'pendingResourceIds');
  for (const mapping of plan.mappings) {
    text(mapping.decisionRef, 'mappings.decisionRef', 16);
    if (!['EXPLICIT', 'SAFE_DEFAULT'].includes(mapping.decisionBasis)) throw new DbError('INVALID_HQ3D_SYNC_PLAN', 400, { field: 'mappings.decisionBasis' });
    if ((mapping.note || '').length > 500) throw new DbError('INVALID_HQ3D_SYNC_PLAN', 400, { field: 'mappings.note' });
  }
  for (const item of plan.dispositions) {
    if (!['DISPLAY_ONLY', 'BOOKABLE_CANDIDATE'].includes(item.disposition)) throw new DbError('INVALID_HQ3D_SYNC_PLAN', 400, { field: 'dispositions.disposition' });
    if (!['EXPLICIT', 'SAFE_DEFAULT'].includes(item.decisionBasis)) throw new DbError('INVALID_HQ3D_SYNC_PLAN', 400, { field: 'dispositions.decisionBasis' });
    if ((item.note || '').length > 500) throw new DbError('INVALID_HQ3D_SYNC_PLAN', 400, { field: 'dispositions.note' });
  }
  for (const item of plan.retireResources) {
    if (!Number.isSafeInteger(item.expectedBookingCount) || item.expectedBookingCount < 0
      || !Number.isSafeInteger(item.expectedActiveBookingCount) || item.expectedActiveBookingCount < 0
      || item.expectedActiveBookingCount > item.expectedBookingCount) {
      throw new DbError('INVALID_HQ3D_SYNC_PLAN', 400, { field: 'retireResources.expectedBookingCount' });
    }
    text(item.reason, 'retireResources.reason', 500);
  }
  const retired = new Set(plan.retireResources.map(item => item.resourceId));
  if (plan.mappings.some(item => retired.has(item.resourceId))) throw new DbError('INVALID_HQ3D_SYNC_PLAN', 400, { field: 'mappings.resourceId', reason: 'RETIRED_RESOURCE' });
};

const assertActiveRooms = async (conn: PoolConnection, roomUids: string[]) => {
  if (!roomUids.length) return;
  const [rows] = await conn.query<any[]>(
    `SELECT uid FROM hq3d_room WHERE is_active = 1 AND uid IN (${roomUids.map(() => '?').join(',')}) FOR UPDATE`,
    roomUids
  );
  if (rows.length !== new Set(roomUids).size) {
    const found = new Set(rows.map(row => String(row.uid)));
    throw new DbError('HQ3D_ROOM_NOT_ACTIVE', 409, { roomUids: roomUids.filter(uid => !found.has(uid)) });
  }
};

const saveMappings = async (
  conn: PoolConnection,
  plan: Hq3dSyncPlan,
  actorId: string,
  at: string,
  audit: MutationContext['audit']
) => {
  let written = 0;
  let unchanged = 0;
  for (const mapping of plan.mappings) {
    const [rows] = await conn.query<any[]>(
      'SELECT * FROM hq3d_room_resource WHERE room_uid = ? OR resource_id = ? FOR UPDATE',
      [mapping.roomUid, mapping.resourceId]
    );
    if (rows.some(row => row.room_uid !== mapping.roomUid || row.resource_id !== mapping.resourceId)) {
      throw new DbError('HQ3D_MAPPING_CONFLICT', 409, { resourceId: mapping.resourceId, roomUid: mapping.roomUid });
    }
    const current = rows[0];
    const note = mapping.note || '';
    if (current && current.plan_id === plan.planId && current.decision_ref === mapping.decisionRef
      && current.decision_basis === mapping.decisionBasis && current.note === note) {
      unchanged += 1;
      continue;
    }
    await conn.query(
      `INSERT INTO hq3d_room_resource
         (room_uid, resource_id, plan_id, decision_ref, decision_basis, note, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE plan_id = VALUES(plan_id), decision_ref = VALUES(decision_ref),
         decision_basis = VALUES(decision_basis), note = VALUES(note), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
      [mapping.roomUid, mapping.resourceId, plan.planId, mapping.decisionRef, mapping.decisionBasis, note, actorId, new Date(at), actorId, new Date(at)]
    );
    await audit({
      actorId,
      action: 'HQ3D_RESOURCE_MAP_SAVE',
      entityType: 'HQ3D_ROOM',
      entityId: mapping.roomUid,
      details: { resourceId: mapping.resourceId, planId: plan.planId, decisionRef: mapping.decisionRef, decisionBasis: mapping.decisionBasis }
    });
    written += 1;
  }
  return { written, unchanged };
};

const saveDispositions = async (
  conn: PoolConnection,
  plan: Hq3dSyncPlan,
  actorId: string,
  at: string,
  audit: MutationContext['audit']
) => {
  let written = 0;
  let unchanged = 0;
  for (const item of plan.dispositions) {
    const reviewStatus = item.disposition === 'DISPLAY_ONLY' ? 'APPLIED' : 'UAT_PENDING';
    const note = item.note || '';
    if (item.disposition === 'DISPLAY_ONLY') {
      const [links] = await conn.query<any[]>('SELECT resource_id FROM hq3d_room_resource WHERE room_uid = ? FOR UPDATE', [item.roomUid]);
      if (links.length) throw new DbError('HQ3D_DISPOSITION_MAPPING_CONFLICT', 409, { roomUid: item.roomUid, resourceId: links[0].resource_id });
    }
    const [rows] = await conn.query<any[]>('SELECT * FROM hq3d_room_disposition WHERE room_uid = ? FOR UPDATE', [item.roomUid]);
    const current = rows[0];
    if (current && current.disposition === item.disposition && current.review_status === reviewStatus
      && current.plan_id === plan.planId && current.decision_basis === item.decisionBasis && current.note === note) {
      unchanged += 1;
      continue;
    }
    await conn.query(
      `INSERT INTO hq3d_room_disposition
         (room_uid, disposition, review_status, plan_id, decision_ref, decision_basis, note, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, 'C-05', ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE disposition = VALUES(disposition), review_status = VALUES(review_status), plan_id = VALUES(plan_id),
         decision_basis = VALUES(decision_basis), note = VALUES(note), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
      [item.roomUid, item.disposition, reviewStatus, plan.planId, item.decisionBasis, note, actorId, new Date(at), actorId, new Date(at)]
    );
    await audit({
      actorId,
      action: 'HQ3D_ROOM_DISPOSITION_SAVE',
      entityType: 'HQ3D_ROOM',
      entityId: item.roomUid,
      details: { disposition: item.disposition, reviewStatus, planId: plan.planId, decisionBasis: item.decisionBasis }
    });
    written += 1;
  }
  return { written, unchanged };
};

const retireResources = async (
  conn: PoolConnection,
  db: OfficeDb,
  plan: Hq3dSyncPlan,
  actorId: string,
  at: string,
  audit: MutationContext['audit']
) => {
  const retiredResourceIds: string[] = [];
  const alreadyRetiredResourceIds: string[] = [];
  const cancelledBookingIds: string[] = [];
  const replacements = new Map<string, Booking>();
  const notifications: Notification[] = [];

  for (const item of plan.retireResources) {
    const resource = (db.resources || []).find(candidate => candidate.id === item.resourceId);
    const [archiveRows] = await conn.query<any[]>('SELECT plan_id FROM resource_retirements WHERE resource_id = ? FOR UPDATE', [item.resourceId]);
    if (!resource && archiveRows[0]?.plan_id === plan.planId) {
      alreadyRetiredResourceIds.push(item.resourceId);
      continue;
    }
    if (!resource || archiveRows.length) throw new DbError('RESOURCE_RETIREMENT_CONFLICT', 409, { resourceId: item.resourceId });
    if ((db.devices || []).some(device => device.resourceId === item.resourceId)) {
      throw new DbError('RESOURCE_HAS_DEVICES', 409, { resourceId: item.resourceId });
    }
    const bookings = (db.bookings || []).filter(booking => booking.resourceId === item.resourceId);
    const active = bookings.filter(booking => ['PENDING', 'APPROVED'].includes(booking.status));
    if (bookings.length !== item.expectedBookingCount || active.length !== item.expectedActiveBookingCount) {
      throw new DbError('HQ3D_RETIREMENT_BASELINE_CHANGED', 409, {
        resourceId: item.resourceId,
        expectedBookingCount: item.expectedBookingCount,
        actualBookingCount: bookings.length,
        expectedActiveBookingCount: item.expectedActiveBookingCount,
        actualActiveBookingCount: active.length
      });
    }

    const cancelledForResource: string[] = [];
    for (const current of active) {
      const next = releaseBooking(db, current, {
        reason: item.reason,
        type: 'MANUAL_EXCEPTION',
        actorId,
        source: 'MANUAL',
        at
      });
      replacements.set(current.id, next);
      cancelledForResource.push(current.id);
      cancelledBookingIds.push(current.id);
      await audit({
        actorId,
        action: 'BOOKING_RESOURCE_RETIREMENT_CANCEL',
        entityType: 'BOOKING',
        entityId: current.id,
        details: { resourceId: item.resourceId, previousStatus: current.status, planId: plan.planId, decisionRef: 'C-04' }
      });
      const recipients = [...new Set([current.userId, ...(current.attendeeIds || [])])];
      for (const userId of recipients) {
        notifications.push({
          id: crypto.randomUUID(),
          userId,
          title: '资源退役，预约已取消',
          content: `${bookingNoticePurpose(current)}已取消：${item.reason}`,
          timestamp: at,
          isRead: false,
          type: 'WARNING'
        });
      }
    }

    await conn.query(
      `INSERT INTO resource_retirements
         (resource_id, resource_snapshot, plan_id, decision_ref, reason, cancelled_booking_ids, retired_by, retired_at)
       VALUES (?, ?, ?, 'C-04', ?, ?, ?, ?)`,
      [item.resourceId, JSON.stringify(resource), plan.planId, item.reason, JSON.stringify(cancelledForResource), actorId, new Date(at)]
    );
    await conn.query('DELETE FROM hq3d_room_resource WHERE resource_id = ?', [item.resourceId]);
    await audit({
      actorId,
      action: 'RESOURCE_RETIRE',
      entityType: 'RESOURCE',
      entityId: item.resourceId,
      details: {
        code: resource.code,
        name: resource.name,
        planId: plan.planId,
        decisionRef: 'C-04',
        retainedBookingCount: bookings.length,
        cancelledBookingIds: cancelledForResource
      }
    });
    retiredResourceIds.push(item.resourceId);
  }

  if (replacements.size) db.bookings = (db.bookings || []).map(booking => replacements.get(booking.id) || booking);
  if (retiredResourceIds.length) {
    const retired = new Set(retiredResourceIds);
    db.resources = (db.resources || []).filter(resource => !retired.has(resource.id));
    db.serviceAreas = (db.serviceAreas || []).map(area => ({ ...area, resourceIds: area.resourceIds.filter(id => !retired.has(id)) }));
  }
  if (notifications.length) db.notifications = [...notifications, ...(db.notifications || [])].slice(0, 1000);
  return { retiredResourceIds, alreadyRetiredResourceIds, cancelledBookingIds };
};

export const applyHq3dSyncPlanInTransaction = async (
  conn: PoolConnection,
  db: OfficeDb,
  plan: Hq3dSyncPlan,
  actorId: string,
  audit: MutationContext['audit'],
  at = new Date().toISOString()
): Promise<Hq3dSyncResult> => {
  validateHq3dSyncPlan(plan);
  for (const resourceId of plan.alreadyAbsentResourceIds) {
    if ((db.resources || []).some(resource => resource.id === resourceId)) {
      throw new DbError('HQ3D_ABSENT_RESOURCE_BASELINE_CHANGED', 409, { resourceId });
    }
  }
  for (const resourceId of plan.pendingResourceIds) {
    if ((db.resources || []).find(resource => resource.id === resourceId)?.status !== 'PENDING') {
      throw new DbError('HQ3D_PENDING_RESOURCE_BASELINE_CHANGED', 409, { resourceId });
    }
  }
  await assertActiveRooms(conn, [...plan.mappings.map(item => item.roomUid), ...plan.dispositions.map(item => item.roomUid)]);
  const mappings = await saveMappings(conn, plan, actorId, at, audit);
  const dispositions = await saveDispositions(conn, plan, actorId, at, audit);
  if (plan.deferredResourceIds.length) {
    const [rows] = await conn.query<any[]>(
      `SELECT resource_id FROM hq3d_room_resource WHERE resource_id IN (${plan.deferredResourceIds.map(() => '?').join(',')}) FOR UPDATE`,
      plan.deferredResourceIds
    );
    if (rows.length) throw new DbError('HQ3D_DEFERRED_RESOURCE_MAPPED', 409, { resourceIds: rows.map(row => row.resource_id) });
  }
  const retirement = await retireResources(conn, db, plan, actorId, at, audit);
  for (const resourceId of plan.pendingResourceIds) {
    if ((db.resources || []).find(resource => resource.id === resourceId)?.status !== 'PENDING') {
      throw new DbError('HQ3D_PENDING_RESOURCE_CHANGED', 409, { resourceId });
    }
  }
  const result: Hq3dSyncResult = {
    planId: plan.planId,
    mappingsWritten: mappings.written,
    mappingsUnchanged: mappings.unchanged,
    dispositionsWritten: dispositions.written,
    dispositionsUnchanged: dispositions.unchanged,
    retiredResourceIds: retirement.retiredResourceIds,
    alreadyRetiredResourceIds: retirement.alreadyRetiredResourceIds,
    cancelledBookingIds: retirement.cancelledBookingIds,
    deferredResourceCount: plan.deferredResourceIds.length,
    pendingResourceCount: plan.pendingResourceIds.length
  };
  if (hasHq3dSyncChanges(result)) {
    await audit({
      actorId,
      action: 'HQ3D_SYNC_PLAN_APPLY',
      entityType: 'HQ3D_SYNC_PLAN',
      entityId: plan.planId,
      details: { ...result, authorization: plan.authorization }
    });
  }
  return result;
};

const hasHq3dSyncChanges = (result: Hq3dSyncResult) => Boolean(
  result.mappingsWritten || result.dispositionsWritten || result.retiredResourceIds.length || result.cancelledBookingIds.length
);

export const applyHq3dSyncPlan = async (plan: Hq3dSyncPlan, actorId: string, expectedRevision?: number) => mutateDb(async (db, context) => {
  const actor = (db.users || []).find(user => user.id === actorId);
  if (!actor?.role.includes('SYSTEM_ADMIN')) throw new DbError('FORBIDDEN', 403);
  return applyHq3dSyncPlanInTransaction(context.connection, db, plan, actorId, context.audit);
}, { expectedRevision, snapshot: result => hasHq3dSyncChanges(result) });

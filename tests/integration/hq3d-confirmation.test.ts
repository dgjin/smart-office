import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Booking, Resource } from '../../types.ts';
import { closeDbPool, getDbPool, mutateDb, readSnapshot } from '../../server/db.ts';
import { getHq3dSnapshot } from '../../server/hq3d.ts';
import { seedHq3dLayout, type Hq3dSeedRoom } from '../../server/hq3dLayout.ts';
import { applyHq3dSyncPlan, type Hq3dSyncPlan } from '../../server/hq3dSync.ts';
import { integrationEnabled, queryTestDb, resetTestDb } from '../support/testServer.ts';

const actorId = '1';
const mappedUid = 'test#1F#101#会议室';
const displayUid = 'test#1F#102#接待室';
const candidateUid = 'test#1F#103#会议室';
const room = (uid: string, label: string): Hq3dSeedRoom => ({
  uid,
  no: uid.split('#')[2],
  cat: 'meeting',
  label,
  dept: '',
  person: '',
  notes: '',
  lines: [label],
  nx: 0,
  nz: 0,
  nw: 0.3,
  nd: 0.3,
  frac: 0.09
});
const resource = (id: string, status: Resource['status'] = 'AVAILABLE'): Resource => ({
  id,
  code: id.toUpperCase(),
  name: `测试${id}`,
  type: 'ROOM',
  capacity: 10,
  location: '测试楼 1层',
  building: 'MAIN',
  floor: 1,
  roomNumber: '101',
  features: [],
  status,
  isExclusive: false,
  isPublic: true
});
const booking = (id: string, status: Booking['status']): Booking => {
  const createdAt = new Date().toISOString();
  return {
    id,
    userId: actorId,
    resourceId: 'r-retire',
    type: 'ROOM',
    startTime: '2026-12-10T01:00:00.000Z',
    endTime: '2026-12-10T02:00:00.000Z',
    status,
    purpose: `退役测试${id}`,
    participants: 2,
    meetingType: 'NORMAL',
    confidentialityChoice: 'NON_CONFIDENTIAL',
    createdAt,
    currentNodeIndex: 0,
    approvalHistory: [],
    scheduleVersion: 1
  };
};
const plan: Hq3dSyncPlan = {
  planId: 'TEST-HQ3D-SYNC',
  authorization: {
    mode: 'CONFIRMED_OR_SAFE_DEFAULT_WITH_UAT_MAINTENANCE',
    requestedBy: 'integration-test',
    requestedAt: '2026-11-22',
    note: '隔离测试授权，不构成责任方签认或投产通过。'
  },
  mappings: [{ resourceId: 'r-map', roomUid: mappedUid, decisionRef: 'C-01', decisionBasis: 'EXPLICIT' }],
  deferredResourceIds: ['r-deferred'],
  dispositions: [
    { roomUid: displayUid, disposition: 'DISPLAY_ONLY', decisionBasis: 'EXPLICIT' },
    { roomUid: candidateUid, disposition: 'BOOKABLE_CANDIDATE', decisionBasis: 'SAFE_DEFAULT', note: '待UAT核定' }
  ],
  retireResources: [{ resourceId: 'r-retire', expectedBookingCount: 3, expectedActiveBookingCount: 2, reason: '隔离测试受控退役' }],
  alreadyAbsentResourceIds: ['r-absent'],
  pendingResourceIds: ['r-pending']
};

const clearHq3d = async () => {
  for (const table of ['resource_retirements', 'hq3d_room_resource', 'hq3d_room_disposition', 'hq3d_room_maintenance', 'hq3d_room_profile', 'hq3d_room', 'hq3d_floor', 'hq3d_building']) {
    await queryTestDb(`DELETE FROM ${table}`);
  }
};

describe('总部3D确认映射与受控退役', { skip: !integrationEnabled, concurrency: false }, () => {
  before(async () => {
    await resetTestDb();
    await clearHq3d();
    const conn = await getDbPool().getConnection();
    try {
      await seedHq3dLayout(conn, {
        buildings: [{
          id: 'test',
          name: '测试楼',
          aspect: 1,
          aspAll: [1],
          floors: [{ sheet: '测试一层', rooms: [room(mappedUid, '会议室'), room(displayUid, '接待室'), room(candidateUid, '会议室')] }]
        }]
      });
    } finally {
      conn.release();
    }
    await mutateDb(async db => {
      db.resources = [...(db.resources || []), resource('r-map'), resource('r-pending', 'PENDING'), resource('r-deferred'), resource('r-retire')];
      db.bookings = [booking('bk-retire-pending', 'PENDING'), booking('bk-retire-approved', 'APPROVED'), booking('bk-retire-completed', 'COMPLETED'), ...(db.bookings || [])];
      db.workOrders = [{
        id: 'wo-retire-approved',
        bookingId: 'bk-retire-approved',
        type: 'TEA',
        title: '退役测试服务单',
        assigneeRole: 'SERVICE_COORDINATOR',
        status: 'TODO',
        createdAt: new Date().toISOString(),
        scheduleVersion: 1,
        fieldValues: {},
        statusHistory: []
      }, ...(db.workOrders || [])];
    });
  });

  after(async () => {
    await clearHq3d();
    await closeDbPool();
  });

  it('同事务保存映射与处置、保留预约历史并取消有效预约', async () => {
    const beforeSnapshot = await readSnapshot();
    const result = await applyHq3dSyncPlan(plan, actorId, beforeSnapshot.revision);
    assert.deepEqual(result.retiredResourceIds, ['r-retire']);
    assert.deepEqual(result.cancelledBookingIds.sort(), ['bk-retire-approved', 'bk-retire-pending']);
    assert.equal(result.mappingsWritten, 1);
    assert.equal(result.dispositionsWritten, 2);

    const { db } = await readSnapshot();
    assert.equal((db.resources || []).some(item => item.id === 'r-retire'), false);
    assert.equal((db.resources || []).find(item => item.id === 'r-pending')?.status, 'PENDING');
    const retained = (db.bookings || []).filter(item => item.resourceId === 'r-retire');
    assert.equal(retained.length, 3);
    assert.equal(retained.find(item => item.id === 'bk-retire-pending')?.status, 'CANCELLED');
    assert.equal(retained.find(item => item.id === 'bk-retire-approved')?.status, 'CANCELLED');
    assert.equal(retained.find(item => item.id === 'bk-retire-approved')?.releaseType, 'MANUAL_EXCEPTION');
    assert.equal(retained.find(item => item.id === 'bk-retire-completed')?.status, 'COMPLETED');
    assert.ok(retained.filter(item => item.status === 'CANCELLED').every(item => item.releaseReason === '隔离测试受控退役' && item.accessRevokedAt));
    assert.equal((db.workOrders || []).find(item => item.id === 'wo-retire-approved')?.status, 'CANCELLED');
    assert.equal((db.usageFacts || []).filter(item => item.bookingId.startsWith('bk-retire-')).length, 2);
    assert.ok((db.notifications || []).some(item => item.title === '资源退役，预约已取消'));

    const archives = await queryTestDb<any[]>('SELECT resource_snapshot, cancelled_booking_ids FROM resource_retirements WHERE resource_id = ?', ['r-retire']);
    assert.equal(archives.length, 1);
    const snapshot = typeof archives[0].resource_snapshot === 'string' ? JSON.parse(archives[0].resource_snapshot) : archives[0].resource_snapshot;
    assert.equal(snapshot.name, '测试r-retire');
    const cancelledIds = typeof archives[0].cancelled_booking_ids === 'string' ? JSON.parse(archives[0].cancelled_booking_ids) : archives[0].cancelled_booking_ids;
    assert.deepEqual(cancelledIds.sort(), ['bk-retire-approved', 'bk-retire-pending']);

    const hq3d = await getHq3dSnapshot();
    assert.equal(hq3d.resourceMappings[mappedUid]?.resourceId, 'r-map');
    assert.equal(hq3d.dispositions[displayUid]?.disposition, 'DISPLAY_ONLY');
    assert.equal(hq3d.dispositions[candidateUid]?.reviewStatus, 'UAT_PENDING');
    assert.equal((await queryTestDb<any[]>('SELECT resource_id FROM hq3d_room_resource WHERE resource_id = ?', ['r-deferred'])).length, 0);
    const cancelEvents = await queryTestDb<any[]>('SELECT payload FROM outbox_events WHERE event_type = ?', ['CALENDAR_SYNC']);
    assert.ok(cancelEvents.some(row => {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      return payload.bookingId === 'bk-retire-approved' && payload.operation === 'CANCEL';
    }));
  });

  it('重复执行不重复取消、通知、审计或推进快照版本', async () => {
    const before = await readSnapshot();
    const auditsBefore = await queryTestDb<any[]>('SELECT id FROM audit_events WHERE entity_id = ?', [plan.planId]);
    const result = await applyHq3dSyncPlan(plan, actorId, before.revision);
    assert.equal(result.mappingsWritten, 0);
    assert.equal(result.mappingsUnchanged, 1);
    assert.equal(result.dispositionsWritten, 0);
    assert.equal(result.dispositionsUnchanged, 2);
    assert.deepEqual(result.cancelledBookingIds, []);
    assert.deepEqual(result.alreadyRetiredResourceIds, ['r-retire']);
    const after = await readSnapshot();
    assert.equal(after.revision, before.revision);
    assert.equal((after.db.notifications || []).length, (before.db.notifications || []).length);
    const auditsAfter = await queryTestDb<any[]>('SELECT id FROM audit_events WHERE entity_id = ?', [plan.planId]);
    assert.equal(auditsAfter.length, auditsBefore.length);
  });

  it('既有映射冲突整批拒绝且不改变原映射', async () => {
    const conflict = structuredClone(plan);
    conflict.planId = 'TEST-HQ3D-CONFLICT';
    conflict.mappings[0].roomUid = displayUid;
    conflict.dispositions = [];
    await assert.rejects(applyHq3dSyncPlan(conflict, actorId), /HQ3D_MAPPING_CONFLICT/);
    const mappings = await queryTestDb<any[]>('SELECT room_uid, plan_id FROM hq3d_room_resource WHERE resource_id = ?', ['r-map']);
    assert.equal(mappings.length, 1);
    assert.equal(mappings[0].room_uid, mappedUid);
    assert.equal(mappings[0].plan_id, plan.planId);
  });
});

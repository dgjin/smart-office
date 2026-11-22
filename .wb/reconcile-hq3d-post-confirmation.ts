import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATABASE_NAME } from '../server/config.ts';
import { closeDbPool, getDbPool } from '../server/db.ts';
import { validateHq3dSyncPlan, type Hq3dSyncPlan } from '../server/hq3dSync.ts';

const baselinePath = '.wb/reports/hq3d-resource-live-extract-post-c07-20261122.json';
const outputPath = path.resolve(process.env.HQ3D_RECONCILE_OUTPUT || '.wb/reports/hq3d-post-confirmation-20261122.json');
const plan = JSON.parse(await readFile('server/data/hq3d-confirmation-20261122.json', 'utf8')) as Hq3dSyncPlan;
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
validateHq3dSyncPlan(plan);

const parseJson = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
const resourceRow = (resource: any) => ({
  id: resource.id,
  code: resource.code || '',
  name: resource.name || '',
  capacity: resource.capacity ?? null,
  location: resource.location || '',
  building: resource.building || '',
  floor: resource.floor ?? null,
  roomNumber: resource.roomNumber || '',
  roomCategory: resource.roomCategory || '',
  campus: resource.campus || '',
  features: resource.features || [],
  status: resource.status || '',
  isExclusive: Boolean(resource.isExclusive),
  isPublic: resource.isPublic !== false,
  openStart: resource.openStart || '',
  openEnd: resource.openEnd || '',
  notes: resource.notes || ''
});
const byResourceId = (left: any, right: any) => left.resourceId.localeCompare(right.resourceId);
const byRoomUid = (left: any, right: any) => left.roomUid.localeCompare(right.roomUid);

try {
  const pool = getDbPool();
  const [[resourceState]] = await pool.query<any[]>("SELECT payload FROM office_state WHERE state_key = 'resources'");
  const [[meta]] = await pool.query<any[]>('SELECT revision FROM office_snapshot_meta WHERE id = 1');
  const resources = (parseJson(resourceState.payload) as any[]).filter(resource => resource.type === 'ROOM').map(resourceRow);
  const retiredIds = plan.retireResources.map(item => item.resourceId);
  const retiredSet = new Set(retiredIds);

  const expectedResources = baseline.resources.filter((resource: any) => !retiredSet.has(resource.id));
  assert.deepStrictEqual(resources, expectedResources, '除授权退役外，资源清单或字段发生变化');
  for (const resourceId of plan.alreadyAbsentResourceIds) {
    assert.ok(!resources.some(resource => resource.id === resourceId), `${resourceId} 不应恢复`);
  }
  assert.equal(resources.find(resource => resource.id === 'r-hq-main-1902')?.name, '1902 小型会议室');
  assert.equal(resources.find(resource => resource.id === 'r-hq-main-209')?.name, '209 接待室');

  const [mappingRows] = await pool.query<any[]>(`SELECT room_uid AS roomUid, resource_id AS resourceId,
    plan_id AS planId, decision_ref AS decisionRef, decision_basis AS decisionBasis, note
    FROM hq3d_room_resource ORDER BY resource_id`);
  const expectedMappings = plan.mappings.map(item => ({
    roomUid: item.roomUid,
    resourceId: item.resourceId,
    planId: plan.planId,
    decisionRef: item.decisionRef,
    decisionBasis: item.decisionBasis,
    note: item.note || ''
  })).sort(byResourceId);
  assert.deepStrictEqual(mappingRows, expectedMappings, '显式映射与确认计划不一致');
  assert.ok(!mappingRows.some((row: any) => plan.deferredResourceIds.includes(row.resourceId)), 'C-03资源不得猜测绑定');

  const [dispositionRows] = await pool.query<any[]>(`SELECT room_uid AS roomUid, disposition,
    review_status AS reviewStatus, plan_id AS planId, decision_ref AS decisionRef,
    decision_basis AS decisionBasis, note FROM hq3d_room_disposition ORDER BY room_uid`);
  const expectedDispositions = plan.dispositions.map(item => ({
    roomUid: item.roomUid,
    disposition: item.disposition,
    reviewStatus: item.disposition === 'DISPLAY_ONLY' ? 'APPLIED' : 'UAT_PENDING',
    planId: plan.planId,
    decisionRef: 'C-05',
    decisionBasis: item.decisionBasis,
    note: item.note || ''
  })).sort(byRoomUid);
  assert.deepStrictEqual(dispositionRows, expectedDispositions, '空间处置与确认计划不一致');
  assert.ok(!mappingRows.some((row: any) => row.roomUid === 'annex#3F#302#会议室'), '候选空间不得自动绑定资源');

  const pending = plan.pendingResourceIds.map(resourceId => ({
    resourceId,
    status: resources.find(resource => resource.id === resourceId)?.status || null
  }));
  assert.ok(pending.every(item => item.status === 'PENDING'), 'C-06资源状态不得开放');

  const retirements: any[] = [];
  const cancelledBookings: any[] = [];
  const preservedBookings: any[] = [];
  for (const item of plan.retireResources) {
    const [[archive]] = await pool.query<any[]>(`SELECT resource_id AS resourceId, resource_snapshot AS resourceSnapshot,
      plan_id AS planId, decision_ref AS decisionRef, cancelled_booking_ids AS cancelledBookingIds
      FROM resource_retirements WHERE resource_id = ?`, [item.resourceId]);
    assert.ok(archive, `${item.resourceId} 缺少退役归档`);
    assert.equal(archive.planId, plan.planId);
    assert.equal(archive.decisionRef, 'C-04');
    assert.equal(parseJson(archive.resourceSnapshot)?.id, item.resourceId);
    const cancelledIds = parseJson(archive.cancelledBookingIds) as string[];
    assert.equal(cancelledIds.length, item.expectedActiveBookingCount);
    const [bookingRows] = await pool.query<any[]>(`SELECT id, resource_id AS resourceId, status,
      release_type AS releaseType, payload FROM bookings WHERE resource_id = ? ORDER BY id`, [item.resourceId]);
    assert.equal(bookingRows.length, item.expectedBookingCount, `${item.resourceId} 历史预约数量变化`);
    for (const booking of bookingRows) {
      const stateBooking = parseJson(booking.payload);
      assert.ok(stateBooking, `${booking.id} 缺少业务快照`);
      assert.equal(stateBooking.status, booking.status, `${booking.id} 关系表与快照状态不一致`);
      if (cancelledIds.includes(booking.id)) {
        assert.equal(booking.status, 'CANCELLED');
        assert.equal(booking.releaseType, 'MANUAL_EXCEPTION');
        assert.equal(stateBooking.releaseType, 'MANUAL_EXCEPTION');
        cancelledBookings.push(booking);
      } else {
        assert.ok(!['PENDING', 'APPROVED'].includes(booking.status), `${booking.id} 仍为有效预约`);
      }
      preservedBookings.push({ id: booking.id, resourceId: booking.resourceId, status: booking.status });
    }
    retirements.push({ resourceId: item.resourceId, retainedBookingCount: bookingRows.length, cancelledBookingIds: cancelledIds });
  }
  assert.equal(preservedBookings.length, 15);
  assert.equal(new Set(cancelledBookings.map(booking => booking.id)).size, 4);

  const [migrationRows] = await pool.query<any[]>(`SELECT version FROM schema_migrations
    WHERE version IN ('015z_hq3d_room_collation_alignment.sql', '015zz_hq3d_database_collation_alignment.sql',
      '016_hq3d_confirmed_sync.sql') ORDER BY version`);
  assert.deepStrictEqual(migrationRows.map(row => row.version), [
    '015z_hq3d_room_collation_alignment.sql',
    '015zz_hq3d_database_collation_alignment.sql',
    '016_hq3d_confirmed_sync.sql'
  ]);
  const [[databaseCollation]] = await pool.query<any[]>(`SELECT DEFAULT_COLLATION_NAME AS collation
    FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = DATABASE()`);
  assert.equal(databaseCollation.collation, 'utf8mb4_unicode_ci');
  const [collationRows] = await pool.query<any[]>(`SELECT TABLE_NAME AS tableName, TABLE_COLLATION AS collation
    FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('hq3d_room', 'hq3d_room_resource', 'hq3d_room_disposition') ORDER BY TABLE_NAME`);
  assert.equal(collationRows.length, 3);
  assert.ok(collationRows.every((row: any) => row.collation === 'utf8mb4_unicode_ci'));
  const [[roomIdentity]] = await pool.query<any[]>(`SELECT COUNT(*) AS total,
    COALESCE(SUM(is_active = 1), 0) AS active FROM hq3d_room`);
  assert.equal(Number(roomIdentity.total), 427);
  assert.equal(Number(roomIdentity.active), 427);

  const auditCounts: Record<string, number> = {};
  for (const [action, expected] of Object.entries({
    HQ3D_RESOURCE_MAP_SAVE: 14,
    HQ3D_ROOM_DISPOSITION_SAVE: 24,
    BOOKING_RESOURCE_RETIREMENT_CANCEL: 4,
    RESOURCE_RETIRE: 3,
    HQ3D_SYNC_PLAN_APPLY: 1
  })) {
    const [[row]] = await pool.query<any[]>(`SELECT COUNT(*) AS count FROM audit_events
      WHERE action = ? AND JSON_UNQUOTE(JSON_EXTRACT(details, '$.planId')) = ?`, [action, plan.planId]);
    auditCounts[action] = Number(row.count);
    assert.equal(auditCounts[action], expected, `${action} 审计数量不一致`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    status: 'TECHNICALLY_APPLIED_AND_RECONCILED',
    productionApproved: false,
    responsiblePartySignoff: false,
    c07DualReviewCompleted: false,
    source: {
      database: DATABASE_NAME,
      queryMode: 'READ_ONLY',
      baseline: baselinePath,
      databaseSnapshotRevision: Number(meta.revision)
    },
    plan: {
      planId: plan.planId,
      authorization: plan.authorization
    },
    summary: {
      mappingCount: mappingRows.length,
      deferredUnmappedCount: plan.deferredResourceIds.length,
      displayOnlyCount: dispositionRows.filter((row: any) => row.disposition === 'DISPLAY_ONLY').length,
      bookableCandidateCount: dispositionRows.filter((row: any) => row.disposition === 'BOOKABLE_CANDIDATE').length,
      retiredResourceCount: retirements.length,
      alreadyAbsentResourceCount: plan.alreadyAbsentResourceIds.length,
      preservedBookingCount: preservedBookings.length,
      cancelledActiveBookingCount: cancelledBookings.length,
      pendingResourceCount: pending.length,
      activeHq3dRoomCount: Number(roomIdentity.active),
      resourceFieldsOutsideRetirementUnchanged: true
    },
    mappings: mappingRows,
    dispositions: dispositionRows,
    retirements,
    cancelledBookings: cancelledBookings.map(booking => ({
      id: booking.id,
      resourceId: booking.resourceId,
      status: booking.status,
      releaseType: booking.releaseType
    })),
    pendingResources: pending,
    auditCounts,
    migrations: migrationRows.map(row => row.version),
    databaseCollation: databaseCollation.collation,
    collations: collationRows,
    uatMaintenance: [
      { ref: 'C-03', status: 'UAT_PENDING', resourceIds: plan.deferredResourceIds, action: '由管理员确认真实roomUid后维护显式映射，禁止按名称猜测。' },
      { ref: 'C-05', status: 'UAT_PENDING', roomUid: 'annex#3F#302#会议室', action: '核定容量、设备、开放规则和开放审批；当前不创建预约资源。' },
      { ref: 'C-06', status: 'UAT_PENDING', resourceIds: plan.pendingResourceIds, action: '核定容量、设备、开放规则和开放审批前继续保持PENDING。' },
      { ref: 'C-07', status: 'RESPONSIBLE_PARTY_PENDING', action: '由两名真实复核责任方完成独立复核与签认，本次技术执行不代签。' },
      { ref: 'P9-03/SECURITY/ROLLOUT', status: 'FORMAL_GATES_PENDING', action: '正式容量、安全、生产恢复、UAT、培训、灰度和稳定观察仍须真实执行与签认。' }
    ]
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ ok: true, output: outputPath, summary: report.summary, auditCounts }, null, 2));
} finally {
  await closeDbPool();
}

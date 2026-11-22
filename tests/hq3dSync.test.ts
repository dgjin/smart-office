import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateHq3dSyncPlan, type Hq3dSyncPlan } from '../server/hq3dSync.ts';

const plan = JSON.parse(readFileSync(new URL('../server/data/hq3d-confirmation-20261122.json', import.meta.url), 'utf8')) as Hq3dSyncPlan;

test('总部3D确认计划仅包含授权范围和安全默认', () => {
  validateHq3dSyncPlan(plan);
  assert.equal(plan.mappings.length, 14);
  assert.equal(plan.deferredResourceIds.length, 14);
  assert.equal(plan.dispositions.filter(item => item.disposition === 'DISPLAY_ONLY').length, 23);
  assert.equal(plan.dispositions.filter(item => item.disposition === 'BOOKABLE_CANDIDATE').length, 1);
  assert.equal(plan.retireResources.length, 3);
  assert.equal(plan.pendingResourceIds.length, 10);
  assert.equal(plan.retireResources.reduce((sum, item) => sum + item.expectedBookingCount, 0), 15);
  assert.equal(plan.retireResources.reduce((sum, item) => sum + item.expectedActiveBookingCount, 0), 4);
  assert.ok(plan.deferredResourceIds.every(id => !plan.mappings.some(mapping => mapping.resourceId === id)));
  assert.equal(plan.dispositions.find(item => item.roomUid === 'annex#3F#302#会议室')?.decisionBasis, 'SAFE_DEFAULT');
  assert.match(plan.authorization.note, /不构成其他责任方签认或正式投产通过/);
});

test('映射计划拒绝重复房间、重复资源和退役资源绑定', () => {
  const duplicateRoom = structuredClone(plan);
  duplicateRoom.mappings[1].roomUid = duplicateRoom.mappings[0].roomUid;
  assert.throws(() => validateHq3dSyncPlan(duplicateRoom), /INVALID_HQ3D_SYNC_PLAN/);

  const duplicateResource = structuredClone(plan);
  duplicateResource.mappings[1].resourceId = duplicateResource.mappings[0].resourceId;
  assert.throws(() => validateHq3dSyncPlan(duplicateResource), /INVALID_HQ3D_SYNC_PLAN/);

  const retiredMapping = structuredClone(plan);
  retiredMapping.mappings[0].resourceId = retiredMapping.retireResources[0].resourceId;
  assert.throws(() => validateHq3dSyncPlan(retiredMapping), /INVALID_HQ3D_SYNC_PLAN/);
});

test('确认迁移对齐历史排序规则并提供一对一映射、空间处置与退役快照', () => {
  const databaseCollationMigration = readFileSync(new URL('../server/migrations/015zz_hq3d_database_collation_alignment.sql', import.meta.url), 'utf8');
  const collationMigration = readFileSync(new URL('../server/migrations/015z_hq3d_room_collation_alignment.sql', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../server/migrations/016_hq3d_confirmed_sync.sql', import.meta.url), 'utf8');
  assert.match(databaseCollationMigration, /ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/);
  assert.match(collationMigration, /ALTER TABLE hq3d_room\s+CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/);
  assert.ok('015z_hq3d_room_collation_alignment.sql' < '015zz_hq3d_database_collation_alignment.sql');
  assert.ok('015zz_hq3d_database_collation_alignment.sql' < '016_hq3d_confirmed_sync.sql');
  assert.match(migration, /UNIQUE KEY uq_hq3d_room_resource_id \(resource_id\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS hq3d_room_disposition/);
  assert.match(migration, /resource_snapshot JSON NOT NULL/);
  assert.doesNotMatch(migration, /DELETE FROM bookings|UPDATE bookings|DROP TABLE/i);
});

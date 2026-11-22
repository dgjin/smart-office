import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_RULE_SETTINGS } from '../constants.ts';
import { normalizeResource } from '../server/db.ts';
import { REQUIRED_MIGRATION } from '../server/config.ts';
import { buildResourceImportReport } from '../server/resourceLedger.ts';
import type { OfficeDb } from '../server/tools.ts';
import type { Resource } from '../types.ts';
import { getCurrentRuleSettings, getResourceBuilding, getResourceFloor, getRoomCategory } from '../utils/resourceDomain.ts';

const resourceInput = (overrides: Record<string, unknown> = {}) => ({
  id: 'r-main-10f-101',
  code: 'main-10f-101',
  name: '十层战略会议室',
  type: 'ROOM',
  capacity: 10,
  location: '1号楼 10层 · 101',
  features: ['投屏显示器'],
  status: 'AVAILABLE',
  ...overrides
});

const normalizedResource = (overrides: Record<string, unknown> = {}) => normalizeResource(resourceInput(overrides));

test('结构化资源字段优先，旧 location 仅作兼容回退', () => {
  const structured = normalizedResource({ building: 'ANNEX', floor: 3, location: '旧位置文本' });
  assert.equal(getResourceBuilding(structured), 'ANNEX');
  assert.equal(getResourceFloor(structured), 3);
  const legacy: Resource = { id: 'legacy', name: '旧会议室', type: 'ROOM', capacity: 4, location: '2号楼 4层', features: [], status: 'AVAILABLE' };
  assert.equal(getResourceBuilding(legacy), 'ANNEX');
  assert.equal(getResourceFloor(legacy), 4);
});

test('资源规范化生成永久编码、位置、容量分类和公共属性', () => {
  const resource = normalizedResource({ location: undefined, building: 'MAIN', floor: 10, roomNumber: '101' });
  assert.equal(resource.code, 'MAIN-10F-101');
  assert.equal(resource.location, '1号楼 10层 · 101');
  assert.equal(resource.roomCategory, 'SMALL');
  assert.equal(resource.isPublic, true);
  assert.equal(getRoomCategory(11), 'MEDIUM');
  assert.equal(getRoomCategory(31), 'LARGE');
  assert.equal(getRoomCategory(100, true), 'AUDITORIUM');
});

test('专属会议室和开放时段在领域边界强制校验', () => {
  assert.throws(() => normalizedResource({ isExclusive: true }), /INVALID_RESOURCE_LEADER_LEVEL/);
  assert.throws(() => normalizedResource({ openStart: '20:00', openEnd: '08:00' }), /INVALID_RESOURCE_OPEN_HOURS/);
  assert.throws(() => normalizedResource({ building: 'ANNEX', floor: 5 }), /INVALID_RESOURCE_FLOOR/);
  const exclusive = normalizedResource({ isExclusive: true, exclusiveLeaderLevel: '公司领导', openStart: '08:00', openEnd: '20:00' });
  assert.equal(exclusive.isPublic, false);
  assert.equal(exclusive.exclusiveLeaderLevel, '公司领导');
});

test('规则配置使用最高版本，未初始化时回退开发推荐值', () => {
  assert.deepEqual(getCurrentRuleSettings(), DEFAULT_RULE_SETTINGS);
  const current = getCurrentRuleSettings([
    { version: 1, settings: DEFAULT_RULE_SETTINGS, createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'system' },
    { version: 2, settings: { ...DEFAULT_RULE_SETTINGS, departmentDailyNetMinutes: 300 }, createdAt: '2026-01-02T00:00:00.000Z', createdBy: 'admin' }
  ]);
  assert.equal(current.departmentDailyNetMinutes, 300);
});

test('台账预检区分新增、更新、不变与逐行错误', () => {
  const current = normalizedResource();
  const updateInput = resourceInput({ id: 'r-main-11f-102', code: 'MAIN-11F-102', name: '十一层会议室', floor: 11, location: '1号楼 11层 · 102' });
  const updateCurrent = normalizeResource(updateInput);
  const created = resourceInput({ id: undefined, code: 'ANNEX-02F-201', name: '配楼培训室', building: 'ANNEX', floor: 2, roomNumber: '201', location: '2号楼 2层 · 201', capacity: 20 });
  const db: OfficeDb = { resources: [current, updateCurrent], bookings: [], ruleVersions: [{ version: 1, settings: DEFAULT_RULE_SETTINGS, createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'system' }] };
  const report = buildResourceImportReport(db, [
    resourceInput(),
    { ...updateInput, capacity: 12 },
    created,
    { ...created, id: 'r-missing-code', code: '', name: '缺少编码' }
  ], 7);
  assert.deepEqual(report.items.map(item => item.action), ['UNCHANGED', 'UPDATE', 'CREATE', 'ERROR']);
  assert.deepEqual(report.items[1].changedFields.sort(), ['capacity', 'roomCategory']);
  assert.equal(report.items[2].resource?.id, 'r-annex-02f-201');
  assert.equal(report.revision, 7);
  assert.equal(report.creates, 1);
  assert.equal(report.updates, 1);
  assert.equal(report.unchanged, 1);
  assert.equal(report.invalid, 1);
  assert.equal(report.items[3].issues[0].code, 'RESOURCE_CODE_REQUIRED');
});

test('台账预检阻止编码转移和文件内重复', () => {
  const first = normalizedResource();
  const second = normalizedResource({ id: 'r-other', code: 'OTHER-CODE', name: '另一会议室' });
  const report = buildResourceImportReport({ resources: [first, second], bookings: [] }, [
    resourceInput({ id: second.id, code: first.code, name: '编码冲突' }),
    resourceInput({ id: 'r-duplicate-1', code: 'DUPLICATE', name: '重复编码一' }),
    resourceInput({ id: 'r-duplicate-2', code: 'DUPLICATE', name: '重复编码二' })
  ]);
  assert.equal(report.invalid, 3);
  assert.equal(report.items[0].issues[0].code, 'RESOURCE_CODE_ID_CONFLICT');
  assert.ok(report.items.slice(1).every(item => item.issues.some(issue => issue.code === 'DUPLICATE_RESOURCE_CODE')));
});

test('007 迁移以幂等方式初始化规则和导入批次集合', () => {
  const migration = readFileSync(new URL('../server/migrations/007_resource_domain_expand.sql', import.meta.url), 'utf8');
  assert.match(migration, /INSERT IGNORE INTO office_state/);
  assert.match(migration, /'ruleVersions'/);
  assert.match(migration, /'resourceImportBatches'/);
  assert.match(migration, /'departmentDailyNetMinutes', 240/);
});

test('009 迁移仅增加可空审批关系列，不回填历史预约事实', () => {
  const migration = readFileSync(new URL('../server/migrations/009_dynamic_approval.sql', import.meta.url), 'utf8');
  for (const column of ['workflow_version', 'approval_rule_set_version', 'approval_rule_id', 'approval_submitted_at']) {
    assert.match(migration, new RegExp(`ADD COLUMN ${column} [^;]+NULL`));
  }
  assert.doesNotMatch(migration, /UPDATE bookings/i);
});

test('010 迁移增加可空使用释放列，不回填历史签到或释放事实', () => {
  const migration = readFileSync(new URL('../server/migrations/010_service_usage.sql', import.meta.url), 'utf8');
  for (const column of ['schedule_version', 'actual_start_time', 'actual_end_time', 'released_at', 'release_reason', 'release_type', 'access_revoked_at']) {
    assert.match(migration, new RegExp(`ADD COLUMN ${column} [^;]+NULL`));
  }
  assert.doesNotMatch(migration, /UPDATE bookings/i);
  assert.doesNotMatch(migration, /INSERT INTO (checkInEvents|usageFacts|usageAppeals)/i);
});

test('011 迁移幂等初始化设备与异常处理集合', () => {
  assert.equal(REQUIRED_MIGRATION, '015_hq3d_stable_room_identity.sql');
  const migration = readFileSync(new URL('../server/migrations/011_operations.sql', import.meta.url), 'utf8');
  assert.match(migration, /'devices'/);
  assert.match(migration, /'exceptionActions'/);
  assert.match(migration, /ON DUPLICATE KEY UPDATE payload = payload/);
  assert.doesNotMatch(migration, /tenant_id/i);
});

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_RULE_SETTINGS } from '../../constants.ts';
import type { Resource, ResourceImportBatch, RuleVersion } from '../../types.ts';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
let admin: Awaited<ReturnType<TestServer['login']>>;
let employee: Awaited<ReturnType<TestServer['login']>>;
let adminId = '';
let employeeId = '';

const readJson = async (response: Response) => response.json() as Promise<any>;
const call = (pathname: string, method: string, session: Awaited<ReturnType<TestServer['login']>>, body?: unknown) =>
  server.request(pathname, { method, headers: { Cookie: session.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
const readCollection = async <T>(key: string): Promise<T[]> => {
  const rows = await queryTestDb<any[]>('SELECT payload FROM office_state WHERE state_key = ?', [key]);
  assert.equal(rows.length, 1);
  return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
};
const mainResource = (overrides: Record<string, unknown> = {}) => ({
  id: 'r-ledger-main', code: 'LEDGER-MAIN-101', name: '台账主楼会议室', type: 'ROOM', capacity: 10,
  location: '1号楼 10层 · 101', building: 'MAIN', floor: 10, roomNumber: '101', features: ['投屏显示器'],
  status: 'AVAILABLE', isPublic: true, isExclusive: false, openStart: '08:00', openEnd: '20:00', ...overrides
});
const annexResource = (overrides: Record<string, unknown> = {}) => ({
  id: 'r-ledger-annex', code: 'LEDGER-ANNEX-201', name: '台账配楼培训室', type: 'ROOM', capacity: 20,
  location: '2号楼 2层 · 201', building: 'ANNEX', floor: 2, roomNumber: '201', features: [], status: 'AVAILABLE',
  isPublic: true, isExclusive: false, ...overrides
});

describe('MRP1 资源规则与台账 API 集成验证', { skip: !integrationEnabled, concurrency: false }, () => {
  before(async () => {
    await resetTestDb();
    await server.start();
    const options = await readJson(await server.request('/api/auth/options'));
    adminId = options.users.find((user: any) => user.role.includes('SYSTEM_ADMIN'))?.id;
    employeeId = options.users.find((user: any) => user.name === '李员工')?.id;
    assert.ok(adminId && employeeId);
    [admin, employee] = await Promise.all([server.login(adminId), server.login(employeeId)]);
  });

  after(async () => {
    await server.stop();
  });

  it('007 已初始化默认规则，非管理员不能读取或预检台账', async () => {
    const rules = await call('/api/rules', 'GET', admin);
    assert.equal(rules.status, 200);
    const configuration = await readJson(rules);
    assert.deepEqual(configuration.current, DEFAULT_RULE_SETTINGS);
    assert.equal(configuration.versions.length, 1);
    assert.equal((await call('/api/rules', 'GET', employee)).status, 403);
    assert.equal((await call('/api/resources/ledger/preflight', 'POST', employee, { items: [mainResource()] })).status, 403);
    assert.deepEqual(await readCollection('resourceImportBatches'), []);
  });

  it('规则发布生成不可覆盖的新版本并拒绝矛盾参数', async () => {
    const invalid = await call('/api/rules', 'PUT', admin, { settings: { smallRoomMaxCapacity: 30, mediumRoomMaxCapacity: 30 } });
    assert.equal(invalid.status, 400);
    assert.equal((await readJson(invalid)).error, 'INVALID_ROOM_CAPACITY_THRESHOLDS');
    const published = await call('/api/rules', 'PUT', admin, { settings: { departmentDailyNetMinutes: 300 } });
    assert.equal(published.status, 200, JSON.stringify(await readJson(published.clone())));
    const result = await readJson(published);
    assert.equal(result.ruleVersion.version, 2);
    assert.equal(result.ruleVersion.createdBy, adminId);
    assert.equal(result.workspace.ruleSettings.departmentDailyNetMinutes, 300);
    const versions = await readCollection<RuleVersion>('ruleVersions');
    assert.equal(versions.length, 2);
    assert.equal(versions[0].settings.departmentDailyNetMinutes, 240);
  });

  it('单资源维护保存结构化字段且永久编码不可修改', async () => {
    const created = await call('/api/resources', 'POST', admin, { resource: mainResource() });
    assert.equal(created.status, 201, JSON.stringify(await readJson(created.clone())));
    const result = await readJson(created);
    assert.equal(result.resource.building, 'MAIN');
    assert.equal(result.resource.floor, 10);
    assert.equal(result.resource.roomCategory, 'SMALL');
    const changedCode = await call('/api/resources/r-ledger-main', 'PUT', admin, { resource: mainResource({ code: 'LEDGER-NEW-CODE' }) });
    assert.equal(changedCode.status, 409);
    assert.equal((await readJson(changedCode)).error, 'RESOURCE_CODE_IMMUTABLE');
  });

  it('预检逐行报告与正式导入一致，重复导入不重复创建资源或批次', async () => {
    const items = [
      mainResource({ id: 'r-client-generated', capacity: 12 }),
      annexResource(),
      { id: 'r1', code: 'R1', name: 'Alpha 战略会议室', type: 'ROOM', capacity: 10, location: '1号楼 10层', building: 'MAIN', floor: 10, features: ['投屏显示器', '视频会议系统'], status: 'AVAILABLE', isPublic: true, isExclusive: false }
    ];
    const preflight = await call('/api/resources/ledger/preflight', 'POST', admin, { items });
    assert.equal(preflight.status, 200, JSON.stringify(await readJson(preflight.clone())));
    const report = (await readJson(preflight)).report;
    assert.deepEqual(report.items.map((item: any) => item.action), ['UPDATE', 'CREATE', 'UNCHANGED']);
    assert.equal(report.items[0].resource.id, 'r-ledger-main');
    assert.ok(report.items[0].changedFields.includes('roomCategory'));

    const invalid = await call('/api/resources/ledger/preflight', 'POST', admin, { items: [annexResource(), annexResource({ id: 'r-duplicate' })] });
    const invalidReport = (await readJson(invalid)).report;
    assert.equal(invalidReport.invalid, 2);
    assert.ok(invalidReport.items.every((item: any) => item.issues.some((issue: any) => issue.code === 'DUPLICATE_RESOURCE_CODE')));

    const imported = await call('/api/resources/ledger/import', 'POST', admin, { items });
    assert.equal(imported.status, 201, JSON.stringify(await readJson(imported.clone())));
    const importedResult = await readJson(imported);
    assert.equal(importedResult.items.length, 2);
    assert.equal(importedResult.report.creates, 1);
    assert.equal(importedResult.report.updates, 1);
    const resources = await readCollection<Resource>('resources');
    assert.equal(resources.filter(resource => resource.code === 'LEDGER-MAIN-101').length, 1);
    assert.equal(resources.find(resource => resource.code === 'LEDGER-MAIN-101')?.capacity, 12);
    assert.equal((await readCollection<ResourceImportBatch>('resourceImportBatches')).length, 1);

    const unchanged = await call('/api/resources/ledger/preflight', 'POST', admin, { items });
    assert.equal((await readJson(unchanged)).report.unchanged, 3);
    const repeated = await call('/api/resources/ledger/import', 'POST', admin, { items });
    assert.equal(repeated.status, 409);
    assert.equal((await readJson(repeated)).error, 'RESOURCE_IMPORT_NO_CHANGES');
    assert.equal((await readCollection<ResourceImportBatch>('resourceImportBatches')).length, 1);
  });

  it('正式导入按最新快照重检，预检后的预约会阻止容量下调', async () => {
    const items = [annexResource({ id: 'r-after-preflight', capacity: 1 })];
    const preflight = await call('/api/resources/ledger/preflight', 'POST', admin, { items });
    assert.equal((await readJson(preflight)).report.items[0].action, 'UPDATE');
    const start = new Date(Date.now() + 10 * 86400000);
    start.setUTCHours(10, 0, 0, 0);
    const booking = {
      id: crypto.randomUUID(), userId: employeeId, resourceId: 'r-ledger-annex', type: 'ROOM',
      startTime: start.toISOString(), endTime: new Date(start.getTime() + 3600000).toISOString(),
      status: 'PENDING', purpose: '预检后新增两人会议', participants: 2, meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL', createdAt: new Date().toISOString(),
      currentNodeIndex: 0, approvalHistory: []
    };
    const created = await call('/api/bookings', 'POST', employee, { booking });
    assert.equal(created.status, 201, JSON.stringify(await readJson(created.clone())));
    const imported = await call('/api/resources/ledger/import', 'POST', admin, { items });
    assert.equal(imported.status, 409);
    const failure = await readJson(imported);
    assert.equal(failure.error, 'RESOURCE_IMPORT_INVALID');
    assert.equal(failure.conflicts.items[0].issues[0].code, 'CAPACITY_EXCEEDED');
    const resources = await readCollection<Resource>('resources');
    assert.equal(resources.find(resource => resource.id === 'r-ledger-annex')?.capacity, 20);
    assert.equal((await readCollection<ResourceImportBatch>('resourceImportBatches')).length, 1);
  });

  it('管理员仅可删除无预约和无设备记录的资源，并保留完整审计', async () => {
    const definitions = [
      mainResource({ id: 'r-delete-empty', code: 'DELETE-EMPTY-001', name: '待删除空资源' }),
      mainResource({ id: 'r-delete-booked', code: 'DELETE-BOOKED-001', name: '有预约不可删除资源' }),
      mainResource({ id: 'r-delete-device', code: 'DELETE-DEVICE-001', name: '有设备不可删除资源' })
    ];
    for (const resource of definitions) {
      const created = await call('/api/resources', 'POST', admin, { resource });
      assert.equal(created.status, 201, JSON.stringify(await readJson(created)));
    }

    assert.equal((await call('/api/resources/r-delete-empty', 'DELETE', employee)).status, 403);
    const missing = await call('/api/resources/r-delete-missing', 'DELETE', admin);
    assert.equal(missing.status, 404);
    assert.equal((await readJson(missing)).error, 'RESOURCE_NOT_FOUND');

    const start = new Date(Date.now() + 12 * 86400000);
    start.setUTCHours(10, 0, 0, 0);
    const booking = {
      id: crypto.randomUUID(), userId: employeeId, resourceId: 'r-delete-booked', type: 'ROOM',
      startTime: start.toISOString(), endTime: new Date(start.getTime() + 3600000).toISOString(),
      status: 'PENDING', purpose: '验证资源历史关联保护', participants: 2, meetingType: 'NORMAL',
      confidentialityChoice: 'NON_CONFIDENTIAL', createdAt: new Date().toISOString(), currentNodeIndex: 0, approvalHistory: []
    };
    const booked = await call('/api/bookings', 'POST', employee, { booking });
    assert.equal(booked.status, 201, JSON.stringify(await readJson(booked)));
    const bookingConflict = await call('/api/resources/r-delete-booked', 'DELETE', admin);
    assert.equal(bookingConflict.status, 409);
    assert.equal((await readJson(bookingConflict)).error, 'RESOURCE_HAS_BOOKINGS');

    const deviceCreated = await call('/api/devices', 'POST', admin, { name: '删除保护门口屏', resourceId: 'r-delete-device' });
    assert.equal(deviceCreated.status, 201, JSON.stringify(await readJson(deviceCreated.clone())));
    const device = (await readJson(deviceCreated)).device;
    assert.equal((await call(`/api/devices/${device.id}/revoke`, 'POST', admin, {})).status, 200);
    const deviceConflict = await call('/api/resources/r-delete-device', 'DELETE', admin);
    assert.equal(deviceConflict.status, 409);
    assert.equal((await readJson(deviceConflict)).error, 'RESOURCE_HAS_DEVICES');

    const deleted = await call('/api/resources/r-delete-empty', 'DELETE', admin);
    assert.equal(deleted.status, 200, JSON.stringify(await readJson(deleted.clone())));
    const result = await readJson(deleted);
    assert.equal(result.ok, true);
    assert.equal(result.workspace.resources.some((resource: Resource) => resource.id === 'r-delete-empty'), false);
    const resources = await readCollection<Resource>('resources');
    assert.equal(resources.some(resource => resource.id === 'r-delete-empty'), false);
    assert.equal(resources.some(resource => resource.id === 'r-delete-booked'), true);
    assert.equal(resources.some(resource => resource.id === 'r-delete-device'), true);
    const serviceAreas = await readCollection<{ resourceIds: string[] }>('serviceAreas');
    assert.equal(serviceAreas.every(area => !area.resourceIds.includes('r-delete-empty')), true);
    assert.equal((await queryTestDb<any[]>('SELECT id FROM bookings WHERE resource_id = ?', ['r-delete-booked'])).length, 1);
    const devices = await readCollection<{ resourceId: string }>('devices');
    assert.equal(devices.filter(item => item.resourceId === 'r-delete-device').length, 1);
    const audits = await queryTestDb<any[]>('SELECT actor_id, details FROM audit_events WHERE action = ? AND entity_id = ?', ['RESOURCE_DELETE', 'r-delete-empty']);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actor_id, adminId);
    const details = typeof audits[0].details === 'string' ? JSON.parse(audits[0].details) : audits[0].details;
    assert.equal(details.before.code, 'DELETE-EMPTY-001');
    assert.equal(details.before.name, '待删除空资源');
    assert.equal(details.after, null);
  });

  it('备份包含服务与使用事实，并兼容版本 2、3 和 4 恢复', async () => {
    const backupResponse = await call('/api/backup', 'GET', admin);
    assert.equal(backupResponse.status, 200);
    const backup = await readJson(backupResponse);
    assert.equal(backup.schemaVersion, 7);
    assert.equal(backup.collections.ruleVersions.length, 2);
    assert.equal(backup.collections.resourceImportBatches.length, 1);
    assert.ok(backup.collections.approvalRuleSetVersions.length >= 1);
    assert.ok(Array.isArray(backup.collections.confidentialWhitelist));
    assert.ok(Array.isArray(backup.collections.confidentialityAuthorizations));
    assert.ok(Array.isArray(backup.collections.confidentialAccessGrants));
    for (const key of ['serviceCatalog', 'serviceAreas', 'serviceShifts', 'serviceInspections', 'checkInEvents', 'usageFacts', 'usageAppeals']) {
      assert.ok(Array.isArray(backup.collections[key]), key);
    }
    const restoredV7 = await call('/api/backup/restore', 'POST', admin, backup);
    assert.equal(restoredV7.status, 200, JSON.stringify(await readJson(restoredV7.clone())));

    const legacyV4 = structuredClone(backup);
    legacyV4.schemaVersion = 4;
    for (const key of ['serviceCatalog', 'serviceAreas', 'serviceShifts', 'serviceInspections', 'checkInEvents', 'usageFacts', 'usageAppeals', 'devices', 'exceptionActions']) delete legacyV4.collections[key];
    const restoredV4 = await call('/api/backup/restore', 'POST', admin, legacyV4);
    assert.equal(restoredV4.status, 200, JSON.stringify(await readJson(restoredV4.clone())));

    const legacyV3 = structuredClone(legacyV4);
    legacyV3.schemaVersion = 3;
    for (const key of ['approvalRuleSetVersions', 'confidentialWhitelist', 'confidentialityAuthorizations', 'confidentialAccessGrants']) delete legacyV3.collections[key];
    const restoredV3 = await call('/api/backup/restore', 'POST', admin, legacyV3);
    assert.equal(restoredV3.status, 200, JSON.stringify(await readJson(restoredV3.clone())));

    const legacy = structuredClone(legacyV3);
    legacy.schemaVersion = 2;
    delete legacy.collections.ruleVersions;
    delete legacy.collections.resourceImportBatches;
    const restoredV2 = await call('/api/backup/restore', 'POST', admin, legacy);
    assert.equal(restoredV2.status, 200, JSON.stringify(await readJson(restoredV2.clone())));
    const rules = await readJson(await call('/api/rules', 'GET', admin));
    assert.equal(rules.versions.length, 1);
    assert.deepEqual(rules.current, DEFAULT_RULE_SETTINGS);
    assert.deepEqual(await readCollection('resourceImportBatches'), []);
  });
});

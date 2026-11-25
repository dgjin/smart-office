import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import {
  DEFAULT_RULE_SETTINGS,
  INITIAL_BOOKINGS,
  INITIAL_DEPARTMENTS,
  INITIAL_ROLES,
  INITIAL_USERS,
  SERVICE_TYPES
} from '../constants.ts';
import { applyInitialOfficeState, assertInitialStateEmpty } from '../server/bootstrap.ts';
import { normalizeResource } from '../server/db.ts';
import { validateHq3dLayout, type Hq3dSeedData } from '../server/hq3dLayout.ts';
import type { OfficeDb } from '../server/tools.ts';
import type { Resource } from '../types.ts';

const meetingRoomPath = new URL('../server/data/meeting-rooms.json', import.meta.url);
const layoutPath = new URL('../server/data/hq3d-floorplan.json', import.meta.url);

describe('正式系统基础数据基线', () => {
  it('28间正式会议室均可规范化且不含演示资源或预约', async () => {
    const source = JSON.parse(await readFile(meetingRoomPath, 'utf8')) as Resource[];
    const resources = source.map(resource => normalizeResource(resource, undefined, DEFAULT_RULE_SETTINGS));
    assert.equal(resources.length, 28);
    assert.equal(resources.filter(resource => resource.status === 'AVAILABLE').length, 18);
    assert.equal(resources.filter(resource => resource.status === 'PENDING').length, 10);
    assert.ok(resources.every(resource => resource.type === 'ROOM'));
    for (const key of ['id', 'code', 'name'] as const) {
      assert.equal(new Set(resources.map(resource => resource[key])).size, 28);
    }
    assert.ok(!resources.some(resource => ['r1', 'r2', 'd1'].includes(resource.id)));
    assert.deepEqual(INITIAL_BOOKINGS, []);
  });

  it('总部3D包含2栋24层427个空间，其中203个为办公室类空间', async () => {
    const data = JSON.parse(await readFile(layoutPath, 'utf8')) as Hq3dSeedData;
    const rooms = data.buildings.flatMap(building => building.floors.flatMap(floor => floor.rooms));
    assert.equal(data.buildings.length, 2);
    assert.equal(data.buildings.reduce((total, building) => total + building.floors.length, 0), 24);
    assert.equal(rooms.length, 427);
    assert.equal(validateHq3dLayout(data).size, 427);
    assert.equal(rooms.filter(room => ['office', 'open', 'exec'].includes(room.cat)).length, 203);
  });

  it('初始化生成默认组织、预约规则、动态审批、13类会务目录和默认责任区', async () => {
    const source = JSON.parse(await readFile(meetingRoomPath, 'utf8')) as Resource[];
    const db: OfficeDb = {};
    applyInitialOfficeState(db, source.map(resource => normalizeResource(resource, undefined, DEFAULT_RULE_SETTINGS)));
    assert.deepEqual(db.roles, INITIAL_ROLES);
    assert.deepEqual(db.users, INITIAL_USERS);
    assert.deepEqual(db.departments, INITIAL_DEPARTMENTS);
    assert.deepEqual(db.bookings, []);
    assert.deepEqual(db.ruleVersions?.[0].settings, DEFAULT_RULE_SETTINGS);
    assert.equal(db.workflowVersions?.length, 4);
    assert.deepEqual(db.approvalRuleSetVersions?.[0].rules.map(rule => rule.id).sort(), [
      'confidential', 'continuous-over-3-days', 'exclusive', 'heavy-service', 'important'
    ]);
    assert.equal(db.serviceCatalog?.length, SERVICE_TYPES.length);
    assert.deepEqual(db.serviceAreas, [{
      id: 'area-default', name: '默认会务责任区', resourceIds: source.map(resource => resource.id)
    }]);
    for (const key of [
      'workOrders', 'notifications', 'resourceImportBatches', 'approvalDelegates', 'confidentialWhitelist',
      'confidentialityAuthorizations', 'confidentialAccessGrants', 'serviceShifts', 'serviceInspections',
      'checkInEvents', 'usageFacts', 'usageAppeals', 'devices', 'exceptionActions', 'organizationSyncBatches',
      'externalCallbacks', 'externalCompensations', 'accessAuthorizationFacts', 'integrationDeliveries'
    ] as const) {
      assert.deepEqual(db[key], []);
    }
  });

  it('任何既有业务集合都会阻止初始化', () => {
    assert.doesNotThrow(() => assertInitialStateEmpty({}));
    assert.doesNotThrow(() => assertInitialStateEmpty({ users: [], resources: [], notifications: [] }));
    assert.throws(() => assertInitialStateEmpty({ resources: [{} as Resource] }), /只允许在空业务数据库中执行初始化/);
    assert.throws(() => assertInitialStateEmpty({ integrationDeliveries: [{} as never] }), /只允许在空业务数据库中执行初始化/);
  });
});

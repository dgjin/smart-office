import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { closeDbPool, readSnapshot } from '../../server/db.ts';
import { integrationEnabled, queryTestDb, resetTestDb } from '../support/testServer.ts';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const runInit = () => exec(process.execPath, ['scripts/db/init.ts'], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'development' },
  timeout: 30_000
});

const readStoredState = async () => ({
  revision: await queryTestDb<any[]>('SELECT revision FROM office_snapshot_meta WHERE id = 1'),
  collections: await queryTestDb<any[]>('SELECT state_key, payload FROM office_state ORDER BY state_key'),
  rooms: await queryTestDb<any[]>('SELECT uid, building_id, floor_no, label, is_active FROM hq3d_room ORDER BY uid')
});

describe('正式空库初始化', { skip: !integrationEnabled, concurrency: false }, () => {
  before(async () => {
    await resetTestDb('empty');
  });

  after(async () => {
    await resetTestDb();
    await closeDbPool();
  });

  it('一次写入正式资源、默认配置和总部3D，重复执行拒绝且不改变数据', async () => {
    const { stdout } = await runInit();
    assert.match(stdout, /会议室 28 · 楼栋 2 · 楼层 24 · 空间 427/);

    const { db, revision } = await readSnapshot();
    assert.equal(revision, 2);
    assert.equal(db.resources?.length, 28);
    assert.equal(db.resources?.filter(resource => resource.status === 'AVAILABLE').length, 18);
    assert.equal(db.resources?.filter(resource => resource.status === 'PENDING').length, 10);
    assert.equal(db.bookings?.length, 0);
    assert.equal(db.roles?.length, 7);
    assert.equal(db.users?.length, 3);
    assert.equal(db.departments?.length, 7);
    assert.equal(db.ruleVersions?.length, 1);
    assert.equal(db.workflowVersions?.length, 4);
    assert.equal(db.approvalRuleSetVersions?.[0].rules.length, 5);
    assert.equal(db.serviceCatalog?.length, 13);
    assert.equal(db.serviceAreas?.[0].resourceIds.length, 28);

    const counts = await queryTestDb<any[]>(`SELECT
      (SELECT COUNT(*) FROM hq3d_building) AS buildings,
      (SELECT COUNT(*) FROM hq3d_floor) AS floors,
      (SELECT COUNT(*) FROM hq3d_room) AS rooms,
      (SELECT COUNT(*) FROM hq3d_room WHERE is_active = 1) AS active_rooms,
      (SELECT COUNT(*) FROM hq3d_room WHERE category IN ('office', 'open', 'exec')) AS office_rooms,
      (SELECT COUNT(*) FROM bookings) AS bookings`);
    assert.deepEqual(counts.map(row => ({
      buildings: Number(row.buildings), floors: Number(row.floors), rooms: Number(row.rooms),
      activeRooms: Number(row.active_rooms), officeRooms: Number(row.office_rooms), bookings: Number(row.bookings)
    })), [{ buildings: 2, floors: 24, rooms: 427, activeRooms: 427, officeRooms: 203, bookings: 0 }]);

    const beforeRetry = await readStoredState();
    await assert.rejects(runInit(), error => {
      assert.match(String((error as { stderr?: string }).stderr || error), /只允许在空业务数据库中执行初始化/);
      return true;
    });
    assert.deepEqual(await readStoredState(), beforeRetry);
  });
});

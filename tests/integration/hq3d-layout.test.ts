import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDbPool, getDbPool } from '../../server/db.ts';
import { getHq3dSnapshot } from '../../server/hq3d.ts';
import { createExecutor } from '../../server/tools.ts';
import { seedHq3dLayout, type Hq3dSeedData, type Hq3dSeedRoom } from '../../server/hq3dLayout.ts';
import { integrationEnabled, queryTestDb } from '../support/testServer.ts';

const firstUid = 'test#1F#_#会议室';
const secondUid = 'test#1F#_#会议室#2';
const room = (uid: string): Hq3dSeedRoom => ({
  uid,
  no: '',
  cat: 'meeting',
  label: '会议室',
  dept: '',
  person: '',
  notes: '',
  lines: ['会议室'],
  nx: 0,
  nz: 0,
  nw: 0.4,
  nd: 0.4,
  frac: 0.16
});
const layout = (): Hq3dSeedData => ({
  buildings: [{ id: 'test', name: '测试楼', aspect: 1, aspAll: [1], floors: [{ sheet: '测试一层', rooms: [room(firstUid), room(secondUid)] }] }]
});
const seed = async (data: Hq3dSeedData) => {
  const conn = await getDbPool().getConnection();
  try {
    return await seedHq3dLayout(conn, data);
  } finally {
    conn.release();
  }
};
const clearHq3d = async () => {
  for (const table of ['hq3d_room_resource', 'hq3d_room_disposition', 'hq3d_room_maintenance', 'hq3d_room_profile', 'hq3d_room', 'hq3d_floor', 'hq3d_building']) {
    await queryTestDb(`DELETE FROM ${table}`);
  }
};

describe('C-07 总部3D稳定UID与差异重建', { skip: !integrationEnabled, concurrency: false }, () => {
  before(clearHq3d);
  after(async () => {
    await clearHq3d();
    await closeDbPool();
  });

  it('重复种子、同名调序和改名保持UID及关联资料', async () => {
    assert.deepEqual(await seed(layout()), { buildings: 1, floors: 1, rooms: 2, retired: 0 });
    assert.deepEqual(await seed(layout()), { buildings: 1, floors: 1, rooms: 2, retired: 0 });

    await queryTestDb('INSERT INTO hq3d_room_profile (room_uid, label, history) VALUES (?, ?, ?)', [firstUid, '业务覆盖名称', '[]']);
    await queryTestDb(
      `INSERT INTO hq3d_room_maintenance (id, room_uid, type, title, note, reporter, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mnt-stable-uid', firstUid, '其他', '稳定UID验证', '', '测试', 'open', new Date(), new Date()]
    );

    const changed = layout();
    changed.buildings[0].floors[0].rooms.reverse();
    const renamed = changed.buildings[0].floors[0].rooms.find(item => item.uid === firstUid)!;
    renamed.label = '改名后的会议室';
    renamed.lines = ['改名后的会议室'];
    assert.deepEqual(await seed(changed), { buildings: 1, floors: 1, rooms: 2, retired: 0 });

    const rooms = await queryTestDb<any[]>('SELECT uid, label, sort_index FROM hq3d_room ORDER BY uid');
    assert.deepEqual(rooms.map(item => item.uid).sort(), [firstUid, secondUid].sort());
    assert.equal(rooms.find(item => item.uid === firstUid)?.label, '改名后的会议室');
    assert.equal(rooms.find(item => item.uid === firstUid)?.sort_index, 1);
    assert.equal((await queryTestDb<any[]>('SELECT room_uid FROM hq3d_room_profile WHERE room_uid = ?', [firstUid])).length, 1);
    assert.equal((await queryTestDb<any[]>('SELECT room_uid FROM hq3d_room_maintenance WHERE room_uid = ?', [firstUid])).length, 1);
  });

  it('撤销空间仅停用且保留关联资料，恢复时沿用原UID', async () => {
    const removed = layout();
    removed.buildings[0].floors[0].rooms = removed.buildings[0].floors[0].rooms.filter(item => item.uid !== firstUid);
    assert.deepEqual(await seed(removed), { buildings: 1, floors: 1, rooms: 1, retired: 1 });

    const retired = await queryTestDb<any[]>('SELECT uid, is_active, retired_at FROM hq3d_room WHERE uid = ?', [firstUid]);
    assert.equal(retired.length, 1);
    assert.equal(Boolean(retired[0].is_active), false);
    assert.ok(retired[0].retired_at);
    assert.equal((await queryTestDb<any[]>('SELECT room_uid FROM hq3d_room_profile WHERE room_uid = ?', [firstUid])).length, 1);
    assert.equal((await queryTestDb<any[]>('SELECT room_uid FROM hq3d_room_maintenance WHERE room_uid = ?', [firstUid])).length, 1);
    const snapshot = await getHq3dSnapshot();
    assert.ok(!snapshot.buildings.flatMap(building => building.floors.flatMap(floor => floor.rooms)).some(item => item.uid === firstUid));

    assert.deepEqual(await seed(layout()), { buildings: 1, floors: 1, rooms: 2, retired: 0 });
    const restored = await queryTestDb<any[]>('SELECT uid, is_active, retired_at FROM hq3d_room WHERE uid = ?', [firstUid]);
    assert.equal(Boolean(restored[0].is_active), true);
    assert.equal(restored[0].retired_at, null);
    assert.equal((await queryTestDb<any[]>('SELECT room_uid FROM hq3d_room_profile WHERE room_uid = ?', [firstUid])).length, 1);
    assert.equal((await queryTestDb<any[]>('SELECT room_uid FROM hq3d_room_maintenance WHERE room_uid = ?', [firstUid])).length, 1);
  });

  it('智问助手默认工具从隔离MySQL读取当前房间资料并生成定位动作', async () => {
    const executor = createExecutor({
      users: [{ id: 'hq3d-reader', name: '空间查询员', email: 'hq3d@test.local', role: ['EMPLOYEE'], department: '测试部' }]
    }, { userId: 'hq3d-reader', now: new Date('2026-11-24T12:00:00+08:00') });
    const result = await executor.query_hq3d_spaces({ building: '测试楼', keyword: '业务覆盖名称' });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.data.total, 1);
    assert.equal(result.data.rooms[0].uid, firstUid);
    assert.equal(result.data.rooms[0].label, '业务覆盖名称');
    assert.equal(result.data.rooms[0].maintenance.open, 1);
    assert.equal(result.action?.type, 'NAVIGATE');
    if (result.action?.type === 'NAVIGATE') {
      assert.deepEqual(result.action.hq3d, { buildingId: 'test', floorNo: 1, roomUid: firstUid });
    }
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { closeDbPool, getDbPool } from '../../server/db.ts';
import { seedHq3dLayout, type Hq3dSeedData, type Hq3dSeedRoom } from '../../server/hq3dLayout.ts';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
let admin: Awaited<ReturnType<TestServer['login']>>;
let employee: Awaited<ReturnType<TestServer['login']>>;
let adminId = '';
let employeeId = '';

const readJson = async (response: Response) => response.json() as Promise<any>;
const call = (pathname: string, method: string, session: Awaited<ReturnType<TestServer['login']>>, body?: unknown) =>
  server.request(pathname, { method, headers: { Cookie: session.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
const exportLayout = async (buildingId: string, floorNo?: number) => {
  const params = new URLSearchParams({ scope: floorNo === undefined ? 'BUILDING' : 'FLOOR', buildingId });
  if (floorNo !== undefined) params.set('floorNo', String(floorNo));
  const response = await call(`/api/hq3d/layout/export?${params}`, 'GET', admin);
  assert.equal(response.status, 200, JSON.stringify(await readJson(response.clone())));
  return readJson(response);
};
const preflight = async (layout: unknown) => {
  const response = await call('/api/hq3d/layout/preflight', 'POST', admin, { layout });
  assert.equal(response.status, 200, JSON.stringify(await readJson(response.clone())));
  return (await readJson(response)).report;
};
const importLayout = async (layout: unknown, baselineHash: string) =>
  call('/api/hq3d/layout/import', 'POST', admin, { layout, baselineHash });
const parseUpload = async (fileName: string, buffer: Buffer, scope?: unknown) =>
  call('/api/hq3d/layout/parse', 'POST', admin, { fileName, contentBase64: buffer.toString('base64'), scope });
const createNativeFloorplan = async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('封皮').getCell('B4').value = '999封皮杂值';
  const addFloor = (name: string, rooms: Array<[string, string]>, printArea: string | undefined = 'B1:J25') => {
    const sheet = workbook.addWorksheet(name);
    for (let column = 2; column <= 10; column += 1) sheet.getColumn(column).width = 10;
    for (let row = 4; row <= 24; row += 1) sheet.getRow(row).height = 20;
    sheet.mergeCells('B1:J2');
    sheet.getCell('B1').value = name;
    rooms.forEach(([range, value]) => {
      sheet.mergeCells(range);
      sheet.getCell(range.split(':')[0]).value = value;
    });
    if (printArea) sheet.pageSetup.printArea = printArea;
    return sheet;
  };
  const first = addFloor('配楼一层', [['B4:D6', '101\n配楼101'], ['F4:G6', '102\n配楼102']]);
  first.getCell('K9').value = '999打印区域外杂值';
  addFloor('配楼二层 (部分)', [['B4:D6', '999\n不应导入']]);
  addFloor('配楼二层（全）', [['B4:D6', '201\n配楼201'], ['F4:G6', '202\n配楼202']], undefined);
  return Buffer.from(await workbook.xlsx.writeBuffer());
};
const room = (uid: string, label: string): Hq3dSeedRoom => ({
  uid,
  no: uid.split('#').at(-2) || '',
  cat: 'meeting',
  label,
  dept: '综合管理部',
  person: '',
  notes: '',
  lines: [label],
  nx: 0.05,
  nz: 0.05,
  nw: 0.4,
  nd: 0.4,
  frac: 0.16
});
const fixture = (): Hq3dSeedData => ({
  buildings: [
    {
      id: 'main', name: '测试主楼', aspect: 1.4, aspAll: [1.4, 1.4],
      floors: [
        { sheet: '主楼一层', rooms: [room('main#1F#101#会议室', '主楼101'), room('main#1F#102#会议室', '主楼102')] },
        { sheet: '主楼二层', rooms: [room('main#2F#201#会议室', '主楼201'), room('main#2F#202#会议室', '主楼202')] }
      ]
    },
    {
      id: 'annex', name: '测试配楼', aspect: 1.2, aspAll: [1.2, 1.2],
      floors: [
        { sheet: '配楼一层', rooms: [room('annex#1F#101#会议室', '配楼101'), room('annex#1F#102#会议室', '配楼102')] },
        { sheet: '配楼二层', rooms: [room('annex#2F#201#会议室', '配楼201'), room('annex#2F#202#会议室', '配楼202')] }
      ]
    }
  ]
});
const clearHq3d = async () => {
  for (const table of ['hq3d_room_resource', 'hq3d_room_disposition', 'hq3d_room_maintenance', 'hq3d_room_profile', 'hq3d_room', 'hq3d_floor', 'hq3d_building']) {
    await queryTestDb(`DELETE FROM ${table}`);
  }
};
const activeRooms = async (buildingId: string, floorNo?: number) => queryTestDb<any[]>(
  `SELECT uid, floor_no, label, sort_index FROM hq3d_room
   WHERE building_id = ? AND is_active = 1${floorNo === undefined ? '' : ' AND floor_no = ?'}
   ORDER BY floor_no, sort_index, uid`,
  floorNo === undefined ? [buildingId] : [buildingId, floorNo]
);

before(async () => {
  if (!integrationEnabled) return;
  await resetTestDb();
  await clearHq3d();
  const conn = await getDbPool().getConnection();
  try {
    await seedHq3dLayout(conn, fixture());
  } finally {
    conn.release();
  }
  await server.start();
  const options = await readJson(await server.request('/api/auth/options'));
  adminId = options.users.find((user: any) => user.role.includes('SYSTEM_ADMIN'))?.id;
  employeeId = options.users.find((user: any) => user.name === '李员工')?.id;
  assert.ok(adminId && employeeId);
  [admin, employee] = await Promise.all([server.login(adminId), server.login(employeeId)]);
});

after(async () => {
  if (!integrationEnabled) return;
  await server.stop();
  await clearHq3d();
  await closeDbPool();
});

describe('总部3D整栋与单层布局导入', { skip: !integrationEnabled, concurrency: false }, () => {
  it('仅系统管理员可导出、预检和导入，快照按角色下发能力', async () => {
    const adminSnapshot = await readJson(await call('/api/hq3d/snapshot', 'GET', admin));
    const employeeSnapshot = await readJson(await call('/api/hq3d/snapshot', 'GET', employee));
    assert.equal(adminSnapshot.capabilities.canManageLayout, true);
    assert.equal(employeeSnapshot.capabilities.canManageLayout, false);

    const layout = await exportLayout('main', 1);
    assert.equal(layout.scope.kind, 'FLOOR');
    assert.equal(layout.building.floors[0].rooms.length, 2);
    assert.equal((await call('/api/hq3d/layout/export?scope=FLOOR&buildingId=main&floorNo=1', 'GET', employee)).status, 403);
    assert.equal((await call('/api/hq3d/layout/preflight', 'POST', employee, { layout })).status, 403);
    assert.equal((await call('/api/hq3d/layout/import', 'POST', employee, { layout, baselineHash: '0'.repeat(64) })).status, 403);
  });

  it('单层更新不影响邻层和其他楼栋，停用恢复保留资料、维护与稳定UID', async () => {
    const retainedUid = 'main#1F#102#会议室';
    await queryTestDb('INSERT INTO hq3d_room_profile (room_uid, label, history) VALUES (?, ?, ?)', [retainedUid, '业务覆盖名称', '[]']);
    await queryTestDb(
      `INSERT INTO hq3d_room_maintenance (id, room_uid, type, title, note, reporter, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mnt-layout-import', retainedUid, '其他', '布局导入关联保留', '', '测试', 'open', new Date(), new Date()]
    );
    const original = await exportLayout('main', 1);
    const neighborBefore = await activeRooms('main', 2);
    const annexBefore = await activeRooms('annex');
    const changed = structuredClone(original);
    changed.building.floors[0].rooms[0].label = '主楼101已更新';
    changed.building.floors[0].rooms[0].lines = ['主楼101已更新'];
    changed.building.floors[0].rooms = changed.building.floors[0].rooms.filter((item: any) => item.uid !== retainedUid);
    changed.building.floors[0].rooms.push(room('main#1F#103#会议室', '主楼103'));

    const report = await preflight(changed);
    assert.equal(report.ok, true);
    assert.deepEqual(report.counts, { created: 1, updated: 1, unchanged: 0, restored: 0, retired: 1 });
    const imported = await importLayout(changed, report.baselineHash);
    assert.equal(imported.status, 200, JSON.stringify(await readJson(imported.clone())));
    assert.equal((await activeRooms('main', 1)).length, 2);
    assert.equal((await queryTestDb<any[]>('SELECT is_active FROM hq3d_room WHERE uid = ?', [retainedUid]))[0].is_active, 0);
    assert.deepEqual(await activeRooms('main', 2), neighborBefore);
    assert.deepEqual(await activeRooms('annex'), annexBefore);
    assert.equal((await queryTestDb<any[]>('SELECT label FROM hq3d_room_profile WHERE room_uid = ?', [retainedUid]))[0].label, '业务覆盖名称');
    assert.equal((await queryTestDb<any[]>('SELECT id FROM hq3d_room_maintenance WHERE room_uid = ?', [retainedUid])).length, 1);
    assert.equal((await queryTestDb<any[]>("SELECT id FROM audit_events WHERE action = 'HQ3D_LAYOUT_IMPORT'")).length, 1);

    const restored = await exportLayout('main', 1);
    restored.building.floors[0].rooms.push(original.building.floors[0].rooms.find((item: any) => item.uid === retainedUid));
    const restoreReport = await preflight(restored);
    assert.equal(restoreReport.counts.restored, 1);
    assert.equal(restoreReport.counts.retired, 0);
    assert.equal((await importLayout(restored, restoreReport.baselineHash)).status, 200);
    assert.equal((await queryTestDb<any[]>('SELECT is_active, retired_at FROM hq3d_room WHERE uid = ?', [retainedUid]))[0].is_active, 1);
    assert.equal((await queryTestDb<any[]>('SELECT room_uid FROM hq3d_room_profile WHERE room_uid = ?', [retainedUid])).length, 1);
    assert.equal((await queryTestDb<any[]>('SELECT room_uid FROM hq3d_room_maintenance WHERE room_uid = ?', [retainedUid])).length, 1);
    assert.equal((await queryTestDb<any[]>("SELECT id FROM audit_events WHERE action = 'HQ3D_LAYOUT_IMPORT'")).length, 2);
  });

  it('阻止已映射房间停用、跨范围UID移动和过期预检导入', async () => {
    const mappedUid = 'main#1F#102#会议室';
    await queryTestDb(
      `INSERT INTO hq3d_room_resource
       (room_uid, resource_id, plan_id, decision_ref, decision_basis, note, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [mappedUid, 'resource-layout-test', 'test-plan', 'C-01', 'TEST', '', adminId, new Date(), adminId, new Date()]
    );
    const layout = await exportLayout('main', 1);
    layout.building.floors[0].rooms = layout.building.floors[0].rooms.filter((item: any) => item.uid !== mappedUid);
    const mappedReport = await preflight(layout);
    assert.equal(mappedReport.ok, false);
    assert.ok(mappedReport.errors.some((item: any) => item.code === 'HQ3D_LAYOUT_MAPPED_ROOM_RETIREMENT'));
    const mappedImport = await importLayout(layout, mappedReport.baselineHash);
    assert.equal(mappedImport.status, 400);
    assert.equal((await readJson(mappedImport)).error, 'HQ3D_LAYOUT_MAPPED_ROOM_RETIREMENT');
    assert.equal((await queryTestDb<any[]>('SELECT is_active FROM hq3d_room WHERE uid = ?', [mappedUid]))[0].is_active, 1);
    await queryTestDb('DELETE FROM hq3d_room_resource WHERE room_uid = ?', [mappedUid]);

    const crossScope = await exportLayout('main', 1);
    crossScope.building.floors[0].rooms[0].uid = 'main#2F#201#会议室';
    const crossReport = await preflight(crossScope);
    assert.equal(crossReport.ok, false);
    assert.ok(crossReport.errors.some((item: any) => item.code === 'HQ3D_LAYOUT_UID_OUTSIDE_SCOPE'));

    const stale = await exportLayout('main', 1);
    stale.building.floors[0].rooms[0].label = '过期预检测试';
    stale.building.floors[0].rooms[0].lines = ['过期预检测试'];
    const staleReport = await preflight(stale);
    await queryTestDb('UPDATE hq3d_room SET notes = ? WHERE uid = ?', ['预检后发生变化', stale.building.floors[0].rooms[0].uid]);
    const staleImport = await importLayout(stale, staleReport.baselineHash);
    assert.equal(staleImport.status, 409);
    assert.equal((await readJson(staleImport)).error, 'HQ3D_LAYOUT_BASELINE_CHANGED');
  });

  it('整栋导入允许楼内移动并更新元数据，但不影响其他楼栋或创建预约资源', async () => {
    const layout = await exportLayout('main');
    const annexBefore = await activeRooms('annex');
    const resourcesBefore = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'resources'");
    layout.building.name = '测试主楼新名称';
    layout.building.floors[0].sheet = '主楼一层已更新';
    const moved = layout.building.floors[0].rooms.pop();
    assert.ok(moved);
    layout.building.floors[1].rooms.push(moved);
    const report = await preflight(layout);
    assert.equal(report.ok, true);
    assert.equal(report.metadataChanged, true);
    assert.equal(report.counts.updated, 1);
    const imported = await importLayout(layout, report.baselineHash);
    assert.equal(imported.status, 200, JSON.stringify(await readJson(imported.clone())));
    assert.equal((await queryTestDb<any[]>('SELECT name FROM hq3d_building WHERE id = ?', ['main']))[0].name, '测试主楼新名称');
    assert.equal((await queryTestDb<any[]>('SELECT floor_no FROM hq3d_room WHERE uid = ?', [moved.uid]))[0].floor_no, 2);
    assert.deepEqual(await activeRooms('annex'), annexBefore);
    assert.deepEqual(await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'resources'"), resourcesBefore);

    const missingFloor = await exportLayout('main');
    missingFloor.building.floors.pop();
    missingFloor.building.aspAll.pop();
    const missingReport = await preflight(missingFloor);
    assert.equal(missingReport.ok, false);
    assert.ok(missingReport.errors.some((item: any) => item.code === 'HQ3D_LAYOUT_FLOOR_SET_CHANGED'));
  });

  it('空房间数组可清空未映射楼层且不产生空集合SQL错误', async () => {
    const layout = await exportLayout('annex', 2);
    layout.building.floors[0].rooms = [];
    const report = await preflight(layout);
    assert.equal(report.ok, true);
    assert.equal(report.counts.retired, 2);
    const imported = await importLayout(layout, report.baselineHash);
    assert.equal(imported.status, 200, JSON.stringify(await readJson(imported.clone())));
    assert.deepEqual(await activeRooms('annex', 2), []);
    assert.equal((await activeRooms('annex', 1)).length, 2);
    assert.equal((await activeRooms('main')).length, 5);
  });

  it('Excel模板可导出、编辑并通过统一解析完成预检、导入和恢复', async () => {
    const exported = await call('/api/hq3d/layout/export?scope=FLOOR&buildingId=annex&floorNo=1&format=xlsx', 'GET', admin);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type') || '', /spreadsheetml\.sheet/);
    const originalBuffer = Buffer.from(await exported.arrayBuffer());
    assert.equal(originalBuffer.subarray(0, 2).toString(), 'PK');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(originalBuffer);
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['布局信息', '楼层', '房间', '填写说明']);
    workbook.getWorksheet('房间')!.addRow([
      1, 'annex#1F#103#Excel验收室', '103', 'meeting', 'Excel验收室', '验收测试', '', '隔离测试新增',
      'Excel验收室', 0.55, 0.1, 0.2, 0.2, 0.1
    ]);
    const changedBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsedResponse = await parseUpload('annex-1f.xlsx', changedBuffer);
    assert.equal(parsedResponse.status, 200, JSON.stringify(await readJson(parsedResponse.clone())));
    const parsed = await readJson(parsedResponse);
    assert.equal(parsed.sourceKind, 'EXCEL');
    assert.equal(parsed.layout.building.floors[0].rooms.length, 3);

    const report = await preflight(parsed.layout);
    assert.equal(report.ok, true);
    assert.equal(report.counts.created, 1);
    assert.equal((await importLayout(parsed.layout, report.baselineHash)).status, 200);
    assert.equal((await activeRooms('annex', 1)).length, 3);

    const restoredResponse = await parseUpload('annex-1f-original.xlsx', originalBuffer);
    const restored = await readJson(restoredResponse);
    const restoreReport = await preflight(restored.layout);
    assert.equal(restoreReport.counts.retired, 1);
    assert.equal((await importLayout(restored.layout, restoreReport.baselineHash)).status, 200);
    assert.equal((await activeRooms('annex', 1)).length, 2);
  });

  it('原生楼层图Excel支持整栋与单层识别、版本选择和既有UID预检', async () => {
    const buffer = await createNativeFloorplan();
    const singleResponse = await parseUpload('native-floorplan.xlsx', buffer, { kind: 'FLOOR', buildingId: 'annex', floorNo: 1 });
    assert.equal(singleResponse.status, 200, JSON.stringify(await readJson(singleResponse.clone())));
    const single = await readJson(singleResponse);
    assert.equal(single.sourceKind, 'EXCEL');
    assert.equal(single.layout.building.floors.length, 1);
    assert.equal(single.recognizedRooms, 2);
    assert.equal(single.createdRooms, 0);
    assert.deepEqual(single.layout.building.floors[0].rooms.map((item: any) => item.uid), [
      'annex#1F#101#会议室', 'annex#1F#102#会议室'
    ]);
    assert.ok(single.layout.building.floors[0].rooms.every((item: any) => item.no !== '999'));
    const singleReport = await preflight(single.layout);
    assert.equal(singleReport.ok, true);
    assert.equal(singleReport.counts.created, 0);
    assert.equal(singleReport.counts.retired, 0);

    const buildingResponse = await parseUpload('native-floorplan.xlsx', buffer, { kind: 'BUILDING', buildingId: 'annex' });
    assert.equal(buildingResponse.status, 200, JSON.stringify(await readJson(buildingResponse.clone())));
    const building = await readJson(buildingResponse);
    assert.equal(building.layout.building.floors.length, 2);
    assert.equal(building.layout.building.floors[1].sheet, '配楼二层（全）');
    assert.deepEqual(building.layout.building.floors[1].rooms.map((item: any) => item.no), ['201', '202']);
    assert.match(building.notices.join(''), /2F选用“配楼二层（全）”/);
    const buildingReport = await preflight(building.layout);
    assert.equal(buildingReport.ok, true);

    const wrongBuilding = await parseUpload('native-floorplan.xlsx', buffer, { kind: 'BUILDING', buildingId: 'main' });
    assert.equal(wrongBuilding.status, 400);
    assert.equal((await readJson(wrongBuilding)).error, 'INVALID_HQ3D_EXCEL');
  });
  it('统一上传接口校验管理员权限、图片范围与真实文件格式', async () => {
    const body = { fileName: 'fake.png', contentBase64: Buffer.from('not a png').toString('base64'), scope: { kind: 'FLOOR', buildingId: 'annex', floorNo: 1 } };
    assert.equal((await call('/api/hq3d/layout/parse', 'POST', employee, body)).status, 403);
    const invalid = await parseUpload('fake.png', Buffer.from('not a png'), body.scope);
    assert.equal(invalid.status, 400);
    assert.equal((await readJson(invalid)).error, 'HQ3D_LAYOUT_IMAGE_FORMAT');
    const building = await parseUpload('building.png', Buffer.from('not a png'), { kind: 'BUILDING', buildingId: 'annex' });
    assert.equal(building.status, 400);
    assert.equal((await readJson(building)).error, 'HQ3D_LAYOUT_IMAGE_SCOPE');
  });
});

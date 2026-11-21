import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import type { Booking } from '../../types.ts';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
type Session = Awaited<ReturnType<TestServer['login']>>;
let admin: Session;
let requester: Session;
let frontDesk: Session;
let other: Session;
const frontDeskId = 'u-mrp6-front-desk';
const otherId = 'u-mrp6-other';

const call = (pathname: string, method: string, session: Session, body?: unknown) => server.request(pathname, {
  method, headers: { Cookie: session.cookie }, body: body === undefined ? undefined : JSON.stringify(body)
});
const json = async (response: Response) => response.json() as Promise<any>;
const expectJson = async (response: Response, status: number) => {
  const body = await json(response);
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
};
const insertBooking = async (booking: Booking) => {
  await queryTestDb(`INSERT INTO bookings (id, user_id, resource_id, start_time, end_time, status, payload, created_at, schedule_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [booking.id, booking.userId, booking.resourceId, new Date(booking.startTime), new Date(booking.endTime), booking.status, JSON.stringify(booking), new Date(booking.createdAt), booking.scheduleVersion || 1]);
};
const booking = (input: Partial<Booking> & Pick<Booking, 'id' | 'userId' | 'resourceId' | 'startTime' | 'endTime' | 'purpose'>): Booking => ({
  type: 'ROOM', status: 'APPROVED', participants: 4, createdAt: new Date().toISOString(), currentNodeIndex: 1,
  approvalHistory: [], attendeeIds: [], meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL',
  requesterDepartmentId: 'dpt3', scheduleVersion: 1, serviceRequirements: [], ...input
});

before(async () => {
  if (!integrationEnabled) return;
  await resetTestDb();
  await server.start({ SMART_OFFICE_DEVICE_OFFLINE_AFTER_SECONDS: '10' });
  [admin, requester] = await Promise.all([server.login('1'), server.login('3')]);
  for (const [id, name, role] of [[frontDeskId, 'MRP6前台', 'FRONT_DESK'], [otherId, 'MRP6其他员工', 'EMPLOYEE']]) {
    await expectJson(await call('/api/users', 'POST', admin, {
      user: { id, name, email: `${id}@company.com`, role: [role], department: '行政部', landline: '010-88889999', mobile: '13800000131' }
    }), 201);
  }
  [frontDesk, other] = await Promise.all([server.login(frontDeskId), server.login(otherId)]);
  const now = Date.now();
  await insertBooking(booking({
    id: 'mrp6-own', userId: '3', resourceId: 'r1', purpose: '本人会议',
    startTime: new Date(now + 3600000).toISOString(), endTime: new Date(now + 7200000).toISOString()
  }));
  await insertBooking(booking({
    id: 'mrp6-other', userId: otherId, resourceId: 'r2', purpose: '他人会议',
    startTime: new Date(now + 3600000).toISOString(), endTime: new Date(now + 7200000).toISOString()
  }));
  const chinaToday = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  await insertBooking(booking({
    id: 'mrp6-confidential', userId: otherId, resourceId: 'r1', purpose: '机密项目真实名称', meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL',
    startTime: `${chinaToday}T08:00:00+08:00`, endTime: `${chinaToday}T09:00:00+08:00`
  }));
  await insertBooking(booking({
    id: 'mrp6-no-show', userId: '3', resourceId: 'r1', purpose: '未签到复核', status: 'CANCELLED', noShow: true, releaseType: 'NO_SHOW', releasedAt: new Date(now - 60000).toISOString(),
    startTime: new Date(now - 7200000).toISOString(), endTime: new Date(now - 3600000).toISOString()
  }));
});

after(async () => { if (integrationEnabled) await server.stop(); });

describe('MRP6 驾驶舱、异常中心与门口屏真实 API', { skip: !integrationEnabled, concurrency: false }, () => {
  it('驾驶舱先按角色过滤原始预约再聚合，保留下一场最小 DTO', async () => {
    const own = await expectJson(await call('/api/dashboard', 'GET', requester), 200);
    assert.equal(own.scope, 'PERSONAL');
    assert.equal(own.stats.activeBookings, 1);
    assert.equal(own.nextBooking.id, 'mrp6-own');
    assert.equal(own.nextBooking.purpose, '本人会议');
    assert.equal(own.nextBooking.userId, undefined);

    const otherView = await expectJson(await call('/api/dashboard', 'GET', other), 200);
    assert.equal(otherView.stats.activeBookings, 1);
    assert.equal(otherView.nextBooking.purpose, '他人会议');

    const enterprise = await expectJson(await call('/api/dashboard', 'GET', admin), 200);
    assert.equal(enterprise.scope, 'ENTERPRISE');
    assert.equal(enterprise.stats.activeBookings, 2);
    assert.equal(JSON.stringify(enterprise).includes('机密项目真实名称'), false);
    assert.ok(enterprise.revision > 0);
    assert.ok(enterprise.generatedAt);
  });

  it('报表 API 与 CSV/XLSX 下载共用权限快照并保护涉密内容', async () => {
    const query = `start=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&end=${encodeURIComponent(new Date(Date.now() + 172800000).toISOString())}`;
    await expectJson(await call(`/api/reports?${query}`, 'GET', requester), 403);
    const report = await expectJson(await call(`/api/reports?${query}`, 'GET', admin), 200);
    assert.deepEqual(new Set(report.bookings.map((item: any) => item.id)), new Set(['mrp6-own', 'mrp6-other', 'mrp6-no-show']));
    assert.equal(report.rows.some((item: any) => item.dimension === 'BUILDING_FLOOR'), true);
    assert.equal(report.rows.some((item: any) => item.dimension === 'USAGE'), true);
    assert.equal(JSON.stringify(report).includes('机密项目真实名称'), false);

    const csvResponse = await call(`/api/reports/export?format=csv&${query}`, 'GET', admin);
    assert.equal(csvResponse.status, 200);
    assert.match(csvResponse.headers.get('content-type') || '', /^text\/csv/);
    assert.equal(csvResponse.headers.get('cache-control'), 'no-store');
    const csvBytes = Buffer.from(await csvResponse.arrayBuffer());
    assert.deepEqual([...csvBytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
    const csv = csvBytes.subarray(3).toString('utf8');
    assert.match(csv, /维度/);
    assert.equal(csv.includes('机密项目真实名称'), false);

    const xlsxResponse = await call(`/api/reports/export?format=xlsx&${query}`, 'GET', admin);
    assert.equal(xlsxResponse.status, 200);
    assert.match(xlsxResponse.headers.get('content-type') || '', /spreadsheetml\.sheet/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await xlsxResponse.arrayBuffer()));
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['多维汇总', '预约对账', '签到明细', '服务明细', '差异清单', '导出说明']);
    assert.equal(workbook.getWorksheet('预约对账')!.rowCount, 4);
    assert.equal(JSON.stringify(workbook.worksheets.map(sheet => sheet.getSheetValues())).includes('机密项目真实名称'), false);
  });

  it('异常有责任人、处理记录和事实关闭条件，普通员工不能代前台复核', async () => {
    const own = await expectJson(await call('/api/exceptions', 'GET', requester), 200);
    const noShow = own.exceptions.find((item: any) => item.id === 'no-show:mrp6-no-show:1');
    assert.equal(noShow.ownerRole, 'FRONT_DESK');
    assert.equal(noShow.status, 'OPEN');
    assert.equal(own.exceptions.some((item: any) => item.kind === 'DEVICE_OFFLINE'), false);
    await expectJson(await call(`/api/exceptions/${encodeURIComponent(noShow.id)}`, 'POST', requester, { action: 'ACKNOWLEDGE', note: '越权处理' }), 403);

    const acknowledged = await expectJson(await call(`/api/exceptions/${encodeURIComponent(noShow.id)}`, 'POST', frontDesk, { action: 'ACKNOWLEDGE', note: '已联系申请人核对现场' }), 200);
    assert.equal(acknowledged.exception.status, 'ACKNOWLEDGED');
    assert.equal(acknowledged.exception.history.length, 1);
    const resolved = await expectJson(await call(`/api/exceptions/${encodeURIComponent(noShow.id)}`, 'POST', frontDesk, { action: 'RESOLVE', note: '资源与服务释放结果均已复核' }), 200);
    assert.equal(resolved.exception.status, 'RESOLVED');
    assert.equal(resolved.exception.history.length, 2);
    const unrelated = await expectJson(await call('/api/exceptions', 'GET', other), 200);
    assert.equal(unrelated.exceptions.some((item: any) => item.id === noShow.id || JSON.stringify(item).includes('未签到复核')), false);
    const audit = await queryTestDb<any[]>("SELECT action FROM audit_events WHERE entity_id = 'mrp6-no-show' ORDER BY created_at");
    assert.deepEqual(audit.map(item => item.action), ['EXCEPTION_ACKNOWLEDGE', 'EXCEPTION_RESOLVE']);
  });

  it('设备独立凭证只读绑定资源日程，心跳无需 Origin，轮换与吊销立即失效', async () => {
    await expectJson(await call('/api/devices', 'POST', requester, { name: '越权门口屏', resourceId: 'r1' }), 403);
    const created = await expectJson(await call('/api/devices', 'POST', admin, { name: 'Alpha 门口屏', resourceId: 'r1' }), 201);
    const token = created.token as string;
    assert.match(token, /^door_/);
    assert.equal(created.device.tokenHash, undefined);
    const listed = await expectJson(await call('/api/devices', 'GET', admin), 200);
    assert.equal(listed.devices[0].tokenHash, undefined);
    assert.equal(JSON.stringify(listed).includes(token), false);

    await expectJson(await server.request('/api/device/snapshot'), 401);
    const snapshot = await expectJson(await server.request('/api/device/snapshot', { headers: { Authorization: `Bearer ${token}` } }), 200);
    assert.equal(snapshot.resource.id, 'r1');
    assert.equal(snapshot.device.tokenHash, undefined);
    assert.equal(snapshot.bookings.some((item: any) => item.id === 'mrp6-other'), false);
    const confidential = snapshot.bookings.find((item: any) => item.id === 'mrp6-confidential');
    assert.equal(confidential.purpose, '涉密会议');
    assert.equal(JSON.stringify(snapshot).includes('机密项目真实名称'), false);
    assert.equal(snapshot.bookings.every((item: any) => item.userId === undefined && item.attendeeIds === undefined), true);

    const heartbeat = await fetch(`${server.baseUrl}/api/device/heartbeat`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ lastSnapshotRevision: snapshot.revision })
    });
    const beat = await expectJson(heartbeat, 200);
    assert.equal(beat.ok, true);
    assert.equal(beat.device.lastSnapshotRevision, snapshot.revision);
    const adminExceptions = await expectJson(await call('/api/exceptions', 'GET', admin), 200);
    assert.equal(adminExceptions.exceptions.some((item: any) => item.id === `device-offline:${created.device.id}` && item.status !== 'RESOLVED'), false);

    const rotated = await expectJson(await call(`/api/devices/${created.device.id}/rotate`, 'POST', admin, {}), 200);
    await expectJson(await server.request('/api/device/snapshot', { headers: { Authorization: `Bearer ${token}` } }), 401);
    await expectJson(await server.request('/api/device/snapshot', { headers: { Authorization: `Bearer ${rotated.token}` } }), 200);
    await expectJson(await call(`/api/devices/${created.device.id}/revoke`, 'POST', admin, {}), 200);
    await expectJson(await server.request('/api/device/snapshot', { headers: { Authorization: `Bearer ${rotated.token}` } }), 401);

    const backup = await expectJson(await call('/api/backup', 'GET', admin), 200);
    assert.equal(backup.schemaVersion, 7);
    assert.equal(backup.collections.devices.length, 1);
    assert.match(backup.collections.devices[0].tokenHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(backup).includes(rotated.token), false);
    const legacy = structuredClone(backup);
    legacy.schemaVersion = 5;
    delete legacy.collections.devices;
    delete legacy.collections.exceptionActions;
    await expectJson(await call('/api/backup/restore', 'POST', admin, legacy), 200);
    assert.deepEqual((await expectJson(await call('/api/devices', 'GET', admin), 200)).devices, []);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking, Resource } from '../types.ts';
import { buildMeetingRoomMonitoring, buildOfficeMonitoring } from '../server/monitoring.ts';
import type { Hq3dSnapshot } from '../server/hq3d.ts';
import { monitoringSubscriberCount, publishMonitoringChange, subscribeMonitoringChanges } from '../server/monitoringEvents.ts';
import { redactBooking } from '../server/confidentiality.ts';

const now = new Date('2026-11-25T02:00:00.000Z');
const resource = (overrides: Partial<Resource> = {}): Resource => ({
  id: 'r1', name: '海棠会议室', type: 'ROOM', capacity: 8, location: '主楼 16层', features: [], status: 'AVAILABLE', ...overrides
});
const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'b1', userId: 'u1', resourceId: 'r1', type: 'ROOM', status: 'APPROVED', purpose: '项目复盘',
  startTime: '2026-11-25T01:00:00.000Z', endTime: '2026-11-25T03:00:00.000Z', createdAt: '2026-11-24T01:00:00.000Z',
  currentNodeIndex: 1, approvalHistory: [], ...overrides
});

const hqRoom = (uid: string, overrides: Record<string, unknown> = {}) => ({
  uid, no: '1601', cat: 'office', label: '办公室', dept: '', person: '', notes: '', lines: [],
  nx: 0, nz: 0, nw: 1, nd: 1, frac: 1, ...overrides
});
const hq3d = (rooms: Array<ReturnType<typeof hqRoom>>, overrides: Partial<Hq3dSnapshot> = {}): Hq3dSnapshot => ({
  generatedAt: now.toISOString(),
  buildings: [{ id: 'main', name: '主楼', aspect: 1, aspAll: [1], floors: [{ floorNo: 16, tag: '16F', sheet: '16F', areaTotal: null, rooms }] }],
  profiles: {}, maintenance: {}, resourceMappings: {}, dispositions: {}, floorAreas: {},
  options: { maintenanceTypes: [], maintainableCategories: [] }, ...overrides
});

test('会议室区分已签到使用中、预约占用与空闲，下一场不含待审批申请', () => {
  const items = buildMeetingRoomMonitoring([
    resource(), resource({ id: 'r2', name: '玉兰厅' }), resource({ id: 'desk', type: 'DESK' })
  ], [
    booking({ checkedInAt: '2026-11-25T01:05:00.000Z' }),
    booking({ id: 'b2', resourceId: 'r2' }),
    booking({ id: 'next', startTime: '2026-11-25T04:00:00.000Z', endTime: '2026-11-25T05:00:00.000Z' }),
    booking({ id: 'pending', resourceId: 'r2', status: 'PENDING' })
  ], now);
  assert.deepEqual(items.map(item => item.status), ['IN_USE', 'RESERVED']);
  assert.equal(items[0].currentBooking?.checkedIn, true);
  assert.equal(items[0].nextBooking?.startTime, '2026-11-25T04:00:00.000Z');
  assert.equal(items[1].currentBooking?.checkedIn, false);
});

test('提前结束、释放和结束时刻均不再占用，维护与待开放优先于预约', () => {
  const items = buildMeetingRoomMonitoring([
    resource(), resource({ id: 'r2', status: 'MAINTENANCE' }), resource({ id: 'r3', status: 'PENDING' })
  ], [
    booking({ actualEndTime: '2026-11-25T01:30:00.000Z', endedEarlyAt: '2026-11-25T01:30:00.000Z' }),
    booking({ id: 'b2', resourceId: 'r2' }),
    booking({ id: 'b3', resourceId: 'r3' }),
    booking({ id: 'released', status: 'CANCELLED', releaseType: 'NO_SHOW', noShow: true })
  ], now);
  assert.deepEqual(items.map(item => item.status), ['IDLE', 'MAINTENANCE', 'PENDING']);
  assert.equal(items[0].currentBooking, undefined);
});

test('脱敏视图不恢复涉密签到，也不把已提前结束或释放的涉密预约误报为占用', () => {
  const active = booking({ purpose: '机密项目', meetingType: 'CONFIDENTIAL', checkedInAt: '2026-11-25T01:05:00.000Z' });
  const ended = booking({ id: 'ended', resourceId: 'r2', purpose: '已结束机密项目', meetingType: 'CONFIDENTIAL', endedEarlyAt: '2026-11-25T01:30:00.000Z', actualEndTime: '2026-11-25T01:30:00.000Z' });
  const released = booking({ id: 'released', resourceId: 'r3', purpose: '已释放机密项目', meetingType: 'CONFIDENTIAL', releaseType: 'MANUAL_EXCEPTION', releasedAt: '2026-11-25T01:30:00.000Z' });
  const occupancy = [active, ended, released];
  const items = buildMeetingRoomMonitoring([
    resource(), resource({ id: 'r2' }), resource({ id: 'r3' })
  ], occupancy, now, occupancy.map(redactBooking));
  assert.deepEqual(items.map(item => item.status), ['RESERVED', 'IDLE', 'IDLE']);
  assert.equal(items[0].currentBooking?.purpose, '已预约');
  assert.equal(items[0].currentBooking?.checkedIn, false);
  assert.equal(items[0].currentBooking?.checkInTime, undefined);
  assert.equal(JSON.stringify(items).includes('机密项目'), false);
});

test('办公室应用资料覆盖，区分已分配、空置、未登记与维护', () => {
  const items = buildOfficeMonitoring(hq3d([
    hqRoom('assigned'), hqRoom('vacant', { no: '1602', notes: '空置' }),
    hqRoom('unregistered', { no: '1603' }), hqRoom('maintained', { no: '1604', person: '张三' }),
    hqRoom('meeting', { no: '1605', cat: 'meeting' })
  ], {
    profiles: {
      assigned: { uid: 'assigned', label: '财务办公室', person: '李四', dept: '财务部', history: [] }
    },
    maintenance: {
      maintained: { records: [{ id: 'm1', roomUid: 'maintained', type: '空调', title: '维修', note: '', reporter: '王五', status: 'open', createdAt: now.toISOString(), updatedAt: now.toISOString() }] }
    }
  }));
  assert.deepEqual(items.map(item => [item.uid, item.status]), [
    ['assigned', 'ASSIGNED'], ['vacant', 'VACANT'], ['unregistered', 'UNREGISTERED'], ['maintained', 'MAINTENANCE']
  ]);
  assert.equal(items[0].name, '财务办公室');
  assert.equal(items[0].department, '财务部');
});

test('监控事件订阅在取消后完全清理', () => {
  const before = monitoringSubscriberCount();
  let calls = 0;
  const unsubscribe = subscribeMonitoringChanges(() => { calls += 1; });
  publishMonitoringChange('workspace');
  unsubscribe();
  publishMonitoringChange('hq3d');
  assert.equal(calls, 1);
  assert.equal(monitoringSubscriberCount(), before);
});

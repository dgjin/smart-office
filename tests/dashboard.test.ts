import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking, Resource } from '../types.ts';
import { DEFAULT_RULE_SETTINGS } from '../constants.ts';
import { buildExecutiveDashboard, calculateResourceOccupancy, localDateKey } from '../utils/dashboard.ts';

const resource = (overrides: Partial<Resource> = {}): Resource => ({
  id: 'r1', name: '海棠会议室', type: 'ROOM', capacity: 8, location: '1号楼 16层', building: 'MAIN', floor: 16,
  roomCategory: 'SMALL', features: [], status: 'AVAILABLE', openStart: '08:00', openEnd: '20:00', ...overrides
});

const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'b1', userId: 'u1', resourceId: 'r1', type: 'ROOM', status: 'APPROVED', purpose: '项目复盘',
  startTime: new Date(2026, 0, 10, 9).toISOString(), endTime: new Date(2026, 0, 10, 11).toISOString(),
  participants: 4, createdAt: new Date(2026, 0, 9, 9).toISOString(), currentNodeIndex: 1,
  approvalHistory: [], attendeeIds: [], meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL', scheduleVersion: 1,
  ...overrides
});

const now = new Date(2026, 0, 10, 10);

test('资源占用按自然日、开放时段和提前结束时刻裁剪，并统计重点会议', () => {
  const result = calculateResourceOccupancy(resource(), [
    booking({
      id: 'clipped', status: 'COMPLETED',
      startTime: new Date(2026, 0, 10, 7).toISOString(), endTime: new Date(2026, 0, 10, 9).toISOString()
    }),
    booking({
      id: 'early', status: 'COMPLETED', hasLeader: true,
      startTime: new Date(2026, 0, 10, 12).toISOString(), endTime: new Date(2026, 0, 10, 14).toISOString(),
      actualEndTime: new Date(2026, 0, 10, 12, 30).toISOString(), endedEarlyAt: new Date(2026, 0, 10, 12, 30).toISOString()
    }),
    booking({
      id: 'cancelled', status: 'CANCELLED',
      startTime: new Date(2026, 0, 10, 15).toISOString(), endTime: new Date(2026, 0, 10, 16).toISOString()
    })
  ], now, now);

  assert.equal(result.bookedMinutes, 90);
  assert.equal(result.availableMinutes, 720);
  assert.equal(result.utilization, 12.5);
  assert.equal(result.importantBookingCount, 1);
  assert.deepEqual(result.dailyBookings.map(item => item.id), ['clipped', 'early']);
});

test('领导驾驶舱返回八项同源指标，七日平均按预约与开放总分钟加权', () => {
  const rooms = [
    resource(),
    resource({ id: 'r2', name: '玉兰厅', status: 'OCCUPIED', openStart: '09:00', openEnd: '18:00' }),
    resource({ id: 'r3', name: '维护会议室', status: 'MAINTENANCE' }),
    resource({ id: 'desk', name: '开放工位', type: 'DESK', roomCategory: undefined })
  ];
  const bookings = [
    booking({ checkedInAt: new Date(2026, 0, 10, 9, 5).toISOString() }),
    booking({
      id: 'early', status: 'COMPLETED',
      startTime: new Date(2026, 0, 10, 12).toISOString(), endTime: new Date(2026, 0, 10, 14).toISOString(),
      actualEndTime: new Date(2026, 0, 10, 13).toISOString(), endedEarlyAt: new Date(2026, 0, 10, 13).toISOString()
    }),
    booking({
      id: 'important', resourceId: 'r2', meetingType: 'IMPORTANT',
      startTime: new Date(2026, 0, 10, 14).toISOString(), endTime: new Date(2026, 0, 10, 16).toISOString()
    }),
    booking({
      id: 'overdue', resourceId: 'r2',
      startTime: new Date(2026, 0, 10, 8).toISOString(), endTime: new Date(2026, 0, 10, 11).toISOString()
    }),
    booking({
      id: 'tomorrow', hasLeader: true,
      startTime: new Date(2026, 0, 11, 8).toISOString(), endTime: new Date(2026, 0, 11, 12).toISOString()
    }),
    booking({
      id: 'cancelled', resourceId: 'r2', status: 'CANCELLED',
      startTime: new Date(2026, 0, 10, 16).toISOString(), endTime: new Date(2026, 0, 10, 17).toISOString()
    }),
    booking({
      id: 'no-show', status: 'CANCELLED', noShow: true, releaseType: 'NO_SHOW', releasedAt: new Date(2026, 0, 10, 9).toISOString(),
      startTime: new Date(2026, 0, 10, 6).toISOString(), endTime: new Date(2026, 0, 10, 7).toISOString()
    })
  ];

  const result = buildExecutiveDashboard(rooms, bookings, now, { ...DEFAULT_RULE_SETTINGS, noShowReleaseAfterStartMinutes: 15 });

  assert.equal(result.roomCount, 2);
  assert.equal(result.currentInUse, 2);
  assert.equal(result.currentIdle, 0);
  assert.equal(result.todayBookingCount, 4);
  assert.equal(result.todayUtilization, 33.3);
  assert.equal(result.weekAverageUtilization, 7.5);
  assert.equal(result.todayNoShowCount, 1);
  assert.equal(result.overdueReleaseCount, 1);
  assert.equal(result.week.length, 7);
  assert.equal(result.week[0].date, localDateKey(now));
  assert.equal(result.week[0].utilization, 33.3);
  assert.equal(result.week[0].importantBookingCount, 1);
  assert.equal(result.week[1].utilization, 19);
  assert.equal(result.week[1].importantBookingCount, 1);
});

test('当前空闲统计排除已释放占用，无开放时长的资源不进入占用率分母', () => {
  const rooms = [resource(), resource({ id: 'r2', name: '维护会议室', status: 'MAINTENANCE' })];
  const result = buildExecutiveDashboard(rooms, [
    booking({
      id: 'released', status: 'CANCELLED', releaseType: 'UNUSED_CONFIRMED', releasedAt: new Date(2026, 0, 10, 9, 30).toISOString(),
      startTime: new Date(2026, 0, 10, 9).toISOString(), endTime: new Date(2026, 0, 10, 11).toISOString()
    })
  ], now, DEFAULT_RULE_SETTINGS);

  assert.equal(result.roomCount, 1);
  assert.equal(result.currentInUse, 0);
  assert.equal(result.currentIdle, 1);
  assert.equal(result.todayBookingCount, 0);
  assert.equal(result.todayUtilization, 0);
  assert.equal(result.weekAverageUtilization, 0);
});

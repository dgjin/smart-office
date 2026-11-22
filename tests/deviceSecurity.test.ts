import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCheckInQr, parseCheckInQr } from '../utils/checkInQr.ts';
import { DOOR_SNAPSHOT_MAX_AGE_MS, doorCacheKey, doorSnapshotStatus, formatDoorCountdown, upcomingDoorBookings } from '../utils/doorDisplay.ts';

test('门口屏快照只在签发后五分钟内有效，设备缓存键彼此隔离', () => {
  const now = Date.parse('2026-11-21T02:00:00.000Z');
  const generatedAt = new Date(now - 60_000).toISOString();
  const snapshot = { generatedAt, expiresAt: new Date(now - 60_000 + DOOR_SNAPSHOT_MAX_AGE_MS).toISOString() };
  assert.equal(doorSnapshotStatus(snapshot, now), 'FRESH');
  assert.equal(doorSnapshotStatus(snapshot, Date.parse(snapshot.expiresAt)), 'EXPIRED');
  assert.equal(doorSnapshotStatus({ generatedAt, expiresAt: new Date(now + 3600_000).toISOString() }, now), 'INVALID');
  assert.equal(doorSnapshotStatus({ generatedAt: new Date(now + 60_000).toISOString(), expiresAt: new Date(now + 60_000 + DOOR_SNAPSHOT_MAX_AGE_MS).toISOString() }, now), 'INVALID');
  assert.equal(doorSnapshotStatus({ generatedAt, expiresAt: '' }, now), 'INVALID');
  assert.notEqual(doorCacheKey('door_alpha-one-credential'), doorCacheKey('door_beta-two-credential'));
});

test('门口屏倒计时按分钟向上取整，并明确结束和即将开始状态', () => {
  const now = Date.parse('2026-11-21T02:00:00.000Z');
  assert.equal(formatDoorCountdown(new Date(now + 2 * 3600_000 + 5 * 60_000).toISOString(), now, '剩余'), '剩余 2 小时 5 分钟');
  assert.equal(formatDoorCountdown(new Date(now + 59_000).toISOString(), now, '剩余'), '剩余 1 分钟');
  assert.equal(formatDoorCountdown(new Date(now).toISOString(), now, '剩余'), '已结束');
  assert.equal(formatDoorCountdown(new Date(now + 90 * 60_000).toISOString(), now, '距开始'), '距开始 1 小时 30 分钟');
  assert.equal(formatDoorCountdown(new Date(now - 1000).toISOString(), now, '距开始'), '即将开始');
  assert.equal(formatDoorCountdown('invalid', now, '剩余'), '已结束');
});

test('门口屏后续日程只保留进行中及尚未结束的未来预约', () => {
  const now = Date.parse('2026-11-21T02:00:00.000Z');
  const at = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString();
  const bookings = [
    { id: 'current', status: 'IN_PROGRESS', endTime: at(30) },
    { id: 'next', status: 'UPCOMING', endTime: at(60) },
    { id: 'ended', status: 'UPCOMING', endTime: at(0) },
    { id: 'completed', status: 'COMPLETED', endTime: at(90) },
    { id: 'no-show', status: 'NO_SHOW', endTime: at(120) }
  ];
  assert.deepEqual(upcomingDoorBookings(bookings, now).map(item => item.id), ['current', 'next']);
});

test('会议二维码必须包含预约版本，旧格式和无版本链接均拒绝', () => {
  assert.deepEqual(parseCheckInQr(formatCheckInQr('booking/特殊:1', 3)), { bookingId: 'booking/特殊:1', scheduleVersion: 3 });
  assert.deepEqual(parseCheckInQr('https://office.example/check-in?bookingId=b1&scheduleVersion=2'), { bookingId: 'b1', scheduleVersion: 2 });
  assert.equal(parseCheckInQr('b1'), null);
  assert.equal(parseCheckInQr('smart-office:check-in:b1'), null);
  assert.equal(parseCheckInQr('https://office.example/check-in?bookingId=b1'), null);
  assert.equal(parseCheckInQr('smart-office:check-in:b1:v0'), null);
  assert.equal(parseCheckInQr('javascript:alert(1)'), null);
});

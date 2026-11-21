import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCheckInQr, parseCheckInQr } from '../utils/checkInQr.ts';
import { DOOR_SNAPSHOT_MAX_AGE_MS, doorCacheKey, doorSnapshotStatus } from '../utils/doorDisplay.ts';

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

test('会议二维码必须包含预约版本，旧格式和无版本链接均拒绝', () => {
  assert.deepEqual(parseCheckInQr(formatCheckInQr('booking/特殊:1', 3)), { bookingId: 'booking/特殊:1', scheduleVersion: 3 });
  assert.deepEqual(parseCheckInQr('https://office.example/check-in?bookingId=b1&scheduleVersion=2'), { bookingId: 'b1', scheduleVersion: 2 });
  assert.equal(parseCheckInQr('b1'), null);
  assert.equal(parseCheckInQr('smart-office:check-in:b1'), null);
  assert.equal(parseCheckInQr('https://office.example/check-in?bookingId=b1'), null);
  assert.equal(parseCheckInQr('smart-office:check-in:b1:v0'), null);
  assert.equal(parseCheckInQr('javascript:alert(1)'), null);
});

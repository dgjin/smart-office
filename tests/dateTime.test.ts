import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatTime, migrateBookings, normalizeIso, toLocalDateTimeString } from '../utils/dateTime.ts';

test('日期与时间按本地时区格式化并补齐位数', () => {
  const date = new Date(2026, 0, 2, 3, 4);
  assert.equal(formatDate(date), '2026-01-02');
  assert.equal(formatTime(date), '03:04');
});

test('naive 本地时间归一为 UTC ISO 后可还原本地展示', () => {
  const normalized = normalizeIso('2026-11-20T09:30');
  assert.equal(normalized, new Date(2026, 10, 20, 9, 30).toISOString());
  assert.equal(toLocalDateTimeString(normalized), '2026-11-20 09:30');
});

test('已有 UTC ISO 归一化后保持同一时刻', () => {
  assert.equal(normalizeIso('2026-11-20T01:30:00.000Z'), '2026-11-20T01:30:00.000Z');
});

test('迁移保留预约字段并同时处理开始结束时间', () => {
  const [booking] = migrateBookings([{ id: 'b1', startTime: '2026-11-20T09:00', endTime: '2026-11-20T10:00', purpose: '周会' }]);
  assert.equal(booking.id, 'b1');
  assert.equal(booking.purpose, '周会');
  assert.equal(booking.startTime, new Date(2026, 10, 20, 9, 0).toISOString());
  assert.equal(booking.endTime, new Date(2026, 10, 20, 10, 0).toISOString());
});

test('无效日期原样保留，避免迁移时丢失数据', () => {
  assert.equal(normalizeIso('not-a-date'), 'not-a-date');
  assert.equal(toLocalDateTimeString('not-a-date'), 'not-a-date');
});

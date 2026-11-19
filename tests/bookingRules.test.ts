import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking } from '../types.ts';
import { findBookingConflicts, findNextAvailableSlot, hasBookingConflict, timeRangesOverlap } from '../utils/bookingRules.ts';

const makeBooking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'b1',
  userId: 'u1',
  resourceId: 'r1',
  type: 'ROOM',
  startTime: '2026-11-20T01:00:00.000Z',
  endTime: '2026-11-20T02:00:00.000Z',
  status: 'APPROVED',
  purpose: '会议',
  createdAt: '2026-11-19T01:00:00.000Z',
  currentNodeIndex: 0,
  approvalHistory: [],
  ...overrides
});

const candidate = {
  resourceId: 'r1',
  startTime: '2026-11-20T01:30:00.000Z',
  endTime: '2026-11-20T02:30:00.000Z'
};

test('相交时段冲突，首尾相接不冲突', () => {
  assert.equal(timeRangesOverlap(new Date('2026-11-20T01:30Z'), new Date('2026-11-20T02:30Z'), new Date('2026-11-20T01:00Z'), new Date('2026-11-20T02:00Z')), true);
  assert.equal(timeRangesOverlap(new Date('2026-11-20T02:00Z'), new Date('2026-11-20T03:00Z'), new Date('2026-11-20T01:00Z'), new Date('2026-11-20T02:00Z')), false);
});

test('待审批与已核准预约都占用资源', () => {
  assert.equal(hasBookingConflict([makeBooking({ status: 'PENDING' })], candidate), true);
  assert.equal(hasBookingConflict([makeBooking({ status: 'APPROVED' })], candidate), true);
});

test('取消、驳回和已完成预约不占用资源', () => {
  const bookings = ['CANCELLED', 'REJECTED', 'COMPLETED'].map((status, index) => makeBooking({ id: `b${index}`, status: status as Booking['status'] }));
  assert.deepEqual(findBookingConflicts(bookings, candidate), []);
});

test('其他资源与当前编辑预约不会误报冲突', () => {
  const bookings = [makeBooking({ id: 'other-resource', resourceId: 'r2' }), makeBooking({ id: 'editing' })];
  assert.deepEqual(findBookingConflicts(bookings, candidate, 'editing'), []);
});

test('自动改期跳过已占用时段', () => {
  const now = new Date(2026, 10, 20, 8, 0);
  const booking = makeBooking({
    startTime: new Date(2026, 10, 20, 8, 0).toISOString(),
    endTime: new Date(2026, 10, 20, 9, 0).toISOString()
  });
  const slot = findNextAvailableSlot('r1', [booking], 60, now);
  assert.equal(slot.start.getHours(), 9);
  assert.equal(slot.end.getHours(), 10);
});

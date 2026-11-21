import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking, Resource } from '../types.ts';
import { addCalendarMonthClamped, findAvailableRooms, findBookingConflicts, findNextAvailableSlot, getDailyOccurrenceCount, getLongTermMaxEndDate, getResourceUpdateError, hasBookingConflict, isLongTermSeriesWithinLimit, timeRangesOverlap, validateBookingResource } from '../utils/bookingRules.ts';
import { validateBookingDraft } from '../utils/bookingDraft.ts';

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

test('日历月按大小月和闰年钳制', () => {
  assert.equal(addCalendarMonthClamped(new Date(2026, 0, 31, 9)).getDate(), 28);
  assert.equal(addCalendarMonthClamped(new Date(2024, 0, 31, 9)).getDate(), 29);
  assert.equal(addCalendarMonthClamped(new Date(2026, 11, 15, 9)).getFullYear(), 2027);
});

test('长期预订截止日期和每日次数按本地日历计算', () => {
  const start = new Date(2026, 0, 15, 9);
  const maxEndDate = getLongTermMaxEndDate(start);
  assert.equal(maxEndDate.getMonth(), 1);
  assert.equal(maxEndDate.getDate(), 14);
  assert.equal(getDailyOccurrenceCount(start, maxEndDate), 31);
});

test('长期系列恰好一个月可通过，超过一个月被拒绝', () => {
  const first = { startTime: new Date(2026, 0, 15, 9).toISOString(), endTime: new Date(2026, 0, 15, 10).toISOString() };
  const exactLimit = { startTime: new Date(2026, 1, 15, 8).toISOString(), endTime: new Date(2026, 1, 15, 9).toISOString() };
  const overLimit = { startTime: new Date(2026, 1, 15, 9).toISOString(), endTime: new Date(2026, 1, 15, 10).toISOString() };
  assert.equal(isLongTermSeriesWithinLimit([first, exactLimit]), true);
  assert.equal(isLongTermSeriesWithinLimit([first, overLimit]), false);
});

test('长期系列上限按规则版本月数计算且不截断输入', () => {
  const first = { startTime: new Date(2026, 0, 15, 9).toISOString(), endTime: new Date(2026, 0, 15, 10).toISOString() };
  const sixWeeks = { startTime: new Date(2026, 1, 26, 9).toISOString(), endTime: new Date(2026, 1, 26, 10).toISOString() };
  const series = [first, sixWeeks];
  assert.equal(isLongTermSeriesWithinLimit(series, 1), false);
  assert.equal(isLongTermSeriesWithinLimit(series, 2), true);
  assert.equal(series.length, 2);
  assert.equal(series[1], sixWeeks);
});

const makeResource = (overrides: Partial<Resource> = {}): Resource => ({
  id: 'r1',
  name: 'Alpha 会议室',
  type: 'ROOM',
  capacity: 10,
  location: '1号楼 10层',
  features: ['视频会议系统', '投屏显示器', '白板'],
  status: 'AVAILABLE',
  ...overrides
});

const resourceCandidate = {
  startTime: '2026-11-21T01:00:00.000Z',
  endTime: '2026-11-21T02:00:00.000Z',
  participants: 6
};

test('维护中和待开放资源不可预约，当前占用允许预约未来空档', () => {
  assert.equal(validateBookingResource(makeResource({ status: 'MAINTENANCE' }), resourceCandidate), 'RESOURCE_MAINTENANCE');
  assert.equal(validateBookingResource(makeResource({ status: 'PENDING' }), resourceCandidate), 'RESOURCE_UNAVAILABLE');
  assert.equal(validateBookingResource(makeResource({ status: 'OCCUPIED' }), resourceCandidate), null);
});

test('预约校验同步会议室容量与设备要求', () => {
  assert.equal(validateBookingResource(makeResource({ capacity: 4 }), resourceCandidate), 'CAPACITY_EXCEEDED');
  assert.equal(validateBookingResource(makeResource({ features: ['白板'] }), { ...resourceCandidate, requiredFeatures: ['DISPLAY'] }), 'REQUIRED_FEATURE_UNAVAILABLE');
  assert.equal(validateBookingResource(makeResource({ features: ['白板'] }), { ...resourceCandidate, isVideoConference: true }), 'REQUIRED_FEATURE_UNAVAILABLE');
  assert.equal(validateBookingResource(makeResource(), { ...resourceCandidate, requiredFeatures: ['VIDEO', 'DISPLAY', 'WHITEBOARD'] }), null);
});

test('条件查找与空间导航共用时段、容量、设备和维护规则', () => {
  const resources = [
    makeResource(),
    makeResource({ id: 'r2', name: 'Beta 会议室', status: 'OCCUPIED', features: ['视频会议系统'] }),
    makeResource({ id: 'r3', name: '维护会议室', status: 'MAINTENANCE' }),
    makeResource({ id: 'd1', name: '工位', type: 'DESK' })
  ];
  const bookings = [makeBooking({ startTime: '2026-11-21T01:00:00.000Z', endTime: '2026-11-21T02:00:00.000Z' })];
  const criteria = { ...resourceCandidate, requiredFeatures: ['VIDEO' as const] };
  assert.deepEqual(findAvailableRooms(resources, bookings, criteria).map(resource => resource.id), ['r2']);
  assert.deepEqual(findAvailableRooms(resources, [], { ...criteria, participants: 11 }), []);
  assert.deepEqual(findAvailableRooms(resources, [], { ...criteria, requiredFeatures: ['DISPLAY'] }).map(resource => resource.id), ['r1']);
  assert.deepEqual(findAvailableRooms(resources, [], { ...criteria, endTime: criteria.startTime }), []);
});

test('切换维护状态前必须处理未结束的有效预约', () => {
  const now = new Date('2026-11-19T00:00:00.000Z');
  const impact = getResourceUpdateError(makeResource(), makeResource({ status: 'MAINTENANCE' }), [makeBooking()], now);
  assert.equal(impact?.code, 'ACTIVE_BOOKINGS_REQUIRE_REVIEW');
  assert.equal(impact?.bookings.length, 1);
  assert.equal(getResourceUpdateError(makeResource(), makeResource({ status: 'MAINTENANCE' }), [makeBooking({ status: 'CANCELLED' })], now), null);
  assert.equal(getResourceUpdateError(makeResource(), makeResource({ status: 'MAINTENANCE' }), [makeBooking({ endTime: '2026-11-18T02:00:00.000Z' })], now), null);
});

test('缩容或移除预约依赖的设备会拦截资源配置修改', () => {
  const now = new Date('2026-11-19T00:00:00.000Z');
  const booking = makeBooking({ participants: 8, requiredFeatures: ['DISPLAY'] });
  assert.equal(getResourceUpdateError(makeResource(), makeResource({ capacity: 6 }), [booking], now)?.code, 'CAPACITY_EXCEEDED');
  assert.equal(getResourceUpdateError(makeResource(), makeResource({ features: ['视频会议系统', '白板'] }), [booking], now)?.code, 'REQUIRED_FEATURE_UNAVAILABLE');
  assert.equal(getResourceUpdateError(makeResource(), makeResource({ capacity: 12, features: ['视频会议系统', '投屏显示器', '白板', '电话会议'] }), [booking], now), null);
});

test('草案确认前校验用途、时间、人数、容量、设备和资源状态', () => {
  const now = new Date('2026-11-19T00:00:00.000Z');
  const draft = { ...resourceCandidate, resourceId: 'r1', purpose: '项目评审' };
  assert.equal(validateBookingDraft(draft, [makeResource()], [], now), null);
  assert.match(validateBookingDraft({ ...draft, purpose: ' ' }, [makeResource()], [], now) || '', /用途/);
  assert.match(validateBookingDraft({ ...draft, resourceId: 'missing' }, [makeResource()], [], now) || '', /有效资源/);
  assert.match(validateBookingDraft({ ...draft, endTime: draft.startTime }, [makeResource()], [], now) || '', /结束时间/);
  assert.match(validateBookingDraft({ ...draft, startTime: '2026-11-18T01:00:00.000Z', endTime: '2026-11-18T02:00:00.000Z' }, [makeResource()], [], now) || '', /开始时间已过/);
  assert.match(validateBookingDraft({ ...draft, participants: 0 }, [makeResource()], [], now) || '', /大于 0 的整数/);
  assert.match(validateBookingDraft({ ...draft, participants: 1.5 }, [makeResource()], [], now) || '', /大于 0 的整数/);
  assert.match(validateBookingDraft({ ...draft, participants: 11 }, [makeResource()], [], now) || '', /最多容纳 10 人/);
  assert.match(validateBookingDraft({ ...draft, requiredFeatures: ['DISPLAY'] }, [makeResource({ features: ['白板'] })], [], now) || '', /设备要求/);
  assert.match(validateBookingDraft(draft, [makeResource({ status: 'MAINTENANCE' })], [], now) || '', /暂停预约/);
});

test('草案确认前拦截待审批和已核准的首个时段冲突', () => {
  const now = new Date('2026-11-19T00:00:00.000Z');
  const draft = { ...resourceCandidate, resourceId: 'r1', purpose: '项目评审' };
  const conflict = makeBooking({ startTime: draft.startTime, endTime: draft.endTime, status: 'PENDING' });
  assert.match(validateBookingDraft(draft, [makeResource()], [conflict], now) || '', /已有待审批或已核准预约/);
  assert.equal(validateBookingDraft(draft, [makeResource()], [{ ...conflict, status: 'CANCELLED' }], now), null);
});

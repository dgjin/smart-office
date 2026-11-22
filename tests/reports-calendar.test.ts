import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking, Resource, User } from '../types.ts';
import { calendarReportRange, generateReport, localDateInputValue } from '../utils/reports.ts';
import { escapeCalendarParameter, escapeCalendarText, generateBookingIcs } from '../utils/calendar.ts';

const localIso = (day: number, hour = 0, minute = 0) =>
  new Date(2026, 0, day, hour, minute).toISOString();

const makeBooking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'b1',
  userId: 'u1',
  resourceId: 'r1',
  type: 'ROOM',
  startTime: localIso(10, 9),
  endTime: localIso(10, 10),
  status: 'APPROVED',
  purpose: '项目评审',
  createdAt: localIso(9, 9),
  currentNodeIndex: 0,
  approvalHistory: [],
  ...overrides
});

const makeResource = (overrides: Partial<Resource> = {}): Resource => ({
  id: 'r1',
  name: 'Alpha 会议室',
  type: 'ROOM',
  capacity: 10,
  location: '1号楼',
  features: [],
  status: 'AVAILABLE',
  ...overrides
});

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'u1',
  name: '张三',
  email: 'zhang@example.com',
  role: ['EMPLOYEE'],
  department: '工程部',
  ...overrides
});

const range = { start: localIso(10), end: localIso(12) };

test('报表按时段相交纳入预约，首尾相接不计入', () => {
  const bookings = [
    makeBooking({ id: 'started-before', startTime: localIso(9, 20), endTime: localIso(10, 9) }),
    makeBooking({ id: 'ends-at-start', startTime: localIso(9, 8), endTime: localIso(10) }),
    makeBooking({ id: 'starts-at-end', startTime: localIso(12), endTime: localIso(12, 9) }),
    makeBooking({ id: 'cancelled', startTime: localIso(11, 9), endTime: localIso(11, 10), status: 'CANCELLED' })
  ];
  const result = generateReport(bookings, [makeResource()], [makeUser()], range);
  assert.equal(result.overall.bookingCount, 2);
  assert.equal(result.overall.usageHours, 1);
  assert.equal(result.overall.cancellationRate, 50);
});

test('提前结束时间同时用于范围相交判断', () => {
  const bookings = [makeBooking({
    startTime: localIso(8, 9),
    endTime: localIso(11, 10),
    endedEarlyAt: localIso(9, 10)
  })];
  const result = generateReport(bookings, [makeResource()], [makeUser()], range);
  assert.equal(result.overall.bookingCount, 0);
  assert.equal(result.overall.usageHours, 0);
});

test('使用时长按跨日预约、提前结束和每日默认开放区间裁剪', () => {
  const bookings = [
    makeBooking({ id: 'cross-range', startTime: localIso(9, 18), endTime: localIso(10, 10) }),
    makeBooking({
      id: 'early',
      startTime: localIso(10, 19),
      endTime: localIso(11, 9),
      endedEarlyAt: localIso(11, 1)
    }),
    makeBooking({ id: 'completed', startTime: localIso(11, 7), endTime: localIso(11, 21), status: 'COMPLETED' }),
    makeBooking({ id: 'pending', startTime: localIso(11, 9), endTime: localIso(11, 18), status: 'PENDING' })
  ];
  const result = generateReport(bookings, [makeResource()], [makeUser()], range);
  assert.equal(result.overall.bookingCount, 4);
  assert.equal(result.overall.usageHours, 15);
  assert.equal(result.overall.utilization, 62.5);
  assert.equal(result.rows[0].usageHours, 15);
});

test('实际签到与提前结束决定使用时长，签到后人工释放仍保留实际使用且 no-show 不计使用', () => {
  const bookings = [
    makeBooking({
      id: 'actual', status: 'COMPLETED', startTime: localIso(10, 9), endTime: localIso(10, 10),
      actualStartTime: localIso(10, 9, 20), actualEndTime: localIso(10, 9, 40), endedEarlyAt: localIso(10, 9, 40)
    }),
    makeBooking({
      id: 'released-after-check-in', status: 'CANCELLED', startTime: localIso(11, 9), endTime: localIso(11, 10),
      actualStartTime: localIso(11, 9, 10), actualEndTime: localIso(11, 9, 30), releaseType: 'MANUAL_EXCEPTION'
    }),
    makeBooking({ id: 'no-show', status: 'CANCELLED', noShow: true, startTime: localIso(11, 13), endTime: localIso(11, 14) })
  ];
  const result = generateReport(bookings, [makeResource()], [makeUser()], range);
  assert.equal(result.overall.bookingCount, 3);
  assert.equal(result.overall.usageHours, 0.7);
  assert.equal(result.overall.noShowRate, 33.3);
});

test('自定义开放区间与部分日期共同决定实际容量', () => {
  const result = generateReport(
    [
      makeBooking({ id: 'first', startTime: localIso(10, 8), endTime: localIso(10, 18) }),
      makeBooking({ id: 'second', startTime: localIso(11, 8), endTime: localIso(11, 18) })
    ],
    [makeResource()],
    [makeUser()],
    { start: localIso(10, 12), end: localIso(11, 10) },
    { start: '09:00', end: '17:00' }
  );
  assert.equal(result.overall.usageHours, 6);
  assert.equal(result.overall.utilization, 100);
});

test('无资源或零开放容量时使用率保持为零', () => {
  const bookings = [makeBooking({ startTime: localIso(10, 8), endTime: localIso(10, 18) })];
  const noResources = generateReport(bookings, [], [makeUser()], range);
  const closed = generateReport(bookings, [makeResource()], [makeUser()], range, { start: '08:00', end: '08:00' });
  assert.equal(noResources.overall.usageHours, 10);
  assert.equal(noResources.overall.utilization, 0);
  assert.equal(closed.overall.usageHours, 0);
  assert.equal(closed.overall.utilization, 0);
});

test('资源和部门行保留 UI 指标并使用最终通过审批记录', () => {
  const users = [makeUser(), makeUser({ id: 'u2', name: '李四', department: '销售部' })];
  const resources = [makeResource(), makeResource({ id: 'r2', name: 'Beta 会议室' })];
  const approval = (timestamp: string) => ({ nodeName: '审批', approverName: '主管', status: 'APPROVED' as const, timestamp });
  const bookings = [
    makeBooking({
      id: 'b1',
      createdAt: localIso(9),
      approvalHistory: [approval(localIso(9, 2)), approval(localIso(9, 4))]
    }),
    makeBooking({ id: 'b2', resourceId: 'r2', status: 'REJECTED', startTime: localIso(10, 11), endTime: localIso(10, 12) }),
    makeBooking({ id: 'b3', userId: 'u2', status: 'CANCELLED', noShow: true, startTime: localIso(10, 13), endTime: localIso(10, 14) }),
    makeBooking({
      id: 'b4',
      userId: 'u2',
      resourceId: 'r2',
      status: 'CANCELLED',
      createdAt: localIso(9),
      approvalHistory: [approval(localIso(9, 6))],
      startTime: localIso(10, 15),
      endTime: localIso(10, 16)
    })
  ];
  const result = generateReport(bookings, resources, users, range);
  assert.equal(result.overall.bookingCount, 4);
  assert.equal(result.overall.cancellationRate, 25);
  assert.equal(result.overall.noShowRate, 25);
  assert.equal(result.overall.rejectionRate, 25);
  assert.equal(result.overall.averageApprovalHours, 5);
  const engineering = result.rows.find(row => row.dimension === 'DEPARTMENT' && row.id === '工程部');
  const sales = result.rows.find(row => row.dimension === 'DEPARTMENT' && row.id === '销售部');
  assert.equal(engineering?.bookingCount, 2);
  assert.equal(engineering?.rejectionRate, 50);
  assert.equal(engineering?.averageApprovalHours, 4);
  assert.equal(sales?.cancellationRate, 50);
  assert.equal(sales?.noShowRate, 50);
  assert.equal(sales?.averageApprovalHours, 6);
  assert.equal(result.rows.filter(row => row.dimension === 'RESOURCE').length, 2);
});

test('审批中或已驳回申请的部分审批记录不计入最终审批时长', () => {
  const approval = { nodeName: '一级审批', approverName: '主管', status: 'APPROVED' as const, timestamp: localIso(9, 2) };
  const result = generateReport([
    makeBooking({ id: 'approved', createdAt: localIso(9), approvalHistory: [approval, { ...approval, timestamp: localIso(9, 4) }] }),
    makeBooking({ id: 'pending', status: 'PENDING', createdAt: localIso(9), approvalHistory: [approval] }),
    makeBooking({ id: 'rejected', status: 'REJECTED', createdAt: localIso(9), approvalHistory: [approval] })
  ], [makeResource()], [makeUser()], range);
  assert.equal(result.overall.bookingCount, 3);
  assert.equal(result.overall.averageApprovalHours, 4);
});

test('报表不修改输入且拒绝无效范围', () => {
  const bookings = [makeBooking()];
  const resources = [makeResource()];
  const users = [makeUser()];
  const snapshot = JSON.stringify({ bookings, resources, users });
  generateReport(bookings, resources, users, range);
  assert.equal(JSON.stringify({ bookings, resources, users }), snapshot);
  assert.throws(() => generateReport(bookings, resources, users, { start: range.end, end: range.start }), RangeError);
});

test('自然日、自然周和自然月共用本地日历边界', () => {
  assert.deepEqual(calendarReportRange('DAY', '2026-01-10'), { start: localIso(10), end: localIso(11) });
  assert.deepEqual(calendarReportRange('WEEK', '2026-01-11'), { start: localIso(5), end: localIso(12) });
  assert.deepEqual(calendarReportRange('MONTH', '2026-01-31'), { start: localIso(1), end: new Date(2026, 1, 1).toISOString() });
  assert.equal(localDateInputValue(new Date(2026, 0, 2, 3, 4, 5)), '2026-01-02');
});

test('自然周期拒绝不存在或格式错误的基准日期', () => {
  for (const anchor of ['2026-02-30', '2026-13-01', '2026-1-01', 'not-a-date', '']) {
    assert.throws(() => calendarReportRange('DAY', anchor), RangeError, anchor);
  }
});

const icsBooking = () => makeBooking({
  id: 'meeting-1',
  startTime: '2026-01-10T01:00:00.000Z',
  endTime: '2026-01-10T02:30:00.000Z',
  purpose: '项目,评审;计划\\草稿\n下一行',
  attendeeIds: ['u2', 'missing']
});

const icsUsers = () => [
  makeUser({ name: '张 "Boss" ^\nX', email: 'boss@example.com' }),
  makeUser({ id: 'u2', name: '李,四', email: 'li@example.com\r\nX-INJECTED:true' })
];

test('ICS 输出 CRLF、完整事件字段与 CONFIRMED 状态', () => {
  const ics = generateBookingIcs(icsBooking(), makeResource({ name: 'A,栋;会议室\\东区' }), icsUsers(), '2026-01-09T00:00:00.000Z');
  assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false);
  assert.equal(ics.endsWith('\r\n'), true);
  assert.match(ics, /UID:meeting-1@smartoffice\.local\r\n/);
  assert.match(ics, /DTSTAMP:20260109T000000Z\r\n/);
  assert.match(ics, /DTSTART:20260110T010000Z\r\n/);
  assert.match(ics, /DTEND:20260110T023000Z\r\n/);
  assert.match(ics, /SUMMARY:项目\\,评审\\;计划\\\\草稿\\n下一行\r\n/);
  assert.match(ics, /LOCATION:A\\,栋\\;会议室\\\\东区\r\n/);
  assert.match(ics, /ORGANIZER;CN="张 \^'Boss\^' \^\^\^nX":MAILTO:boss@example\.com\r\n/);
  assert.match(ics, /ATTENDEE;CN="李,四";RSVP=TRUE:MAILTO:li@example\.com%0D%0AX-INJECTED:true\r\n/);
  assert.match(ics, /STATUS:CONFIRMED\r\n/);
  assert.doesNotMatch(ics, /\r\nX-INJECTED:true/);
  assert.doesNotMatch(ics, /missing/);
  assert.doesNotMatch(ics, /RRULE/);
});

test('取消预约输出 CANCELLED，其他状态由调用方限制', () => {
  const cancelled = generateBookingIcs(icsBooking(), makeResource(), icsUsers(), '2026-01-09T00:00:00Z');
  assert.match(cancelled, /STATUS:CONFIRMED/);
  const cancelledIcs = generateBookingIcs({ ...icsBooking(), status: 'CANCELLED' }, makeResource(), icsUsers(), '2026-01-09T00:00:00Z');
  assert.match(cancelledIcs, /STATUS:CANCELLED/);
  assert.throws(() => generateBookingIcs({ ...icsBooking(), status: 'PENDING' }, makeResource(), icsUsers(), '2026-01-09T00:00:00Z'), RangeError);
  assert.throws(() => generateBookingIcs({ ...icsBooking(), status: 'COMPLETED' }, makeResource(), icsUsers(), '2026-01-09T00:00:00Z'), RangeError);
});

test('ICS 文本与参数分别安全转义', () => {
  assert.equal(escapeCalendarText('a\\b;c,d\r\ne'), 'a\\\\b\\;c\\,d\\ne');
  assert.equal(escapeCalendarParameter('A^"B"\nC'), '"A^^^\'B^\'^nC"');
});

test('ICS 按 UTF-8 75 octet 折行且展开后内容不变', () => {
  const purpose = '评审'.repeat(80) + ',结束';
  const ics = generateBookingIcs({ ...icsBooking(), purpose }, makeResource(), icsUsers(), '2026-01-09T00:00:00Z');
  const physicalLines = ics.slice(0, -2).split('\r\n');
  assert.equal(physicalLines.every(line => Buffer.byteLength(line, 'utf8') <= 75), true);
  assert.equal(physicalLines.some(line => line.startsWith(' ')), true);
  const unfolded = ics.replace(/\r\n[ \t]/g, '');
  assert.match(unfolded, new RegExp(`SUMMARY:${'评审'.repeat(80)}\\\\,结束\\r\\n`));
  assert.doesNotMatch(ics, /RRULE/);
});

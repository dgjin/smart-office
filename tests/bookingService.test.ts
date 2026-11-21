import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULE_SETTINGS } from '../constants.ts';
import { BookingRuleError, buildBookingQuotaDetails, validateBookingBatch } from '../server/bookingService.ts';
import type { OfficeDb } from '../server/tools.ts';
import type { Booking, User } from '../types.ts';

const NOW = new Date('2026-11-19T08:00:00+08:00');
const settings = { ...DEFAULT_RULE_SETTINGS, departmentDailyNetMinutes: 240, exclusiveRequestOpenHours: 24 };

const requester: User = {
  id: 'u1', name: '李员工', email: 'li@company.com', role: ['EMPLOYEE'], department: '市场部',
  landline: '010-88886668', mobile: '13800000003'
};

const makeDb = (): OfficeDb => ({
  users: [
    { ...requester },
    { id: 'u2', name: '王同事', email: 'wang@company.com', role: ['EMPLOYEE'], department: '市场部', landline: '010-88886669', mobile: '13800000004' },
    { id: 'u3', name: '赵同事', email: 'zhao@company.com', role: ['EMPLOYEE'], department: '行政部', landline: '010-88886670', mobile: '13800000005' }
  ],
  departments: [{ id: 'dpt-market', name: '市场部' }, { id: 'dpt-admin', name: '行政部' }],
  resources: [
    { id: 'r1', name: 'Alpha 会议室', type: 'ROOM', capacity: 10, location: '主楼 10层', features: ['视频会议系统'], status: 'AVAILABLE' },
    { id: 'r2', name: 'Beta 会议室', type: 'ROOM', capacity: 10, location: '主楼 11层', features: ['视频会议系统'], status: 'AVAILABLE' },
    { id: 'r3', name: 'Gamma 会议室', type: 'ROOM', capacity: 10, location: '主楼 12层', features: [], status: 'AVAILABLE' }
  ],
  bookings: []
});

const makeBooking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'candidate', userId: 'u1', resourceId: 'r1', type: 'ROOM',
  startTime: '2026-11-20T10:00:00+08:00', endTime: '2026-11-20T11:00:00+08:00',
  status: 'PENDING', purpose: '项目会议', participants: 4, createdAt: NOW.toISOString(),
  currentNodeIndex: 0, approvalHistory: [], meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL',
  ...overrides
});

const validate = (db: OfficeDb, incoming: Booking[], editingId?: string) => validateBookingBatch({
  db, incoming, requester: db.users![0], settings, ruleVersion: 3, editingId, now: NOW
});

const assertRule = (code: string, run: () => unknown) => assert.throws(run, (error: any) => {
  assert.ok(error instanceof BookingRuleError);
  assert.equal(error.code, code);
  return true;
});

test('新预约必须显式选择会议类型与涉密属性且二者一致', () => {
  const db = makeDb();
  assertRule('MEETING_TYPE_REQUIRED', () => validate(db, [makeBooking({ meetingType: undefined })]));
  assertRule('CONFIDENTIALITY_CHOICE_REQUIRED', () => validate(db, [makeBooking({ confidentialityChoice: undefined })]));
  assertRule('CONFIDENTIALITY_TYPE_MISMATCH', () => validate(db, [makeBooking({ meetingType: 'CONFIDENTIAL', confidentialityChoice: 'NON_CONFIDENTIAL' })]));
  const accepted = validate(db, [makeBooking({ meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL' })]);
  assert.equal(accepted[0].meetingType, 'CONFIDENTIAL');
});

test('联系人双电话由申请人档案冻结并忽略客户端伪造快照', () => {
  const db = makeDb();
  const accepted = validate(db, [makeBooking({
    contactSnapshot: { userId: 'forged', name: '伪造', landline: '00000', mobile: '10000000000' }
  })]);
  assert.deepEqual(accepted[0].contactSnapshot, {
    userId: 'u1', name: '李员工', landline: '010-88886668', mobile: '13800000003'
  });
  db.users![0].landline = '';
  assertRule('CONTACT_SNAPSHOT_INCOMPLETE', () => validate(db, [makeBooking()]));
  db.users![0].landline = '010-88886668';
  db.users![0].mobile = 'not-a-phone';
  assertRule('CONTACT_SNAPSHOT_INCOMPLETE', () => validate(db, [makeBooking()]));
});

test('服务需求与旧工单字段同步，礼堂参数和规则快照一并保存', () => {
  const db = makeDb();
  db.resources![0].roomCategory = 'AUDITORIUM';
  assertRule('AUDITORIUM_SETUP_REQUIRED', () => validate(db, [makeBooking()]));
  assertRule('SERVICE_DETAILS_REQUIRED', () => validate(db, [makeBooking({
    serviceRequirements: [{ type: 'OTHER' }],
    auditoriumSetup: { seatingLayout: 'THEATER', stageRequired: false }
  })]));
  const [accepted] = validate(db, [makeBooking({
    needsTeaService: true,
    isVideoConference: true,
    serviceRequirements: [{ type: 'TEA' }, { type: 'SIGNAGE', details: '入口指引' }, { type: 'OTHER', details: '席卡' }],
    auditoriumSetup: { seatingLayout: 'CLASSROOM', stageRequired: true, rehearsalMinutes: 30, notes: '前排预留' }
  })]);
  assert.deepEqual(accepted.serviceRequirements?.map(item => item.type), ['TEA', 'SIGNAGE', 'OTHER', 'VIDEO']);
  assert.equal(accepted.serviceRequirements?.[1].details, '入口指引');
  assert.deepEqual(accepted.serviceRequirements?.[1].fieldValues, { notes: '入口指引' });
  assert.deepEqual(accepted.serviceRequirements?.[2].fieldValues, { notes: '席卡' });
  assert.ok(accepted.serviceRequirements?.every(item => item.catalogSnapshot?.catalogVersion === 1 && item.fieldValues));
  assert.equal(accepted.needsTeaService, true);
  assert.equal(accepted.isVideoConference, true);
  assert.equal(accepted.auditoriumSetup?.seatingLayout, 'CLASSROOM');
  assert.equal(accepted.ruleVersion, 3);
  assert.deepEqual(accepted.ruleSettingsSnapshot, settings);
});

test('开放窗口和专属资源临时申请窗口由统一规则阻断', () => {
  const db = makeDb();
  Object.assign(db.resources![0], { openStart: '09:00', openEnd: '18:00' });
  assertRule('RESOURCE_OUTSIDE_OPEN_HOURS', () => validate(db, [makeBooking({
    startTime: '2026-11-20T08:30:00+08:00', endTime: '2026-11-20T09:30:00+08:00'
  })]));
  assertRule('RESOURCE_OUTSIDE_OPEN_HOURS', () => validate(db, [makeBooking({
    startTime: '2026-11-20T17:30:00+08:00', endTime: '2026-11-21T09:30:00+08:00'
  })]));
  Object.assign(db.resources![0], { openStart: undefined, openEnd: undefined, isExclusive: true });
  assertRule('EXCLUSIVE_REQUEST_WINDOW_CLOSED', () => validate(db, [makeBooking({ exclusiveRequestReason: '临时接待' })]));
  const withinWindow = makeBooking({
    startTime: '2026-11-20T06:00:00+08:00', endTime: '2026-11-20T07:00:00+08:00'
  });
  assertRule('EXCLUSIVE_REQUEST_REASON_REQUIRED', () => validate(db, [withinWindow]));
  const [accepted] = validate(db, [makeBooking({
    startTime: withinWindow.startTime, endTime: withinWindow.endTime, exclusiveRequestReason: '临时重要接待'
  })]);
  assert.equal(accepted.exclusiveAccessType, 'TEMPORARY');
  assert.equal(accepted.exclusiveRequestReason, '临时重要接待');
});

test('资源与申请人重叠强阻断，参会人重叠只提示且不泄露会议用途', () => {
  const db = makeDb();
  db.bookings = [makeBooking({ id: 'resource-busy', userId: 'u2', purpose: '其他会议' })];
  assertRule('CONFLICT', () => validate(db, [makeBooking()]));

  db.bookings = [makeBooking({ id: 'requester-busy', resourceId: 'r2' })];
  assertRule('REQUESTER_TIME_CONFLICT', () => validate(db, [makeBooking()]));

  db.bookings = [makeBooking({ id: 'attendee-requester', userId: 'u2', resourceId: 'r2', purpose: '保密项目' })];
  const [accepted] = validate(db, [makeBooking({ attendeeIds: ['u2'] })]);
  assert.deepEqual(accepted.attendeeWarnings, ['王同事在该时段已有其他预约']);
  assert.ok(!accepted.attendeeWarnings[0].includes('保密项目'));

  db.bookings = [makeBooking({ id: 'attendee-busy', userId: 'u3', resourceId: 'r2', attendeeIds: ['u2'] })];
  const [attendeeAccepted] = validate(db, [makeBooking({ attendeeIds: ['u2'] })]);
  assert.deepEqual(attendeeAccepted.attendeeWarnings, ['王同事在该时段已有其他预约']);
});

test('普通多资源联合预约在统一入口被拒绝', () => {
  const db = makeDb();
  assertRule('MULTI_RESOURCE_BOOKING_NOT_SUPPORTED', () => validate(db, [
    makeBooking({ id: 'first' }),
    makeBooking({ id: 'second', resourceId: 'r2', startTime: '2026-11-20T13:00:00+08:00', endTime: '2026-11-20T14:00:00+08:00' })
  ]));
});

test('部门额度按中国自然日拆分，取消和驳回不占额度', () => {
  const db = makeDb();
  db.bookings = [
    makeBooking({ id: 'used', userId: 'u2', resourceId: 'r2', startTime: '2026-11-20T09:00:00+08:00', endTime: '2026-11-20T10:00:00+08:00' }),
    makeBooking({ id: 'cancelled', userId: 'u2', resourceId: 'r3', status: 'CANCELLED', startTime: '2026-11-20T10:00:00+08:00', endTime: '2026-11-20T13:00:00+08:00' }),
    makeBooking({ id: 'rejected', userId: 'u2', resourceId: 'r3', status: 'REJECTED', startTime: '2026-11-20T13:00:00+08:00', endTime: '2026-11-20T16:00:00+08:00' })
  ];
  const details = buildBookingQuotaDetails(db, makeBooking({
    startTime: '2026-11-20T23:00:00+08:00', endTime: '2026-11-21T01:00:00+08:00'
  }), settings);
  assert.deepEqual(details, [
    { date: '2026-11-20', limitMinutes: 240, usedBeforeMinutes: 60, requestedMinutes: 60, remainingMinutes: 120 },
    { date: '2026-11-21', limitMinutes: 240, usedBeforeMinutes: 0, requestedMinutes: 60, remainingMinutes: 180 }
  ]);
});

test('短会按实际分钟计量，系列逐期累计且超额不重复扣减', () => {
  const db = makeDb();
  const shortDetails = buildBookingQuotaDetails(db, makeBooking({
    startTime: '2026-11-20T10:00:00+08:00', endTime: '2026-11-20T10:20:00+08:00'
  }), settings);
  assert.equal(shortDetails[0].requestedMinutes, 20);
  assert.equal(shortDetails[0].remainingMinutes, 220);

  const first = makeBooking({ id: 'series-1', startTime: '2026-11-20T08:00:00+08:00', endTime: '2026-11-20T11:00:00+08:00' });
  const second = makeBooking({ id: 'series-2', startTime: '2026-11-20T13:00:00+08:00', endTime: '2026-11-20T15:00:00+08:00' });
  assertRule('DEPARTMENT_DAILY_QUOTA_EXCEEDED', () => buildBookingQuotaDetails(db, second, settings, [first]));

  assertRule('DEPARTMENT_DAILY_QUOTA_EXCEEDED', () => validate(db, [
    makeBooking({ id: 'batch-1', startTime: '2026-11-20T08:00:00+08:00', endTime: '2026-11-20T10:00:00+08:00' }),
    makeBooking({ id: 'batch-2', startTime: '2026-11-20T10:00:00+08:00', endTime: '2026-11-20T12:00:00+08:00' }),
    makeBooking({ id: 'batch-3', startTime: '2026-11-20T13:00:00+08:00', endTime: '2026-11-20T15:00:00+08:00' })
  ]));
});

test('改期排除原预约，取消后原时长自然返还', () => {
  const original = makeBooking({
    id: 'editing', startTime: '2026-11-20T08:00:00+08:00', endTime: '2026-11-20T11:20:00+08:00'
  });
  const candidate = makeBooking({
    id: 'editing', startTime: '2026-11-20T08:00:00+08:00', endTime: '2026-11-20T12:00:00+08:00'
  });
  const db = makeDb();
  db.bookings = [original];
  assertRule('DEPARTMENT_DAILY_QUOTA_EXCEEDED', () => buildBookingQuotaDetails(db, candidate, settings));
  const [detail] = buildBookingQuotaDetails(db, candidate, settings, [], 'editing');
  assert.equal(detail.usedBeforeMinutes, 0);
  assert.equal(detail.remainingMinutes, 0);

  db.bookings = [{ ...original, status: 'CANCELLED' }];
  const [returned] = buildBookingQuotaDetails(db, candidate, settings);
  assert.equal(returned.usedBeforeMinutes, 0);
  assert.equal(returned.remainingMinutes, 0);
});

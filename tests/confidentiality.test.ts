import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking, User } from '../types.ts';
import type { OfficeDb } from '../server/tools.ts';
import {
  assertConfidentialWhitelist, bookingNoticePurpose, canReadBookingDetails,
  getActorDbView, rebuildConfidentialAccessGrants, redactBooking
} from '../server/confidentiality.ts';

const requester: User = { id: 'u1', name: '申请人', email: 'u1@company.com', role: ['EMPLOYEE'], department: '市场部' };
const attendee: User = { id: 'u2', name: '参会人', email: 'u2@company.com', role: ['EMPLOYEE'], department: '市场部' };
const security: User = { id: 'sec1', name: '保密员', email: 'sec@company.com', role: ['SECURITY_ADMIN'], department: '保密办' };
const admin: User = { id: 'admin', name: '管理员', email: 'admin@company.com', role: ['SYSTEM_ADMIN'], department: '信息技术部' };
const approver: User = { id: 'ap1', name: '审批员', email: 'ap@company.com', role: ['APPROVAL_ADMIN'], department: '行政部' };

const confidential = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'secret-1', userId: requester.id, resourceId: 'r1', type: 'ROOM', startTime: '2026-11-23T02:00:00.000Z',
  endTime: '2026-11-23T03:00:00.000Z', status: 'PENDING', purpose: '敏感项目正文', participants: 3,
  createdAt: '2026-11-20T01:00:00.000Z', currentNodeIndex: 0, approvalHistory: [], meetingType: 'CONFIDENTIAL',
  confidentialityChoice: 'CONFIDENTIAL', attendeeIds: [attendee.id], approvalRuleSetVersion: 1,
  approvalRuleExplanation: ['涉密会议保密审批'], approvalWorkflow: [{ id: 'n1', name: '业务审批', approverRole: 'APPROVAL_ADMIN' }],
  contactSnapshot: { userId: requester.id, name: requester.name, landline: '010-1', mobile: '13800000000' }, ...overrides
});

const makeDb = (): OfficeDb => ({
  users: [requester, attendee, security, admin, approver],
  resources: [{ id: 'r1', name: '会议室', type: 'ROOM', capacity: 10, location: '主楼 10层', features: [], status: 'AVAILABLE' }],
  departments: [{ id: 'd1', name: '市场部' }],
  bookings: [confidential()], workOrders: [{ id: 'wo1', bookingId: 'secret-1', type: 'TEA', title: '涉密会议茶水服务', assigneeRole: 'SERVICE_COORDINATOR', status: 'TODO', createdAt: '2026-11-20T01:00:00.000Z' }]
});

test('涉密正文读取依赖专用授权，系统管理员身份不自动获得正文', () => {
  const db = makeDb();
  const booking = db.bookings![0];
  assert.equal(canReadBookingDetails(db, booking, admin), false);
  assert.equal(canReadBookingDetails(db, booking, security), false);
  assert.equal(canReadBookingDetails(db, booking, approver), true);
  rebuildConfidentialAccessGrants(db, [booking], requester.id);
  assert.equal(canReadBookingDetails(db, booking, requester), true);
  assert.equal(canReadBookingDetails(db, booking, attendee), true);
  assert.equal(canReadBookingDetails(db, booking, security), true);
  assert.equal(canReadBookingDetails(db, booking, admin), false);
});

test('脱敏读模型仅保留冲突和日程所需字段，工单按角色保留', () => {
  const db = makeDb();
  const redacted = redactBooking(db.bookings![0]);
  assert.equal(redacted.purpose, '已预约');
  assert.equal(redacted.userId, '');
  assert.equal(redacted.resourceId, 'r1');
  assert.deepEqual(redacted.attendeeIds, []);
  assert.deepEqual(redacted.overlapParticipantIds?.sort(), [requester.id, attendee.id].sort());
  assert.equal(redacted.contactSnapshot, undefined);
  assert.equal(redacted.approvalRuleSetVersion, undefined);
  assert.equal(redacted.approvalSubmittedAt, undefined);

  const view = getActorDbView(db, admin);
  assert.equal(view.bookings![0].purpose, '已预约');
  assert.equal(view.workOrders!.length, 0);
  const requesterView = getActorDbView(db, requester);
  assert.equal(requesterView.bookings![0].purpose, '已预约');
  assert.equal(requesterView.workOrders!.length, 0);
  rebuildConfidentialAccessGrants(db, db.bookings!, requester.id);
  const authorizedRequesterView = getActorDbView(db, requester);
  assert.equal(authorizedRequesterView.bookings![0].purpose, '敏感项目正文');
  assert.equal(authorizedRequesterView.workOrders!.length, 1);
  assert.equal(getActorDbView(db, attendee).workOrders!.length, 0);
});

test('白名单同时约束申请人与全部参会人', () => {
  const db = makeDb();
  assert.throws(() => assertConfidentialWhitelist(db, db.bookings![0]), (error: any) => error.code === 'CONFIDENTIAL_WHITELIST_REQUIRED');
  db.confidentialWhitelist = [
    { id: 'w1', userId: requester.id, reason: '授权', createdAt: '2026-11-20T01:00:00.000Z', createdBy: security.id },
    { id: 'w2', userId: attendee.id, reason: '授权', createdAt: '2026-11-20T01:00:00.000Z', createdBy: security.id }
  ];
  assert.doesNotThrow(() => assertConfidentialWhitelist(db, db.bookings![0]));
  db.bookings![0].meetingType = 'NORMAL';
  db.bookings![0].confidentialityChoice = 'NON_CONFIDENTIAL';
  db.confidentialWhitelist = [];
  assert.doesNotThrow(() => assertConfidentialWhitelist(db, db.bookings![0]));
});

test('重建访问授权会撤销被移除参会人的专用授权，通知用途最小化', () => {
  const db = makeDb();
  rebuildConfidentialAccessGrants(db, db.bookings!, requester.id);
  assert.equal(db.confidentialAccessGrants!.filter(item => item.bookingId === 'secret-1').length, 3);
  const changed = { ...db.bookings![0], attendeeIds: [] };
  rebuildConfidentialAccessGrants(db, [changed], requester.id);
  assert.equal(db.confidentialAccessGrants!.some(item => item.bookingId === changed.id && item.userId === attendee.id), false);
  assert.equal(bookingNoticePurpose(changed), '涉密会议');
  assert.equal(bookingNoticePurpose({ ...changed, meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL', purpose: '普通会议' }), '「普通会议」');
});

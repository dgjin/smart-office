import test from 'node:test';
import assert from 'node:assert/strict';
import type { ApprovalDelegate, ApprovalNode, Booking, User } from '../types.ts';
import { approveBooking, canApproveBooking, getApprovalGroups, rejectBooking, type ApprovalContext } from '../utils/approval.ts';

const NOW = new Date('2026-11-19T02:00:00.000Z');

const workflow: ApprovalNode[] = [
  { id: 'n1', name: '行政初审', approverRole: 'APPROVAL_ADMIN' },
  { id: 'n2', name: '系统复核', approverRole: 'SYSTEM_ADMIN' }
];

const requester: User = {
  id: 'u1', name: '申请人', email: 'requester@company.com', role: ['EMPLOYEE'], department: '架构组'
};
const approver: User = {
  id: 'u2', name: '审批人', email: 'approver@company.com', role: ['APPROVAL_ADMIN'], department: '行政部'
};
const systemApprover: User = {
  id: 'u3', name: '复核人', email: 'reviewer@company.com', role: ['SYSTEM_ADMIN'], department: '架构组'
};
const delegate: User = {
  id: 'u4', name: '代理人', email: 'delegate@company.com', role: ['EMPLOYEE'], department: '市场部'
};

const makeContext = (overrides: Partial<ApprovalContext> = {}): ApprovalContext => ({
  users: [requester, approver, systemApprover, delegate],
  resources: [{
    id: 'r1', name: '会议室', type: 'ROOM', capacity: 10, location: '1号楼',
    campus: '主园区', features: [], status: 'AVAILABLE'
  }],
  departments: [
    { id: 'dpt-root', name: '集团总部' },
    { id: 'dpt-tech', name: '信息技术部', parentId: 'dpt-root' },
    { id: 'dpt-arch', name: '架构组', parentId: 'dpt-tech' },
    { id: 'dpt-market', name: '市场部', parentId: 'dpt-root' },
    { id: 'dpt-admin', name: '行政部', parentId: 'dpt-root' }
  ],
  delegates: [],
  now: NOW,
  ...overrides
});

const makeBooking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'b1',
  userId: 'u1',
  resourceId: 'r1',
  type: 'ROOM',
  startTime: '2026-11-20T01:00:00.000Z',
  endTime: '2026-11-20T02:00:00.000Z',
  status: 'PENDING',
  purpose: '会议',
  createdAt: '2026-11-19T01:00:00.000Z',
  currentNodeIndex: 0,
  approvalHistory: [],
  ...overrides
});

const makeDelegate = (overrides: Partial<ApprovalDelegate> = {}): ApprovalDelegate => ({
  id: 'delegation-1',
  delegatorId: approver.id,
  delegateId: delegate.id,
  startsAt: '2026-11-19T01:00:00.000Z',
  endsAt: '2026-11-19T03:00:00.000Z',
  createdAt: '2026-11-19T00:00:00.000Z',
  createdBy: systemApprover.id,
  ...overrides
});

test('只有当前节点角色可以审批待审批预约，错误节点角色和已处理预约均被拒绝', () => {
  const booking = makeBooking();
  assert.equal(canApproveBooking(booking, workflow, approver, makeContext()), true);
  assert.equal(canApproveBooking(booking, workflow, systemApprover, makeContext()), false);
  assert.equal(canApproveBooking({ ...booking, currentNodeIndex: 1 }, workflow, approver, makeContext()), false);
  assert.equal(canApproveBooking({ ...booking, currentNodeIndex: 1 }, workflow, systemApprover, makeContext()), true);
  assert.equal(canApproveBooking({ ...booking, status: 'APPROVED' }, workflow, approver, makeContext()), false);
});

test('申请人即使拥有当前节点角色也不能自审', () => {
  const selfApprover = { ...requester, role: ['APPROVAL_ADMIN'] as User['role'] };
  assert.equal(canApproveBooking(makeBooking(), workflow, selfApprover, makeContext()), false);
});

test('部门节点包含子孙部门，但不接受范围外部门', () => {
  const scopedWorkflow: ApprovalNode[] = [{ ...workflow[0], departmentIds: ['dpt-tech'] }];
  const booking = makeBooking({ requesterDepartmentId: 'dpt-arch' });
  assert.equal(canApproveBooking(booking, scopedWorkflow, approver, makeContext()), true);
  assert.equal(canApproveBooking(booking, [{ ...workflow[0], departmentIds: ['dpt-market'] }], approver, makeContext()), false);
  assert.equal(canApproveBooking(makeBooking(), scopedWorkflow, approver, makeContext()), true);
});

test('园区节点只接受申请冻结或资源所属的匹配园区', () => {
  const scopedWorkflow: ApprovalNode[] = [{ ...workflow[0], campuses: ['主园区'] }];
  assert.equal(canApproveBooking(makeBooking({ resourceCampus: '主园区' }), scopedWorkflow, approver, makeContext()), true);
  assert.equal(canApproveBooking(makeBooking(), scopedWorkflow, approver, makeContext()), true);
  assert.equal(canApproveBooking(makeBooking({ resourceCampus: '其他园区' }), scopedWorkflow, approver, makeContext()), false);
  assert.equal(canApproveBooking(makeBooking(), [{ ...workflow[0], campuses: ['其他园区'] }], approver, makeContext()), false);
});

test('审批使用申请时冻结的流程，不受后续新 workflow 影响', () => {
  const frozenWorkflow: ApprovalNode[] = [{ id: 'old', name: '冻结初审', approverRole: 'APPROVAL_ADMIN' }];
  const currentWorkflow: ApprovalNode[] = [{ id: 'new', name: '新系统复核', approverRole: 'SYSTEM_ADMIN' }];
  const booking = makeBooking({ workflowVersion: 1, approvalWorkflow: frozenWorkflow });
  assert.equal(canApproveBooking(booking, currentWorkflow, approver, makeContext()), true);
  assert.equal(canApproveBooking(booking, currentWorkflow, systemApprover, makeContext()), false);
  const result = approveBooking(booking, currentWorkflow, approver.name, undefined, NOW.toISOString());
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.approvalHistory[0].nodeName, '冻结初审');
});

test('有效期内的代理可以按委托人的节点权限审批', () => {
  const context = makeContext({ delegates: [makeDelegate()] });
  assert.equal(canApproveBooking(makeBooking(), workflow, delegate, context), true);
  assert.equal(canApproveBooking({ ...makeBooking(), currentNodeIndex: 1 }, workflow, delegate, context), false);
});

test('未开始和已过期的代理均不能审批', () => {
  const notStarted = makeDelegate({
    id: 'future', startsAt: '2026-11-19T03:00:00.000Z', endsAt: '2026-11-19T04:00:00.000Z'
  });
  const expired = makeDelegate({
    id: 'expired', startsAt: '2026-11-19T00:00:00.000Z', endsAt: '2026-11-19T01:00:00.000Z'
  });
  assert.equal(canApproveBooking(makeBooking(), workflow, delegate, makeContext({ delegates: [notStarted] })), false);
  assert.equal(canApproveBooking(makeBooking(), workflow, delegate, makeContext({ delegates: [expired] })), false);
});

test('委托人是申请人时，代理也不能绕过自审阻断', () => {
  const selfDelegator = { ...requester, role: ['APPROVAL_ADMIN'] as User['role'] };
  const delegation = makeDelegate({ delegatorId: requester.id });
  const context = makeContext({
    users: [selfDelegator, approver, systemApprover, delegate],
    delegates: [delegation]
  });
  assert.equal(canApproveBooking(makeBooking(), workflow, delegate, context), false);
});

test('中间节点通过后进入下一节点并保留审批记录', () => {
  const result = approveBooking(makeBooking(), workflow, '审批人', '材料齐全', '2026-11-19T02:00:00.000Z');
  assert.equal(result.status, 'PENDING');
  assert.equal(result.currentNodeIndex, 1);
  assert.deepEqual(result.approvalHistory[0], {
    nodeName: '行政初审',
    approverName: '审批人',
    status: 'APPROVED',
    comment: '材料齐全',
    timestamp: '2026-11-19T02:00:00.000Z'
  });
});

test('最终节点通过后核准且节点索引不越界', () => {
  const first = approveBooking(makeBooking(), workflow, '初审人');
  const result = approveBooking(first, workflow, '复核人');
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.currentNodeIndex, 1);
  assert.equal(result.approvalHistory.length, 2);
  assert.equal(result.approvalHistory[1].nodeName, '系统复核');
});

test('驳回记录当前节点、意见和最终状态', () => {
  const result = rejectBooking(makeBooking(), workflow, '审批人', '时间不合适', '2026-11-19T02:00:00.000Z');
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.currentNodeIndex, 0);
  assert.equal(result.approvalHistory[0].comment, '时间不合适');
  assert.equal(result.approvalHistory[0].status, 'REJECTED');
});

test('非待审批预约不会重复写入审批记录', () => {
  const booking = { ...makeBooking(), status: 'APPROVED' as const };
  assert.equal(approveBooking(booking, workflow, '审批人'), booking);
  assert.equal(rejectBooking(booking, workflow, '审批人', '重复操作'), booking);
});

test('长期系列按系列和当前节点分组，代表申请按开始时间排序', () => {
  const bookings = [
    makeBooking({ id: 'l2', seriesId: 's1', seriesKind: 'LONG_TERM', startTime: '2026-11-21T01:00:00.000Z', endTime: '2026-11-21T02:00:00.000Z' }),
    makeBooking({ id: 'l1', seriesId: 's1', seriesKind: 'LONG_TERM' }),
    makeBooking({ id: 'next-node', seriesId: 's1', seriesKind: 'LONG_TERM', currentNodeIndex: 1 }),
    makeBooking({ id: 'single', seriesId: 's1' }),
    makeBooking({ id: 'approved', seriesId: 's1', seriesKind: 'LONG_TERM', status: 'APPROVED' })
  ];
  const allNodeApprover: User = { ...approver, role: ['APPROVAL_ADMIN', 'SYSTEM_ADMIN'] };
  const groups = getApprovalGroups(bookings, workflow, allNodeApprover, makeContext());
  assert.equal(groups.length, 3);
  const firstNode = groups.find(group => group.booking.id === 'l1');
  assert.deepEqual(firstNode?.seriesBookings.map(booking => booking.id), ['l1', 'l2']);
  assert.equal(groups.find(group => group.booking.id === 'next-node')?.seriesBookings.length, 1);
  assert.equal(groups.find(group => group.booking.id === 'single')?.seriesBookings.length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type { ApprovalNode, Booking } from '../types.ts';
import { approveBooking, canApproveBooking, rejectBooking } from '../utils/approval.ts';

const workflow: ApprovalNode[] = [
  { id: 'n1', name: '行政初审', approverRole: 'APPROVAL_ADMIN' },
  { id: 'n2', name: '系统复核', approverRole: 'SYSTEM_ADMIN' }
];

const makeBooking = (): Booking => ({
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
  approvalHistory: []
});

test('只有当前节点角色可以审批待审批预约', () => {
  const booking = makeBooking();
  assert.equal(canApproveBooking(booking, workflow, ['APPROVAL_ADMIN']), true);
  assert.equal(canApproveBooking(booking, workflow, ['SYSTEM_ADMIN']), false);
  assert.equal(canApproveBooking({ ...booking, status: 'APPROVED' }, workflow, ['APPROVAL_ADMIN']), false);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULE_SETTINGS } from '../constants.ts';
import type { Booking, Resource } from '../types.ts';
import { ensureApprovalPolicy, resolveApprovalPolicy, type ApprovalPolicyDb } from '../utils/approvalPolicy.ts';
import { addApprovalWorkingMinutes, chinaDateKey } from '../utils/approvalSchedule.ts';

const makeDb = (): ApprovalPolicyDb => {
  const db: ApprovalPolicyDb = {
    workflow: [{ id: 'default', name: '默认审批', approverRole: 'APPROVAL_ADMIN' }],
    workflowVersions: [],
    approvalRuleSetVersions: []
  };
  ensureApprovalPolicy(db);
  return db;
};

const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'b1', userId: 'u1', resourceId: 'r1', type: 'ROOM', startTime: '2026-11-23T02:00:00.000Z',
  endTime: '2026-11-23T03:00:00.000Z', status: 'PENDING', purpose: '会议', createdAt: '2026-11-20T01:00:00.000Z',
  currentNodeIndex: 0, approvalHistory: [], meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL', ...overrides
});

const resource: Resource = {
  id: 'r1', name: '会议室', type: 'ROOM', capacity: 10, location: '主楼 10层', features: [], status: 'AVAILABLE'
};

test('动态规则覆盖普通、重要、涉密、专属和重服务流程并给出命中解释', () => {
  const db = makeDb();
  const normal = resolveApprovalPolicy(db, booking(), resource);
  assert.equal(normal.ruleId, undefined);
  assert.equal(normal.nodes[0].name, '默认审批');
  assert.match(normal.explanation[0], /未命中特殊规则/);

  const important = resolveApprovalPolicy(db, booking({ meetingType: 'IMPORTANT' }), resource);
  assert.equal(important.ruleId, 'important');
  assert.equal(important.nodes.length, 2);
  assert.match(important.explanation[0], /IMPORTANT/);

  const confidential = resolveApprovalPolicy(db, booking({ meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL' }), resource);
  assert.equal(confidential.ruleId, 'confidential');
  assert.deepEqual(confidential.nodes.map(node => node.approverRole), ['APPROVAL_ADMIN', 'SECURITY_ADMIN', 'SYSTEM_ADMIN']);

  const exclusive = resolveApprovalPolicy(db, booking(), { ...resource, isExclusive: true });
  assert.equal(exclusive.ruleId, 'exclusive');
  const heavy = resolveApprovalPolicy(db, booking({ serviceRequirements: [{ type: 'VIDEO' }] }), resource);
  assert.equal(heavy.ruleId, 'heavy-service');
});

test('组合场景按优先级选择唯一规则且规则集初始化幂等', () => {
  const db = makeDb();
  const before = structuredClone(db.approvalRuleSetVersions);
  ensureApprovalPolicy(db);
  assert.deepEqual(db.approvalRuleSetVersions, before);
  const resolved = resolveApprovalPolicy(db, booking({
    meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL', serviceRequirements: [{ type: 'SECURITY' }]
  }), { ...resource, isExclusive: true });
  assert.equal(resolved.ruleId, 'confidential');
  assert.equal(resolved.ruleSetVersion, 1);
  assert.equal(resolved.workflowVersion, db.approvalRuleSetVersions![0].rules.find(rule => rule.id === 'confidential')!.workflowVersion);
});

test('审批工作时间支持跨班、周末和节假日，临近开始时间不被隐式延长', () => {
  const settings = { ...DEFAULT_RULE_SETTINGS, approvalHolidays: ['2026-11-23'] };
  assert.equal(addApprovalWorkingMinutes('2026-11-20T08:30:00+08:00', 60, settings).toISOString(), '2026-11-20T02:00:00.000Z');
  assert.equal(addApprovalWorkingMinutes('2026-11-20T17:30:00+08:00', 60, settings).toISOString(), '2026-11-24T01:30:00.000Z');
  assert.equal(addApprovalWorkingMinutes('2026-11-21T10:00:00+08:00', 30, settings).toISOString(), '2026-11-24T01:30:00.000Z');
  assert.equal(addApprovalWorkingMinutes('2026-11-24T17:00:00+08:00', 30, settings).toISOString(), '2026-11-24T09:30:00.000Z');
  assert.equal(chinaDateKey('2026-11-20T16:30:00.000Z'), '2026-11-21');
});

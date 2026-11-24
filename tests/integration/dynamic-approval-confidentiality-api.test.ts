import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { ApprovalRuleSetVersion, Booking, ConfidentialityAuthorization, ConfidentialWhitelistEntry, User } from '../../types.ts';
import { integrationEnabled, mutateTestCollection, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
const jsonBody = (value: unknown) => ({ body: JSON.stringify(value) });
const readJson = async (response: Response) => response.json() as Promise<any>;
type Session = Awaited<ReturnType<TestServer['login']>>;

const ids = {
  admin: '1', approver: '2', requester: '3', security: 'u-mrp3-security',
  service: 'u-mrp3-service', frontDesk: 'u-mrp3-front-desk', auditor: 'u-mrp3-auditor',
  outsider: 'u-mrp3-outsider', oldAttendee: 'u-mrp3-old-attendee', newAttendee: 'u-mrp3-new-attendee',
  recoveryManager: 'u-mrp3-recovery-manager'
};
const exclusiveResourceId = 'r-mrp3-exclusive';
const accessResourceId = 'r-mrp3-access';
const sessions = new Map<string, Session>();
const whitelist = new Map<string, ConfidentialWhitelistEntry>();
let bookingSequence = 0;

const session = (userId: string) => {
  const value = sessions.get(userId);
  assert.ok(value, `缺少测试会话 ${userId}`);
  return value;
};

const readCollection = async <T>(key: string): Promise<T[]> => {
  const rows = await queryTestDb<any[]>('SELECT payload FROM office_state WHERE state_key = ?', [key]);
  assert.equal(rows.length, 1);
  return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
};

const readBooking = async (bookingId: string): Promise<Booking> => {
  const rows = await queryTestDb<any[]>('SELECT payload FROM bookings WHERE id = ?', [bookingId]);
  assert.equal(rows.length, 1);
  return (typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload) as Booking;
};

const createUser = async (id: string, name: string, role: string[]) => {
  const response = await server.request('/api/users', {
    method: 'POST', headers: { Cookie: session(ids.admin).cookie }, ...jsonBody({
      user: {
        id, name, email: `${id}@company.com`, role, department: '市场部',
        landline: '010-88889999', mobile: '13800009999'
      }
    })
  });
  assert.equal(response.status, 201, JSON.stringify(await readJson(response.clone())));
  sessions.set(id, await server.login(id));
};

const addWhitelist = async (userId: string) => {
  const existing = whitelist.get(userId);
  if (existing) return existing;
  const response = await server.request('/api/confidential-whitelist', {
    method: 'POST', headers: { Cookie: session(ids.admin).cookie }, ...jsonBody({
      entry: { userId, reason: 'MRP3 隔离集成测试授权' }
    })
  });
  assert.equal(response.status, 201, JSON.stringify(await readJson(response.clone())));
  const entry = (await readJson(response)).entry as ConfidentialWhitelistEntry;
  whitelist.set(userId, entry);
  return entry;
};

const createBooking = async (
  userId: string,
  purpose: string,
  overrides: Record<string, unknown> = {}
): Promise<Booking> => {
  const start = new Date(Date.now() + (20 + bookingSequence++) * 86400000);
  start.setUTCHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 3600000);
  const booking = {
    id: crypto.randomUUID(), userId, resourceId: 'r1', type: 'ROOM',
    startTime: start.toISOString(), endTime: end.toISOString(), status: 'PENDING',
    purpose, participants: 2, meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL',
    createdAt: new Date().toISOString(), currentNodeIndex: 0, approvalHistory: [], ...overrides
  };
  const response = await server.request('/api/bookings', {
    method: 'POST', headers: { Cookie: session(userId).cookie }, ...jsonBody({ booking })
  });
  assert.equal(response.status, 201, JSON.stringify(await readJson(response.clone())));
  return (await readJson(response)).booking;
};

const editBooking = async (userId: string, booking: Booking, changes: Record<string, unknown>) =>
  server.request(`/api/bookings/${encodeURIComponent(booking.id)}`, {
    method: 'PUT', headers: { Cookie: session(userId).cookie }, ...jsonBody({
      booking: { ...booking, ...changes }
    })
  });

const approve = (userId: string, bookingId: string) => server.request('/api/agent/action', {
  method: 'POST', headers: { Cookie: session(userId).cookie }, ...jsonBody({
    action: { type: 'PROPOSE_APPROVAL', bookingId, decision: 'APPROVE', comment: 'MRP3 集成测试通过', summary: '通过审批' }
  })
});

const authorize = async (userId: string, bookingId: string, action: 'DECLASSIFY' | 'ATTENDEE_CHANGE') => {
  const response = await server.request(`/api/bookings/${encodeURIComponent(bookingId)}/confidential-authorizations`, {
    method: 'POST', headers: { Cookie: session(userId).cookie }, ...jsonBody({ action, reason: 'MRP3 变更授权集成验证' })
  });
  assert.equal(response.status, 201, JSON.stringify(await readJson(response.clone())));
  return (await readJson(response)).authorization as ConfidentialityAuthorization;
};

const insertApprovedCompetitor = async (booking: Booking, id: string, startTime: string, endTime: string, resourceId = booking.resourceId) => {
  const payload: Booking = {
    ...booking, id, resourceId, startTime, endTime, status: 'APPROVED', purpose: '最终核准重检竞争预约',
    approvalHistory: [], currentNodeIndex: 0, attendeeIds: [], approvalWorkflow: []
  };
  await queryTestDb(`INSERT INTO bookings (id, user_id, resource_id, start_time, end_time, status, payload, created_at)
    VALUES (?, ?, ?, ?, ?, 'APPROVED', ?, ?)`, [id, booking.userId, resourceId, new Date(startTime), new Date(endTime), JSON.stringify(payload), new Date()]);
};

const publishDefaultWorkflow = async () => {
  const response = await server.request('/api/workflow', {
    method: 'PUT', headers: { Cookie: session(ids.admin).cookie }, ...jsonBody({
      workflow: [
        { id: 'mrp3-default-review', name: 'MRP3 默认业务审核', approverRole: 'APPROVAL_ADMIN' },
        { id: 'mrp3-default-final', name: 'MRP3 默认最终核准', approverRole: 'SYSTEM_ADMIN' }
      ]
    })
  });
  assert.equal(response.status, 200, JSON.stringify(await readJson(response.clone())));
};

describe('MRP3 动态审批与保密控制 API 集成验证', { skip: !integrationEnabled, concurrency: false }, () => {
  before(async () => {
    await resetTestDb();
    await server.start();
    sessions.set(ids.admin, await server.login(ids.admin));
    for (const [id, name, role] of [
      [ids.security, '保密管理员', ['SECURITY_ADMIN']],
      [ids.service, '会务协调员', ['SERVICE_COORDINATOR']],
      [ids.frontDesk, '前台人员', ['FRONT_DESK']],
      [ids.auditor, '审计员', ['AUDITOR']],
      [ids.outsider, '无关员工', ['EMPLOYEE']],
      [ids.oldAttendee, '原参会人', ['EMPLOYEE']],
      [ids.newAttendee, '新参会人', ['EMPLOYEE']],
      [ids.recoveryManager, '涉密恢复复核人', ['SECURITY_ADMIN', 'APPROVAL_ADMIN', 'SERVICE_COORDINATOR']]
    ] as Array<[string, string, string[]]>) await createUser(id, name, role);
    sessions.set(ids.approver, await server.login(ids.approver));
    sessions.set(ids.requester, await server.login(ids.requester));
    await addWhitelist(ids.requester);

    for (const resource of [
      {
        id: exclusiveResourceId, name: 'MRP3 专属会议室', type: 'ROOM', capacity: 20,
        location: '主楼 8层', building: 'MAIN', floor: 8, campus: '集成测试园区', features: ['视频会议系统'],
        status: 'AVAILABLE', isExclusive: true, exclusiveLeaderLevel: '公司领导', isPublic: false
      },
      {
        id: accessResourceId, name: 'MRP3 准入重检会议室', type: 'ROOM', capacity: 10,
        location: '主楼 9层', building: 'MAIN', floor: 9, campus: '集成测试园区', features: [],
        status: 'AVAILABLE', isPublic: true
      }
    ]) {
      const response = await server.request('/api/resources', {
        method: 'POST', headers: { Cookie: session(ids.admin).cookie }, ...jsonBody({ resource })
      });
      assert.equal(response.status, 201, JSON.stringify(await readJson(response.clone())));
    }
  });

  after(async () => {
    await server.stop();
  });

  it('普通、重要、涉密、专属、重服务及组合场景命中可解释规则并冻结版本', async () => {
    await addWhitelist(ids.requester);
    const ruleSets = await readCollection<ApprovalRuleSetVersion>('approvalRuleSetVersions');
    const initialRuleSet = ruleSets.sort((a, b) => b.version - a.version)[0];
    const normal = await createBooking(ids.requester, '普通会议规则');
    const important = await createBooking(ids.requester, '重要会议规则', { meetingType: 'IMPORTANT' });
    const heavy = await createBooking(ids.requester, '重服务会议规则', { serviceRequirements: [{ type: 'VIDEO', details: '视频保障' }] });
    const importantHeavy = await createBooking(ids.requester, '重要加重服务组合规则', {
      meetingType: 'IMPORTANT', serviceRequirements: [{ type: 'SIGNAGE', details: '门口屏' }]
    });
    const exclusiveStart = new Date(Date.now() + 4 * 3600000);
    const exclusive = await createBooking(ids.requester, '专属资源规则', {
      resourceId: exclusiveResourceId, startTime: exclusiveStart.toISOString(), endTime: new Date(exclusiveStart.getTime() + 3600000).toISOString(),
      hasLeader: true, exclusiveRequestReason: '公司领导临时会议'
    });
    const combinedStart = new Date(Date.now() + 5 * 3600000);
    const combined = await createBooking(ids.requester, '涉密专属重服务组合规则', {
      resourceId: exclusiveResourceId, startTime: combinedStart.toISOString(), endTime: new Date(combinedStart.getTime() + 3600000).toISOString(),
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL', hasLeader: true, exclusiveRequestReason: '涉密专属临时使用',
      serviceRequirements: [{ type: 'SECURITY', details: '保密保障' }]
    });

    assert.equal(normal.approvalRuleId, undefined);
    assert.equal(normal.workflowVersion, initialRuleSet.defaultWorkflowVersion);
    assert.match(normal.approvalRuleExplanation?.[0] || '', /未命中特殊规则/);
    assert.equal(important.approvalRuleId, 'important');
    assert.equal(heavy.approvalRuleId, 'heavy-service');
    assert.equal(importantHeavy.approvalRuleId, 'important');
    assert.equal(exclusive.approvalRuleId, 'exclusive');
    assert.equal(combined.approvalRuleId, 'confidential');
    assert.match(combined.approvalRuleExplanation?.[0] || '', /涉密会议保密审批/);
    assert.deepEqual(combined.approvalWorkflow?.map(node => node.approverRole), ['APPROVAL_ADMIN', 'SECURITY_ADMIN', 'SYSTEM_ADMIN']);
    assert.equal(normal.status, 'APPROVED');
    assert.deepEqual(normal.approvalWorkflow, []);
    assert.equal(normal.approvalHistory[0]?.nodeName, '系统自动核准');
    for (const booking of [normal, important, heavy, importantHeavy, exclusive, combined]) {
      assert.equal(booking.approvalRuleSetVersion, initialRuleSet.version);
      assert.ok(booking.workflowVersion && booking.ruleVersion && booking.approvalSubmittedAt);
    }
    for (const booking of [important, heavy, importantHeavy, exclusive, combined]) assert.equal(booking.status, 'PENDING');
    const relation = await queryTestDb<any[]>('SELECT workflow_version, approval_rule_set_version, approval_rule_id, approval_submitted_at FROM bookings WHERE id = ?', [combined.id]);
    assert.equal(relation[0].workflow_version, combined.workflowVersion);
    assert.equal(relation[0].approval_rule_set_version, combined.approvalRuleSetVersion);
    assert.equal(relation[0].approval_rule_id, 'confidential');
    assert.ok(relation[0].approval_submitted_at);

    await publishDefaultWorkflow();
    const afterPublish = await createBooking(ids.requester, '发布后通用特殊流程新版本', { meetingType: 'IMPORTANT' });
    assert.equal(afterPublish.approvalRuleSetVersion, initialRuleSet.version + 1);
    assert.notEqual(afterPublish.workflowVersion, normal.workflowVersion);
    assert.equal(afterPublish.status, 'PENDING');
    assert.deepEqual(afterPublish.approvalWorkflow?.map(node => node.id), ['mrp3-default-review', 'mrp3-default-final']);
    assert.equal((await readBooking(normal.id)).approvalRuleSetVersion, initialRuleSet.version);
    assert.deepEqual((await readBooking(combined.id)).approvalWorkflow, combined.approvalWorkflow);
  });

  it('管理员可发布动态规则集且非法配置、越权和过期草稿均被拒绝', async () => {
    const ruleSets = await readCollection<ApprovalRuleSetVersion>('approvalRuleSetVersions');
    const current = ruleSets.sort((a, b) => b.version - a.version)[0];
    const validRule = {
      id: 'admin-normal-heavy', name: '管理员维护普通重服务审批', priority: 450,
      conditions: { meetingTypes: ['NORMAL'], heavyService: true }, workflowVersion: current.defaultWorkflowVersion
    };
    const publish = (userId: string, body: Record<string, unknown>) => server.request('/api/approval-rule-set', {
      method: 'PUT', headers: { Cookie: session(userId).cookie }, ...jsonBody(body)
    });
    const base = { baseVersion: current.version, defaultWorkflowVersion: current.defaultWorkflowVersion };
    const forbidden = await publish(ids.outsider, { ...base, rules: [...current.rules, validRule] });
    assert.equal(forbidden.status, 403);
    for (const [rules, expectedStatus, expectedCode] of [
      [[{ ...validRule, conditions: {} }], 400, 'INVALID_APPROVAL_RULE'],
      [[{ ...validRule, priority: current.rules[0].priority }], 409, 'DUPLICATE_APPROVAL_RULE_PRIORITY'],
      [[{ ...validRule, workflowVersion: 999999 }], 400, 'INVALID_APPROVAL_RULE']
    ] as Array<[unknown[], number, string]>) {
      const response = await publish(ids.admin, { ...base, rules: [...current.rules, ...rules] });
      assert.equal(response.status, expectedStatus);
      assert.equal((await readJson(response)).error, expectedCode);
    }
    const stale = await publish(ids.admin, { ...base, baseVersion: current.version - 1, rules: [...current.rules, validRule] });
    assert.equal(stale.status, 409);
    assert.equal((await readJson(stale)).error, 'APPROVAL_RULE_SET_CHANGED');
    const unchanged = await publish(ids.admin, { ...base, rules: current.rules });
    assert.equal(unchanged.status, 400);
    assert.equal((await readJson(unchanged)).error, 'APPROVAL_RULE_SET_UNCHANGED');
    assert.equal((await readCollection<ApprovalRuleSetVersion>('approvalRuleSetVersions')).length, ruleSets.length);
  });

  it('规则集发布后新申请命中新规则而在途申请和历史版本保持不变', async () => {
    const ruleSets = await readCollection<ApprovalRuleSetVersion>('approvalRuleSetVersions');
    const current = ruleSets.sort((a, b) => b.version - a.version)[0];
    const inFlight = await createBooking(ids.requester, '规则维护前在途重要申请', { meetingType: 'IMPORTANT' });
    const customRule = {
      id: 'admin-normal-heavy', name: '管理员维护普通重服务审批', priority: 450,
      conditions: { meetingTypes: ['NORMAL'], heavyService: true }, workflowVersion: current.defaultWorkflowVersion
    };
    const response = await server.request('/api/approval-rule-set', {
      method: 'PUT', headers: { Cookie: session(ids.admin).cookie }, ...jsonBody({
        baseVersion: current.version,
        defaultWorkflowVersion: current.defaultWorkflowVersion,
        rules: [...current.rules, customRule]
      })
    });
    assert.equal(response.status, 200, JSON.stringify(await readJson(response.clone())));
    const published = (await readJson(response)).ruleSet as ApprovalRuleSetVersion;
    assert.equal(published.version, current.version + 1);
    assert.equal(published.createdBy, ids.admin);
    assert.ok(published.rules.some(rule => rule.id === customRule.id));

    const booking = await createBooking(ids.requester, '新发布普通重服务规则命中', {
      serviceRequirements: [{ type: 'VIDEO', details: '管理员规则集成验证' }]
    });
    assert.equal(booking.approvalRuleSetVersion, published.version);
    assert.equal(booking.approvalRuleId, customRule.id);
    assert.equal(booking.status, 'PENDING');
    const frozen = await readBooking(inFlight.id);
    assert.equal(frozen.approvalRuleSetVersion, current.version);
    assert.equal(frozen.approvalRuleId, 'important');
    const allVersions = await readCollection<ApprovalRuleSetVersion>('approvalRuleSetVersions');
    assert.deepEqual(allVersions.find(version => version.version === current.version), current);
    const audits = await queryTestDb<any[]>('SELECT actor_id, details FROM audit_events WHERE action = ? AND entity_id = ?', ['APPROVAL_RULE_SET_PUBLISH', String(published.version)]);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actor_id, ids.admin);
    const details = typeof audits[0].details === 'string' ? JSON.parse(audits[0].details) : audits[0].details;
    assert.equal(details.before.version, current.version);
    assert.equal(details.after.version, published.version);

    const restored = await server.request('/api/approval-rule-set', {
      method: 'PUT', headers: { Cookie: session(ids.admin).cookie }, ...jsonBody({
        baseVersion: published.version,
        defaultWorkflowVersion: current.defaultWorkflowVersion,
        rules: current.rules
      })
    });
    assert.equal(restored.status, 200, JSON.stringify(await readJson(restored.clone())));
  });

  it('GAP-04 专属预约编辑和最终核准均重检领导参会标识', async () => {
    const start = new Date(Date.now() + 6 * 3600000);
    const booking = await createBooking(ids.requester, 'GAP04专属领导参会重检', {
      resourceId: exclusiveResourceId, startTime: start.toISOString(), endTime: new Date(start.getTime() + 3600000).toISOString(),
      hasLeader: true, exclusiveRequestReason: '公司领导临时会议'
    });
    const rejectedEdit = await editBooking(ids.requester, booking, { hasLeader: false });
    assert.equal(rejectedEdit.status, 400);
    assert.equal((await readJson(rejectedEdit)).error, 'EXCLUSIVE_LEADER_REQUIRED');
    assert.equal((await readBooking(booking.id)).hasLeader, true);

    assert.equal((await approve(ids.approver, booking.id)).status, 200);
    const approvedNode = await readBooking(booking.id);
    assert.equal(approvedNode.currentNodeIndex, 1);
    assert.equal(approvedNode.approvalHistory.length, 1);
    await queryTestDb('UPDATE bookings SET payload = ? WHERE id = ?', [JSON.stringify({ ...approvedNode, hasLeader: false }), booking.id]);
    const rejectedFinal = await approve(ids.admin, booking.id);
    assert.equal(rejectedFinal.status, 400, JSON.stringify(await readJson(rejectedFinal.clone())));
    assert.equal((await readJson(rejectedFinal)).error, 'EXCLUSIVE_LEADER_REQUIRED');
    const unchanged = await readBooking(booking.id);
    assert.equal(unchanged.status, 'PENDING');
    assert.equal(unchanged.currentNodeIndex, 1);
    assert.equal(unchanged.approvalHistory.length, 1);
  });

  it('七类角色在保密管理和默认审批节点上执行正向与反向权限控制', async () => {
    const booking = await createBooking(ids.requester, '七角色审批权限矩阵', { meetingType: 'IMPORTANT' });
    const roleIds = [ids.admin, ids.approver, ids.requester, ids.security, ids.service, ids.frontDesk, ids.auditor];
    for (const userId of roleIds) {
      const expectedManager = userId === ids.admin || userId === ids.security;
      const targetUser = userId === ids.admin ? ids.service : userId === ids.security ? ids.frontDesk : ids.auditor;
      const response = await server.request('/api/confidential-whitelist', {
        method: 'POST', headers: { Cookie: session(userId).cookie }, ...jsonBody({
          entry: { userId: targetUser, reason: `${userId} 角色权限验证` }
        })
      });
      assert.equal(response.status, expectedManager ? 201 : 403, `${userId}: ${JSON.stringify(await readJson(response.clone()))}`);
      if (expectedManager) whitelist.set(targetUser, (await readJson(response)).entry);
    }

    for (const userId of roleIds.filter(id => id !== ids.approver)) {
      const response = await approve(userId, booking.id);
      assert.equal(response.status, 403, `${userId} 不应通过业务初审`);
    }
    assert.equal((await approve(ids.approver, booking.id)).status, 200);
    for (const userId of roleIds.filter(id => id !== ids.admin)) {
      const response = await approve(userId, booking.id);
      assert.equal(response.status, 403, `${userId} 不应通过最终核准`);
    }
    assert.equal((await approve(ids.admin, booking.id)).status, 200);
    const persisted = await readBooking(booking.id);
    assert.equal(persisted.status, 'APPROVED');
    assert.equal(persisted.approvalHistory.length, 2);
  });

  it('涉密专用节点仅保密管理员可审，申请人不能自我签发变更授权', async () => {
    await addWhitelist(ids.admin);
    const own = await createBooking(ids.admin, '管理员本人涉密申请', {
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL'
    });
    const selfAuthorization = await server.request(`/api/bookings/${own.id}/confidential-authorizations`, {
      method: 'POST', headers: { Cookie: session(ids.admin).cookie }, ...jsonBody({ action: 'DECLASSIFY', reason: '尝试自我授权' })
    });
    assert.equal(selfAuthorization.status, 403);
    assert.equal((await readJson(selfAuthorization)).error, 'CONFIDENTIAL_SELF_AUTHORIZATION');

    const booking = await createBooking(ids.requester, '涉密保密节点权限', {
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL'
    });
    assert.equal((await approve(ids.security, booking.id)).status, 403);
    assert.equal((await approve(ids.approver, booking.id)).status, 200);
    for (const userId of [ids.admin, ids.approver, ids.requester, ids.service, ids.frontDesk, ids.auditor]) {
      assert.equal((await approve(userId, booking.id)).status, 403);
    }
    assert.equal((await approve(ids.security, booking.id)).status, 200);
    assert.equal((await readBooking(booking.id)).currentNodeIndex, 2);
    assert.equal((await approve(ids.admin, booking.id)).status, 200);
  });

  it('最终核准事务内重检资源冲突并保持原审批节点不变', async () => {
    const booking = await createBooking(ids.requester, '最终核准资源竞争', { meetingType: 'IMPORTANT' });
    assert.equal((await approve(ids.approver, booking.id)).status, 200);
    await insertApprovedCompetitor(booking, `competitor-${booking.id}`, booking.startTime, booking.endTime);
    const response = await approve(ids.admin, booking.id);
    assert.equal(response.status, 409);
    assert.equal((await readJson(response)).error, 'CONFLICT');
    const persisted = await readBooking(booking.id);
    assert.equal(persisted.status, 'PENDING');
    assert.equal(persisted.currentNodeIndex, 1);
    assert.equal(persisted.approvalHistory.length, 1);
  });

  it('最终核准事务内重检部门额度和资源准入', async () => {
    const targetStart = new Date(Date.now() + (80 + bookingSequence++) * 86400000);
    targetStart.setUTCHours(2, 0, 0, 0);
    const targetEnd = new Date(targetStart.getTime() + 180 * 60000);
    const target = await createBooking(ids.requester, '最终核准额度重检三小时申请', {
      resourceId: 'r2', startTime: targetStart.toISOString(), endTime: targetEnd.toISOString(), meetingType: 'IMPORTANT'
    });
    assert.equal((await approve(ids.approver, target.id)).status, 200);
    const competitorStart = new Date(targetStart.getTime() + 5 * 3600000);
    await insertApprovedCompetitor(target, `quota-${target.id}`, competitorStart.toISOString(), new Date(competitorStart.getTime() + 120 * 60000).toISOString(), 'r2');
    const quotaResponse = await approve(ids.admin, target.id);
    assert.equal(quotaResponse.status, 409);
    assert.equal((await readJson(quotaResponse)).error, 'DEPARTMENT_DAILY_QUOTA_EXCEEDED');
    assert.equal((await readBooking(target.id)).currentNodeIndex, 1);

    const access = await createBooking(ids.requester, '最终核准资源准入重检', { resourceId: accessResourceId, meetingType: 'IMPORTANT' });
    assert.equal((await approve(ids.approver, access.id)).status, 200);
    await mutateTestCollection<any>('resources', resources => resources.map(resource =>
      resource.id === accessResourceId ? { ...resource, status: 'MAINTENANCE' } : resource
    ));
    const accessResponse = await approve(ids.admin, access.id);
    assert.equal(accessResponse.status, 409);
    assert.equal((await readJson(accessResponse)).error, 'RESOURCE_MAINTENANCE');
    assert.equal((await readBooking(access.id)).currentNodeIndex, 1);
  });

  it('已核准涉密预约可签发一次性参会变更授权并重新进入审批', async () => {
    await addWhitelist(ids.newAttendee);
    const booking = await createBooking(ids.requester, '已核准涉密参会变更', {
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL'
    });
    assert.equal((await approve(ids.approver, booking.id)).status, 200);
    assert.equal((await approve(ids.security, booking.id)).status, 200);
    assert.equal((await approve(ids.admin, booking.id)).status, 200);
    const approved = await readBooking(booking.id);
    assert.equal(approved.status, 'APPROVED');

    const workspace = await readJson(await server.request('/api/workspace', { headers: { Cookie: session(ids.security).cookie } }));
    const target = workspace.confidentialAuthorizationTargets.find((item: any) => item.id === booking.id);
    assert.equal(target.status, 'APPROVED');
    assert.equal(Object.hasOwn(target, 'purpose'), false);

    const authorization = await authorize(ids.security, booking.id, 'ATTENDEE_CHANGE');
    const changedResponse = await editBooking(ids.requester, approved, {
      attendeeIds: [ids.newAttendee], securityAuthorizationIds: [authorization.id]
    });
    assert.equal(changedResponse.status, 200, JSON.stringify(await readJson(changedResponse.clone())));
    const changed = (await readJson(changedResponse)).booking as Booking;
    assert.equal(changed.status, 'PENDING');
    assert.equal(changed.currentNodeIndex, 0);
    assert.deepEqual(changed.attendeeIds, [ids.newAttendee]);
    const authorizations = await readCollection<ConfidentialityAuthorization>('confidentialityAuthorizations');
    assert.ok(authorizations.find(item => item.id === authorization.id)?.usedAt);
  });

  it('涉密参会范围变化需单次授权并撤销旧访问，降级需两个不同授权人且授权一次性核销', async () => {
    await Promise.all([ids.oldAttendee, ids.newAttendee].map(id => addWhitelist(id)));
    const attendeeBooking = await createBooking(ids.requester, '涉密参会范围调整', {
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL', attendeeIds: [ids.oldAttendee]
    });
    const unauthorizedEdit = await editBooking(ids.requester, attendeeBooking, { attendeeIds: [ids.newAttendee] });
    assert.equal(unauthorizedEdit.status, 403);
    assert.equal((await readJson(unauthorizedEdit)).error, 'CONFIDENTIAL_ATTENDEE_AUTHORIZATION_REQUIRED');
    const attendeeAuthorization = await authorize(ids.security, attendeeBooking.id, 'ATTENDEE_CHANGE');
    const attendeeEdit = await editBooking(ids.requester, attendeeBooking, {
      attendeeIds: [ids.newAttendee], securityAuthorizationIds: [attendeeAuthorization.id]
    });
    assert.equal(attendeeEdit.status, 200, JSON.stringify(await readJson(attendeeEdit.clone())));
    assert.equal((await approve(ids.approver, attendeeBooking.id)).status, 200);
    assert.equal((await approve(ids.security, attendeeBooking.id)).status, 200);
    assert.equal((await approve(ids.admin, attendeeBooking.id)).status, 200);
    assert.equal((await server.request(`/api/bookings/${attendeeBooking.id}/ics`, { headers: { Cookie: session(ids.oldAttendee).cookie } })).status, 403);
    assert.equal((await server.request(`/api/bookings/${attendeeBooking.id}/ics`, { headers: { Cookie: session(ids.newAttendee).cookie } })).status, 200);
    const grants = await readCollection<any>('confidentialAccessGrants');
    assert.equal(grants.some((item: any) => item.bookingId === attendeeBooking.id && item.userId === ids.oldAttendee), false);
    assert.equal(grants.some((item: any) => item.bookingId === attendeeBooking.id && item.userId === ids.newAttendee), true);

    const declassify = await createBooking(ids.requester, '涉密降级双授权', {
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL'
    });
    const adminFirst = await authorize(ids.admin, declassify.id, 'DECLASSIFY');
    const adminSecond = await authorize(ids.admin, declassify.id, 'DECLASSIFY');
    const securityGrant = await authorize(ids.security, declassify.id, 'DECLASSIFY');
    const oneGrant = await editBooking(ids.requester, declassify, {
      meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL', securityAuthorizationIds: [adminFirst.id]
    });
    assert.equal(oneGrant.status, 403);
    assert.equal((await readJson(oneGrant)).error, 'CONFIDENTIAL_DECLASSIFY_DUAL_AUTHORIZATION_REQUIRED');
    const sameAuthorizer = await editBooking(ids.requester, declassify, {
      meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL', securityAuthorizationIds: [adminFirst.id, adminSecond.id]
    });
    assert.equal(sameAuthorizer.status, 403);
    assert.equal((await readJson(sameAuthorizer)).error, 'INVALID_CONFIDENTIALITY_AUTHORIZATION');
    const changed = await editBooking(ids.requester, declassify, {
      meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL', securityAuthorizationIds: [adminFirst.id, securityGrant.id]
    });
    assert.equal(changed.status, 200, JSON.stringify(await readJson(changed.clone())));
    const authorizations = await readCollection<ConfidentialityAuthorization>('confidentialityAuthorizations');
    assert.ok(authorizations.find(item => item.id === adminFirst.id)?.usedAt);
    assert.ok(authorizations.find(item => item.id === securityGrant.id)?.usedAt);
    assert.equal(authorizations.find(item => item.id === adminSecond.id)?.usedAt, undefined);

    const reuseTarget = await createBooking(ids.requester, '已核销授权不得复用', {
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL'
    });
    const reused = await editBooking(ids.requester, reuseTarget, {
      meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL', securityAuthorizationIds: [adminFirst.id, securityGrant.id]
    });
    assert.equal(reused.status, 403);
    assert.equal((await readJson(reused)).error, 'INVALID_CONFIDENTIALITY_AUTHORIZATION');

    const normal = await createBooking(ids.requester, '普通编辑不得夹带授权降级');
    const smuggled = await editBooking(ids.requester, normal, {
      purpose: '普通编辑夹带授权', securityAuthorizationIds: [adminFirst.id, securityGrant.id]
    });
    assert.equal(smuggled.status, 403);
    assert.equal((await readBooking(normal.id)).purpose, '普通编辑不得夹带授权降级');
  });

  it('涉密工作区、通知、ICS 和独立访问审计均按最小权限返回', async () => {
    const secret = `绝密项目代号-${crypto.randomUUID()}`;
    const booking = await createBooking(ids.requester, secret, {
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL', needsTeaService: true
    });
    const adminWorkspace = await readJson(await server.request('/api/workspace', { headers: { Cookie: session(ids.admin).cookie } }));
    const redacted = adminWorkspace.bookings.find((item: Booking) => item.id === booking.id);
    assert.equal(redacted.purpose, '已预约');
    assert.equal(redacted.userId, '');
    assert.deepEqual(redacted.attendeeIds, []);
    assert.equal(redacted.contactSnapshot, undefined);
    const authorizationTarget = adminWorkspace.confidentialAuthorizationTargets.find((item: any) => item.id === booking.id);
    assert.deepEqual(authorizationTarget, {
      id: booking.id, userId: ids.requester, startTime: booking.startTime, status: 'PENDING',
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL'
    });
    assert.equal(Object.hasOwn(authorizationTarget, 'purpose'), false);
    const requesterWorkspace = await readJson(await server.request('/api/workspace', { headers: { Cookie: session(ids.requester).cookie } }));
    assert.equal(requesterWorkspace.bookings.find((item: Booking) => item.id === booking.id).purpose, secret);
    assert.equal(requesterWorkspace.confidentialAuthorizationTargets, undefined);
    const securityWorkspace = await readJson(await server.request('/api/workspace', { headers: { Cookie: session(ids.security).cookie } }));
    assert.equal(securityWorkspace.bookings.find((item: Booking) => item.id === booking.id).purpose, secret);

    for (const userId of [ids.admin, ids.outsider]) {
      const response = await server.request(`/api/bookings/${booking.id}/ics`, { headers: { Cookie: session(userId).cookie } });
      assert.equal(response.status, 403);
      assert.equal((await readJson(response)).error, 'CONFIDENTIAL_EXPORT_FORBIDDEN');
    }
    assert.equal((await approve(ids.approver, booking.id)).status, 200);
    assert.equal((await approve(ids.security, booking.id)).status, 200);
    assert.equal((await approve(ids.admin, booking.id)).status, 200);
    for (const userId of [ids.requester, ids.security]) {
      const response = await server.request(`/api/bookings/${booking.id}/ics`, { headers: { Cookie: session(userId).cookie } });
      assert.equal(response.status, 200, `${userId}: ${await response.clone().text()}`);
      assert.match(response.headers.get('content-type') || '', /text\/calendar/);
      assert.match(await response.text(), new RegExp(secret));
    }
    const leakedNotices = await queryTestDb<any[]>('SELECT id FROM notifications WHERE content LIKE ? OR title LIKE ?', [`%${secret}%`, `%${secret}%`]);
    assert.equal(leakedNotices.length, 0);
    const workOrders = await readCollection<any>('workOrders');
    assert.equal(workOrders.find((item: any) => item.bookingId === booking.id)?.title, '涉密会议茶水服务');
    const pollingReads = await queryTestDb<any[]>('SELECT actor_id FROM audit_events WHERE action = ? AND entity_id = ?', ['CONFIDENTIAL_READ', booking.id]);
    assert.deepEqual(pollingReads, []);
    for (const userId of [ids.requester, ids.security]) {
      const response = await server.request(`/api/bookings/${booking.id}/confidential-read`, {
        method: 'POST', headers: { Cookie: session(userId).cookie }, body: '{}'
      });
      assert.equal(response.status, 200, `${userId}: ${await response.clone().text()}`);
    }
    const forbiddenRead = await server.request(`/api/bookings/${booking.id}/confidential-read`, {
      method: 'POST', headers: { Cookie: session(ids.admin).cookie }, body: '{}'
    });
    assert.equal(forbiddenRead.status, 403);
    const reads = await queryTestDb<any[]>('SELECT actor_id, details FROM audit_events WHERE action = ? AND entity_id = ?', ['CONFIDENTIAL_READ', booking.id]);
    assert.deepEqual(reads.map(row => row.actor_id).sort(), [ids.requester, ids.security].sort());
    assert.ok(reads.every(row => (typeof row.details === 'string' ? JSON.parse(row.details) : row.details).source === 'BOOKING_DETAIL'));
    const exports = await queryTestDb<any[]>('SELECT actor_id FROM audit_events WHERE action = ? AND entity_id = ?', ['CONFIDENTIAL_EXPORT', booking.id]);
    assert.deepEqual(exports.map(row => row.actor_id).sort(), [ids.requester, ids.security].sort());
  });

  it('涉密服务责任人仅凭工单履约且预约主题和人员仍保持脱敏', async () => {
    await addWhitelist(ids.requester);
    const secret = `涉密服务履约-${crypto.randomUUID()}`;
    const booking = await createBooking(ids.requester, secret, {
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL', needsTeaService: true
    });
    assert.equal((await approve(ids.approver, booking.id)).status, 200);
    assert.equal((await approve(ids.security, booking.id)).status, 200);
    assert.equal((await approve(ids.admin, booking.id)).status, 200);
    const order = (await readCollection<any>('workOrders')).find(item => item.bookingId === booking.id);
    assert.ok(order);
    const inspectionId = `inspection-${booking.id}-v1-PRE_OPEN`;
    await mutateTestCollection<any>('serviceInspections', inspections => [{
      id: inspectionId, areaId: 'area-default', bookingId: booking.id, kind: 'PRE_OPEN', dueAt: booking.startTime, status: 'PENDING'
    }, ...inspections.filter(item => item.id !== inspectionId)]);
    const serviceWorkspace = await readJson(await server.request('/api/workspace', { headers: { Cookie: session(ids.service).cookie } }));
    const serviceBooking = serviceWorkspace.bookings.find((item: Booking) => item.id === booking.id);
    assert.equal(serviceBooking.purpose, '已预约');
    assert.equal(serviceBooking.userId, '');
    assert.deepEqual(serviceBooking.attendeeIds, []);
    assert.ok(serviceWorkspace.workOrders.some((item: any) => item.id === order.id));
    assert.ok(serviceWorkspace.serviceInspections.some((item: any) => item.id === inspectionId));
    const unrelatedWorkspace = await readJson(await server.request('/api/workspace', { headers: { Cookie: session(ids.frontDesk).cookie } }));
    assert.equal(unrelatedWorkspace.workOrders.some((item: any) => item.id === order.id), false);
    const started = await server.request(`/api/work-orders/${order.id}/transitions`, {
      method: 'POST', headers: { Cookie: session(ids.service).cookie }, ...jsonBody({ action: 'START' })
    });
    assert.equal(started.status, 200, JSON.stringify(await readJson(started.clone())));
    const completed = await server.request(`/api/work-orders/${order.id}/transitions`, {
      method: 'POST', headers: { Cookie: session(ids.service).cookie },
      ...jsonBody({ action: 'COMPLETE', executionResult: '涉密服务已按工单完成', costAmount: 12 })
    });
    assert.equal(completed.status, 200, JSON.stringify(await readJson(completed.clone())));
    assert.equal((await readJson(completed)).order.status, 'DONE');
    const inspected = await server.request(`/api/service-inspections/${inspectionId}`, {
      method: 'POST', headers: { Cookie: session(ids.service).cookie }, ...jsonBody({ status: 'DONE', note: '涉密会前巡查已完成' })
    });
    assert.equal(inspected.status, 200, JSON.stringify(await readJson(inspected.clone())));
    assert.equal((await readJson(inspected)).inspection.status, 'DONE');
    const forbidden = await server.request(`/api/work-orders/${order.id}/transitions`, {
      method: 'POST', headers: { Cookie: session(ids.frontDesk).cookie }, ...jsonBody({ action: 'EXCEPTION', reason: '无关角色不得操作' })
    });
    assert.equal(forbidden.status, 403);
    const leakedNotices = await queryTestDb<any[]>('SELECT id FROM notifications WHERE content LIKE ? OR title LIKE ?', [`%${secret}%`, `%${secret}%`]);
    assert.equal(leakedNotices.length, 0);
  });

  it('涉密恢复重检白名单并重新进入冻结审批流程', async () => {
    await addWhitelist(ids.requester);
    const booking = await createBooking(ids.requester, '涉密恢复审批与白名单重检', {
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL'
    });
    assert.equal((await approve(ids.approver, booking.id)).status, 200);
    assert.equal((await approve(ids.security, booking.id)).status, 200);
    assert.equal((await approve(ids.admin, booking.id)).status, 200);
    const released = await server.request(`/api/bookings/${booking.id}/release`, {
      method: 'POST', headers: { Cookie: session(ids.recoveryManager).cookie }, ...jsonBody({ reason: '涉密异常释放恢复验证' })
    });
    assert.equal(released.status, 200, JSON.stringify(await readJson(released.clone())));
    const appeal = await server.request(`/api/bookings/${booking.id}/usage-appeals`, {
      method: 'POST', headers: { Cookie: session(ids.requester).cookie }, ...jsonBody({ reason: '涉密异常已核查，申请恢复' })
    });
    assert.equal(appeal.status, 201, JSON.stringify(await readJson(appeal.clone())));
    const appealId = (await readJson(appeal)).appeal.id;
    const entry = whitelist.get(ids.requester)!;
    const removed = await server.request(`/api/confidential-whitelist/${entry.id}`, {
      method: 'DELETE', headers: { Cookie: session(ids.security).cookie }
    });
    assert.equal(removed.status, 200);
    whitelist.delete(ids.requester);
    const blocked = await server.request(`/api/usage-appeals/${appealId}`, {
      method: 'POST', headers: { Cookie: session(ids.recoveryManager).cookie },
      ...jsonBody({ decision: 'RESTORE', note: '白名单撤销后不得恢复' })
    });
    assert.equal(blocked.status, 403, JSON.stringify(await readJson(blocked.clone())));
    assert.equal((await readJson(blocked)).error, 'CONFIDENTIAL_WHITELIST_REQUIRED');
    assert.equal((await readBooking(booking.id)).status, 'CANCELLED');
    await addWhitelist(ids.requester);
    const restored = await server.request(`/api/usage-appeals/${appealId}`, {
      method: 'POST', headers: { Cookie: session(ids.recoveryManager).cookie },
      ...jsonBody({ decision: 'RESTORE', note: '准入恢复后按原流程重审' })
    });
    assert.equal(restored.status, 200, JSON.stringify(await readJson(restored.clone())));
    const restoredBooking = (await readJson(restored)).booking as Booking;
    assert.equal(restoredBooking.status, 'PENDING');
    assert.equal(restoredBooking.currentNodeIndex, 0);
    assert.deepEqual(restoredBooking.approvalHistory, []);
    assert.deepEqual(restoredBooking.approvalWorkflow?.map(node => node.approverRole), ['APPROVAL_ADMIN', 'SECURITY_ADMIN', 'SYSTEM_ADMIN']);
    assert.equal((await approve(ids.approver, booking.id)).status, 200);
    assert.equal((await approve(ids.security, booking.id)).status, 200);
    assert.equal((await approve(ids.admin, booking.id)).status, 200);
  });

  it('白名单撤销后最终核准被阻断且不伪造核准历史', async () => {
    const booking = await createBooking(ids.requester, '白名单撤销最终重检', {
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL'
    });
    assert.equal((await approve(ids.approver, booking.id)).status, 200);
    assert.equal((await approve(ids.security, booking.id)).status, 200);
    const entry = whitelist.get(ids.requester)!;
    const removed = await server.request(`/api/confidential-whitelist/${entry.id}`, {
      method: 'DELETE', headers: { Cookie: session(ids.security).cookie }
    });
    assert.equal(removed.status, 200);
    whitelist.delete(ids.requester);
    const response = await approve(ids.admin, booking.id);
    assert.equal(response.status, 403);
    assert.equal((await readJson(response)).error, 'CONFIDENTIAL_WHITELIST_REQUIRED');
    const persisted = await readBooking(booking.id);
    assert.equal(persisted.status, 'PENDING');
    assert.equal(persisted.currentNodeIndex, 2);
    assert.equal(persisted.approvalHistory.length, 2);
    await addWhitelist(ids.requester);
  });
});

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
  outsider: 'u-mrp3-outsider', oldAttendee: 'u-mrp3-old-attendee', newAttendee: 'u-mrp3-new-attendee'
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
      [ids.newAttendee, '新参会人', ['EMPLOYEE']]
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
      exclusiveRequestReason: '公司领导临时会议'
    });
    const combinedStart = new Date(Date.now() + 5 * 3600000);
    const combined = await createBooking(ids.requester, '涉密专属重服务组合规则', {
      resourceId: exclusiveResourceId, startTime: combinedStart.toISOString(), endTime: new Date(combinedStart.getTime() + 3600000).toISOString(),
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL', exclusiveRequestReason: '涉密专属临时使用',
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
    for (const booking of [normal, important, heavy, importantHeavy, exclusive, combined]) {
      assert.equal(booking.approvalRuleSetVersion, initialRuleSet.version);
      assert.ok(booking.workflowVersion && booking.ruleVersion && booking.approvalSubmittedAt);
      assert.equal(booking.status, 'PENDING');
    }
    const relation = await queryTestDb<any[]>('SELECT workflow_version, approval_rule_set_version, approval_rule_id, approval_submitted_at FROM bookings WHERE id = ?', [combined.id]);
    assert.equal(relation[0].workflow_version, combined.workflowVersion);
    assert.equal(relation[0].approval_rule_set_version, combined.approvalRuleSetVersion);
    assert.equal(relation[0].approval_rule_id, 'confidential');
    assert.ok(relation[0].approval_submitted_at);

    await publishDefaultWorkflow();
    const afterPublish = await createBooking(ids.requester, '发布后默认规则新版本');
    assert.equal(afterPublish.approvalRuleSetVersion, initialRuleSet.version + 1);
    assert.notEqual(afterPublish.workflowVersion, normal.workflowVersion);
    assert.equal((await readBooking(normal.id)).approvalRuleSetVersion, initialRuleSet.version);
    assert.deepEqual((await readBooking(combined.id)).approvalWorkflow, combined.approvalWorkflow);
  });

  it('七类角色在保密管理和默认审批节点上执行正向与反向权限控制', async () => {
    const booking = await createBooking(ids.requester, '七角色审批权限矩阵');
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
    const booking = await createBooking(ids.requester, '最终核准资源竞争');
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
      resourceId: 'r2', startTime: targetStart.toISOString(), endTime: targetEnd.toISOString()
    });
    assert.equal((await approve(ids.approver, target.id)).status, 200);
    const competitorStart = new Date(targetStart.getTime() + 5 * 3600000);
    await insertApprovedCompetitor(target, `quota-${target.id}`, competitorStart.toISOString(), new Date(competitorStart.getTime() + 120 * 60000).toISOString(), 'r1');
    const quotaResponse = await approve(ids.admin, target.id);
    assert.equal(quotaResponse.status, 409);
    assert.equal((await readJson(quotaResponse)).error, 'DEPARTMENT_DAILY_QUOTA_EXCEEDED');
    assert.equal((await readBooking(target.id)).currentNodeIndex, 1);

    const access = await createBooking(ids.requester, '最终核准资源准入重检', { resourceId: accessResourceId });
    assert.equal((await approve(ids.approver, access.id)).status, 200);
    await mutateTestCollection<any>('resources', resources => resources.map(resource =>
      resource.id === accessResourceId ? { ...resource, status: 'MAINTENANCE' } : resource
    ));
    const accessResponse = await approve(ids.admin, access.id);
    assert.equal(accessResponse.status, 409);
    assert.equal((await readJson(accessResponse)).error, 'RESOURCE_MAINTENANCE');
    assert.equal((await readBooking(access.id)).currentNodeIndex, 1);
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
    const reads = await queryTestDb<any[]>('SELECT actor_id FROM audit_events WHERE action = ? AND entity_id = ?', ['CONFIDENTIAL_READ', booking.id]);
    assert.ok(reads.some(row => row.actor_id === ids.requester));
    assert.ok(reads.some(row => row.actor_id === ids.security));
    assert.equal(reads.some(row => row.actor_id === ids.admin), false);
    const exports = await queryTestDb<any[]>('SELECT actor_id FROM audit_events WHERE action = ? AND entity_id = ?', ['CONFIDENTIAL_EXPORT', booking.id]);
    assert.deepEqual(exports.map(row => row.actor_id).sort(), [ids.requester, ids.security].sort());
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

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
let adminId = '';
let userId = '';
let otherUserId = '';

const jsonBody = (value: unknown) => ({ body: JSON.stringify(value) });
const readJson = async (response: Response) => response.json() as Promise<any>;

describe('真实 Node + 隔离 MySQL 集成验证', { skip: !integrationEnabled, concurrency: false }, () => {
  before(async () => {
    await resetTestDb();
    await server.start();
    const response = await server.request('/api/auth/options');
    assert.equal(response.status, 200);
    const options = await readJson(response);
    assert.equal(options.development, true);
    adminId = options.users.find((user: any) => user.role.includes('SYSTEM_ADMIN'))?.id;
    userId = options.users.find((user: any) => !user.role.includes('SYSTEM_ADMIN'))?.id;
    assert.ok(adminId && userId);
  });

  after(async () => {
    await server.stop();
  });

  it('提供健康检查和独立静态页面，默认拒绝未认证业务请求', async () => {
    const health = await server.request('/healthz');
    assert.equal(health.status, 200);
    assert.deepEqual(await readJson(health), { ok: true });
    const page = await server.request('/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') || '', /text\/html/);
    assert.match(await page.text(), /<div id="root">/);
    assert.equal((await server.request('/api/workspace')).status, 401);
    assert.equal((await server.request('/api/notifications')).status, 401);
  });

  it('创建仅保存哈希的 MySQL 会话，并支持身份读取和撤销', async () => {
    const login = await server.login(userId);
    assert.equal(login.body.actor.id, userId);
    assert.match(login.cookie, /^smart_office_session=/);
    const me = await server.request('/api/auth/me', { headers: { Cookie: login.cookie } });
    assert.equal(me.status, 200);
    assert.equal((await readJson(me)).actor.id, userId);
    const sessions = await queryTestDb<any[]>('SELECT token_hash, revoked_at FROM sessions WHERE user_id = ?', [userId]);
    const tokenHash = crypto.createHash('sha256').update(login.token).digest('hex');
    assert.ok(sessions.some(session => session.token_hash === tokenHash));
    assert.ok(sessions.every(session => session.token_hash !== login.token && /^[a-f0-9]{64}$/.test(session.token_hash)));
    const logout = await server.request('/api/auth/logout', { method: 'POST', headers: { Cookie: login.cookie }, ...jsonBody({}) });
    assert.equal(logout.status, 200);
    assert.equal((await server.request('/api/auth/me', { headers: { Cookie: login.cookie } })).status, 401);
    const revoked = await queryTestDb<any[]>('SELECT revoked_at FROM sessions WHERE token_hash = ?', [tokenHash]);
    assert.ok(revoked[0]?.revoked_at);
  });

  it('关闭公共快照并以管理员领域命令完成组织管理、导入和严格备份恢复', async () => {
    const user = await server.login(userId);
    const admin = await server.login(adminId);
    const snapshot = await readJson(await server.request('/api/workspace', { headers: { Cookie: admin.cookie } }));
    assert.equal((await server.request('/api/db', { headers: { Cookie: admin.cookie } })).status, 404);
    assert.equal((await server.request('/api/db', { method: 'POST', headers: { Cookie: admin.cookie }, ...jsonBody(snapshot) })).status, 404);
    assert.equal((await server.request('/api/resources', { method: 'POST', headers: { Cookie: user.cookie }, ...jsonBody({ resource: snapshot.resources[0] }) })).status, 403);

    const role = { id: 'AUDITOR_API_TEST', name: '集成审计员', description: '只读审计角色', color: 'indigo' };
    assert.equal((await server.request('/api/roles', { method: 'POST', headers: { Cookie: admin.cookie }, ...jsonBody({ role }) })).status, 201);
    const department = { id: 'dpt-audit', name: '审计部' };
    assert.equal((await server.request('/api/departments', { method: 'POST', headers: { Cookie: admin.cookie }, ...jsonBody({ department }) })).status, 201);
    otherUserId = 'u-other-employee';
    const otherUser = { id: otherUserId, name: '其他员工', email: 'other@company.com', department: '审计部', role: ['EMPLOYEE'], mobile: '13800000009' };
    assert.equal((await server.request('/api/users', { method: 'POST', headers: { Cookie: admin.cookie }, ...jsonBody({ user: otherUser }) })).status, 201);
    assert.equal((await server.request('/api/users', { method: 'POST', headers: { Cookie: admin.cookie }, ...jsonBody({ user: otherUser }) })).status, 409);

    const importedResource = { id: 'r-imported', name: '导入会议室', type: 'ROOM', capacity: 6, location: '主楼 3层', features: [], status: 'AVAILABLE' };
    const imported = await server.request('/api/imports/RESOURCES', { method: 'POST', headers: { Cookie: admin.cookie }, ...jsonBody({ items: [importedResource] }) });
    assert.equal(imported.status, 201);
    const backupResponse = await server.request('/api/backup', { headers: { Cookie: admin.cookie } });
    assert.equal(backupResponse.status, 200);
    assert.equal((await server.request('/api/backup', { headers: { Cookie: user.cookie } })).status, 403);
    const backup = await readJson(backupResponse);
    assert.equal(backup.schemaVersion, 7);
    assert.ok(Array.isArray(backup.collections.ruleVersions));
    assert.ok(Array.isArray(backup.collections.resourceImportBatches));
    assert.ok(Array.isArray(backup.collections.workflowVersions));
    assert.ok(Array.isArray(backup.collections.approvalDelegates));
    assert.ok(Array.isArray(backup.collections.approvalRuleSetVersions));
    assert.ok(Array.isArray(backup.collections.confidentialWhitelist));
    assert.ok(Array.isArray(backup.collections.confidentialityAuthorizations));
    assert.ok(Array.isArray(backup.collections.confidentialAccessGrants));
    assert.ok(Array.isArray(backup.collections.workOrders));
    assert.ok(backup.collections.users.some((item: any) => item.id === otherUserId));

    const temporaryResource = { ...importedResource, id: 'r-temporary', name: '恢复后应删除' };
    assert.equal((await server.request('/api/resources', { method: 'POST', headers: { Cookie: admin.cookie }, ...jsonBody({ resource: temporaryResource }) })).status, 201);
    const restored = await server.request('/api/backup/restore', { method: 'POST', headers: { Cookie: admin.cookie }, ...jsonBody(backup) });
    assert.equal(restored.status, 200, JSON.stringify(await readJson(restored.clone())));
    const workspace = await readJson(await server.request('/api/workspace', { headers: { Cookie: admin.cookie } }));
    assert.ok(!workspace.resources.some((item: any) => item.id === 'r-temporary'));
    assert.ok(workspace.resources.some((item: any) => item.id === 'r-imported'));
    const ordinaryWorkspace = await readJson(await server.request('/api/workspace', { headers: { Cookie: user.cookie } }));
    assert.equal(ordinaryWorkspace.users.find((item: any) => item.id === userId).mobile, undefined);
  });

  it('管理审计按组合条件检索并保留脱敏的变更前后内容', async () => {
    const user = await server.login(userId);
    const admin = await server.login(adminId);
    assert.equal((await server.request('/api/audit', { headers: { Cookie: user.cookie } })).status, 403);

    const auditedUser = {
      id: 'u-audit-before-after', name: '审计变更前员工', email: 'audit-before-after@company.com',
      department: '审计部', role: ['EMPLOYEE'], mobile: '13800000009'
    };
    const start = new Date(Date.now() - 1000).toISOString();
    assert.equal((await server.request('/api/users', {
      method: 'POST', headers: { Cookie: admin.cookie }, ...jsonBody({ user: auditedUser })
    })).status, 201);
    assert.equal((await server.request(`/api/users/${auditedUser.id}`, {
      method: 'PUT', headers: { Cookie: admin.cookie }, ...jsonBody({ user: { ...auditedUser, name: '审计变更后员工' } })
    })).status, 200);

    const queryEvents = async (action: string, entityType = 'USER') => {
      const params = new URLSearchParams({
        actorId: adminId, action, entityType, entityId: auditedUser.id,
        start, end: new Date(Date.now() + 1000).toISOString(), limit: '20'
      });
      const response = await server.request(`/api/audit?${params}`, { headers: { Cookie: admin.cookie } });
      assert.equal(response.status, 200, JSON.stringify(await readJson(response.clone())));
      return (await readJson(response)).events;
    };
    const createdEvents = await queryEvents('USER_CREATE');
    assert.equal(createdEvents.length, 1);
    assert.equal(createdEvents[0].actorId, adminId);
    assert.equal(createdEvents[0].details.before, null);
    assert.equal(createdEvents[0].details.after.name, auditedUser.name);
    assert.equal(createdEvents[0].details.after.email, 'a***@company.com');
    assert.equal(createdEvents[0].details.after.mobile, '138****09');

    const updatedEvents = await queryEvents('USER_UPDATE');
    assert.equal(updatedEvents.length, 1);
    assert.equal(updatedEvents[0].details.before.name, '审计变更前员工');
    assert.equal(updatedEvents[0].details.after.name, '审计变更后员工');
    assert.equal(updatedEvents[0].details.before.email, 'a***@company.com');
    assert.equal(updatedEvents[0].details.after.mobile, '138****09');
    assert.equal(JSON.stringify(updatedEvents).includes(auditedUser.email), false);
    assert.equal(JSON.stringify(updatedEvents).includes(auditedUser.mobile), false);
    assert.deepEqual(await queryEvents('USER_CREATE', 'ROLE'), []);

    const invalidRange = new URLSearchParams({ start: '2026-01-02T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z' });
    assert.equal((await server.request(`/api/audit?${invalidRange}`, { headers: { Cookie: admin.cookie } })).status, 400);
    assert.equal((await server.request('/api/audit?limit=not-a-number', { headers: { Cookie: admin.cookie } })).status, 400);
  });

  it('由服务端 actor 决定预约人，并隔离通知读写', async () => {
    const user = await server.login(userId);
    const admin = await server.login(adminId);
    const snapshot = await readJson(await server.request('/api/workspace', { headers: { Cookie: user.cookie } }));
    const resource = snapshot.resources.find((item: any) => item.type === 'ROOM' && item.status === 'AVAILABLE');
    assert.ok(resource);
    const start = new Date(Date.now() + 40 * 86400000);
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    const booking = {
      id: crypto.randomUUID(), userId: adminId, resourceId: resource.id, type: 'ROOM',
      startTime: start.toISOString(), endTime: end.toISOString(), status: 'APPROVED',
      purpose: 'actor 隔离集成测试', participants: 1, meetingType: 'IMPORTANT', confidentialityChoice: 'NON_CONFIDENTIAL', overlapParticipantIds: [otherUserId], createdAt: new Date().toISOString(),
      currentNodeIndex: 99, approvalHistory: [{ nodeName: '伪造', approverName: '伪造', status: 'APPROVED', timestamp: new Date().toISOString() }]
    };
    const createdResponse = await server.request('/api/bookings', { method: 'POST', headers: { Cookie: user.cookie }, ...jsonBody({ booking }) });
    assert.equal(createdResponse.status, 201, JSON.stringify(await readJson(createdResponse.clone())));
    const created = await readJson(createdResponse);
    assert.equal(created.booking.userId, userId);
    assert.equal(created.booking.currentNodeIndex, 0);
    assert.deepEqual(created.booking.approvalHistory, []);
    assert.equal(created.booking.overlapParticipantIds, undefined);
    assert.ok(created.workspace.revision > snapshot.revision);
    const other = await server.login(otherUserId);
    const otherWorkspace = await readJson(await server.request('/api/workspace', { headers: { Cookie: other.cookie } }));
    const redacted = otherWorkspace.bookings.find((item: any) => item.id === created.booking.id);
    assert.equal(redacted.purpose, '已预约');
    assert.equal(redacted.userId, '');
    assert.deepEqual(redacted.attendeeIds, []);
    assert.deepEqual(redacted.overlapParticipantIds, [userId]);

    const notificationsResponse = await server.request('/api/notifications', { headers: { Cookie: user.cookie } });
    const notifications = (await readJson(notificationsResponse)).notifications;
    const own = notifications.find((item: any) => item.content.includes(created.booking.id) || item.title.includes('预约'));
    assert.ok(own);
    const forbiddenRead = await server.request('/api/notifications', { method: 'PATCH', headers: { Cookie: admin.cookie }, ...jsonBody({ ids: [own.id] }) });
    assert.equal(forbiddenRead.status, 200);
    assert.equal((await readJson(forbiddenRead)).changed, 0);
    const ownerRead = await server.request('/api/notifications', { method: 'PATCH', headers: { Cookie: user.cookie }, ...jsonBody({ ids: [own.id] }) });
    assert.equal((await readJson(ownerRead)).changed, 1);
    assert.equal((await server.request('/api/notifications', { method: 'POST', headers: { Cookie: admin.cookie }, ...jsonBody({ notification: own }) })).status, 404);
  });

  it('将用户偏好保存在 MySQL，并在 Node 重启和会话复用后保持', async () => {
    const user = await server.login(userId);
    const updated = await server.request('/api/preferences', {
      method: 'PUT', headers: { Cookie: user.cookie }, ...jsonBody({ theme: 'emerald', sidebarCollapsed: true })
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(await readJson(updated), { theme: 'emerald', sidebarCollapsed: true });
    await server.stop();
    await server.start();
    const me = await server.request('/api/auth/me', { headers: { Cookie: user.cookie } });
    assert.equal(me.status, 200);
    const preferences = await server.request('/api/preferences', { headers: { Cookie: user.cookie } });
    assert.deepEqual(await readJson(preferences), { theme: 'emerald', sidebarCollapsed: true });
  });
});

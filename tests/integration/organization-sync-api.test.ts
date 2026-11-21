import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { OrganizationSyncBatch, User } from '../../types.ts';
import { FakeOidcProvider } from '../support/fakeOidc.ts';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const provider = new FakeOidcProvider();
const server = new TestServer();
let admin: Awaited<ReturnType<TestServer['login']>>;
let employee: Awaited<ReturnType<TestServer['login']>>;
let adminId = '';
let employeeId = '';

const readJson = async (response: Response) => response.json() as Promise<any>;
const call = (pathname: string, method: string, session: Awaited<ReturnType<TestServer['login']>>, body?: unknown) =>
  server.request(pathname, { method, headers: { Cookie: session.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
const readCollection = async <T>(key: string): Promise<T[]> => {
  const rows = await queryTestDb<any[]>('SELECT payload FROM office_state WHERE state_key = ?', [key]);
  assert.equal(rows.length, 1);
  return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
};
const marketDepartment = { externalId: 'D-MARKET', id: 'dpt3', name: '市场部' };
const employeeInput = (overrides: Record<string, unknown> = {}) => ({
  externalId: 'EMP-3', id: employeeId, name: '李员工', email: 'li@company.com', role: ['EMPLOYEE'],
  departmentExternalId: 'D-MARKET', ...overrides
});
const preview = (body: unknown) => call('/api/organization-sync/preview', 'POST', admin, body);
const apply = (batchId: string) => call('/api/organization-sync/apply', 'POST', admin, { batchId });
const beginOidcCallback = async () => {
  const login = await server.request('/api/auth/login');
  assert.equal(login.status, 303);
  const authorization = await fetch(login.headers.get('location')!, { redirect: 'manual' });
  assert.equal(authorization.status, 303);
  return new URL(authorization.headers.get('location')!);
};

describe('MRP7 组织同步与停用撤销集成验证', { skip: !integrationEnabled, concurrency: false }, () => {
  before(async () => {
    await resetTestDb();
    await provider.start();
    await server.start(baseUrl => ({
      OIDC_ISSUER: provider.issuer,
      OIDC_CLIENT_ID: provider.clientId,
      OIDC_CLIENT_SECRET: '',
      OIDC_REDIRECT_URI: `${baseUrl}/api/auth/callback`,
      OIDC_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url')
    }));
    const options = await readJson(await server.request('/api/auth/options'));
    adminId = options.users.find((user: any) => user.role.includes('SYSTEM_ADMIN'))?.id;
    employeeId = options.users.find((user: any) => user.name === '李员工')?.id;
    assert.ok(adminId && employeeId);
    [admin, employee] = await Promise.all([server.login(adminId), server.login(employeeId)]);
    await queryTestDb('INSERT INTO user_identities (issuer, subject, user_id) VALUES (?, ?, ?)', [provider.issuer, provider.subject, employeeId]);
  });

  after(async () => {
    await server.stop();
    await provider.stop();
  });

  it('仅系统管理员可查询和预览组织差异', async () => {
    assert.equal((await call('/api/organization-sync', 'GET', employee)).status, 403);
    assert.equal((await call('/api/organization-sync/preview', 'POST', employee, {
      source: 'HR', mode: 'DELTA', departments: [], users: []
    })).status, 403);
    const listed = await call('/api/organization-sync', 'GET', admin);
    assert.equal(listed.status, 200);
    assert.deepEqual((await readJson(listed)).batches, []);
  });

  it('按显式内部 ID 绑定，不因邮箱相同自动认领其他账号', async () => {
    const response = await preview({ source: 'HR', mode: 'DELTA', departments: [marketDepartment], users: [employeeInput()] });
    assert.equal(response.status, 201, JSON.stringify(await readJson(response.clone())));
    const batch = (await readJson(response)).batch as OrganizationSyncBatch;
    const userChange = batch.changes.find(change => change.entityType === 'USER');
    assert.equal(userChange?.action, 'UPDATE');
    assert.deepEqual(userChange?.changedFields, ['externalId', 'directorySource']);
    const applied = await apply(batch.id);
    assert.equal(applied.status, 200, JSON.stringify(await readJson(applied.clone())));
    assert.equal((await readJson(applied)).idempotent, false);
    const users = await readCollection<User>('users');
    assert.equal(users.find(user => user.id === employeeId)?.externalId, 'EMP-3');
    assert.equal(users.find(user => user.id === employeeId)?.directorySource, 'HR');

    const collision = await preview({
      source: 'HR', mode: 'DELTA', departments: [],
      users: [employeeInput({ id: undefined, externalId: 'EMP-EMAIL-COLLISION', name: '邮箱碰撞账号' })]
    });
    assert.equal(collision.status, 409);
    assert.equal((await readJson(collision)).error, 'DUPLICATE_EMAIL');
    assert.equal((await readCollection<OrganizationSyncBatch>('organizationSyncBatches')).length, 1);
  });

  it('DELTA 不停用缺席账号，应用在快照变化后拒绝陈旧预览', async () => {
    const delta = await preview({ source: 'HR', mode: 'DELTA', departments: [marketDepartment], users: [] });
    assert.equal(delta.status, 201);
    const deltaBatch = (await readJson(delta)).batch as OrganizationSyncBatch;
    assert.ok(deltaBatch.changes.every(change => change.action !== 'DISABLE'));
    assert.equal((await apply(deltaBatch.id)).status, 200);
    assert.equal((await server.request('/api/auth/me', { headers: { Cookie: employee.cookie } })).status, 200);

    const stale = await preview({ source: 'HR', mode: 'FULL', departments: [marketDepartment], users: [] });
    const staleBatch = (await readJson(stale)).batch as OrganizationSyncBatch;
    assert.ok(staleBatch.changes.some(change => change.entityId === employeeId && change.action === 'DISABLE'));
    const changed = await call('/api/departments', 'POST', admin, { department: { id: 'dpt-stale-guard', name: '陈旧快照测试部' } });
    assert.equal(changed.status, 201);
    const rejected = await apply(staleBatch.id);
    assert.equal(rejected.status, 412);
    assert.equal((await readJson(rejected)).error, 'STALE_SNAPSHOT');
    assert.equal((await server.request('/api/auth/me', { headers: { Cookie: employee.cookie } })).status, 200);
  });

  it('FULL 只停用同源缺席账号，并同事务撤销会话和记录审计', async () => {
    const otherSource = await call('/api/users', 'POST', admin, {
      user: {
        id: 'u-ldap-active', name: '其他目录账号', email: 'ldap-active@company.com', department: '市场部', role: ['EMPLOYEE'],
        externalId: 'LDAP-1', directorySource: 'LDAP', status: 'ACTIVE'
      }
    });
    assert.equal(otherSource.status, 201);
    const response = await preview({ source: 'HR', mode: 'FULL', departments: [marketDepartment], users: [] });
    assert.equal(response.status, 201, JSON.stringify(await readJson(response.clone())));
    const batch = (await readJson(response)).batch as OrganizationSyncBatch;
    assert.ok(batch.changes.some(change => change.entityId === employeeId && change.action === 'DISABLE'));
    assert.ok(!batch.changes.some(change => change.entityId === 'u-ldap-active' && change.action === 'DISABLE'));
    const applied = await apply(batch.id);
    assert.equal(applied.status, 200, JSON.stringify(await readJson(applied.clone())));
    const appliedBody = await readJson(applied);

    const revisionBeforeRepeat = await queryTestDb<any[]>('SELECT revision FROM office_snapshot_meta WHERE id = 1');
    const repeated = await apply(batch.id);
    assert.equal(repeated.status, 200);
    const repeatedBody = await readJson(repeated);
    assert.equal(repeatedBody.idempotent, true);
    assert.equal(repeatedBody.batch.appliedAt, appliedBody.batch.appliedAt);
    assert.deepEqual(await queryTestDb('SELECT revision FROM office_snapshot_meta WHERE id = 1'), revisionBeforeRepeat);

    const tokenHash = crypto.createHash('sha256').update(employee.token).digest('hex');
    const sessions = await queryTestDb<any[]>('SELECT revoked_at FROM sessions WHERE token_hash = ?', [tokenHash]);
    assert.ok(sessions[0]?.revoked_at);
    const users = await readCollection<User>('users');
    assert.equal(users.find(user => user.id === employeeId)?.status, 'DISABLED');
    assert.equal(users.find(user => user.id === 'u-ldap-active')?.status, 'ACTIVE');
    assert.notEqual(users.find(user => user.id === adminId)?.status, 'DISABLED');
    const audits = await queryTestDb<any[]>("SELECT action FROM audit_events WHERE entity_type = 'ORGANIZATION_SYNC' AND entity_id = ?", [batch.id]);
    assert.deepEqual(audits.map(item => item.action).sort(), ['ORGANIZATION_SYNC_APPLY', 'ORGANIZATION_SYNC_PREVIEW']);
  });

  it('停用后拒绝现有会话、开发登录和已绑定 OIDC 身份', async () => {
    assert.equal((await server.request('/api/auth/me', { headers: { Cookie: employee.cookie } })).status, 401);
    assert.equal((await server.request(`/api/auth/dev?userId=${encodeURIComponent(employeeId)}`)).status, 401);
    const options = await readJson(await server.request('/api/auth/options'));
    assert.ok(!options.users.some((user: any) => user.id === employeeId));
    const callbackUrl = await beginOidcCallback();
    const callback = await server.request(`${callbackUrl.pathname}${callbackUrl.search}`);
    assert.equal(callback.status, 401);
    assert.equal((await readJson(callback)).error, 'AUTH_FAILED');
  });

  it('预览阶段阻止停用执行人或移除最后一个有效系统管理员', async () => {
    const input = {
      source: 'ADMIN-HR', mode: 'DELTA',
      departments: [{ externalId: 'D-ARCH', id: 'dpt1-1', name: '架构组' }],
      users: [{ externalId: 'ADMIN-1', id: adminId, name: '超级管理员', email: 'sysadmin@company.com', role: ['SYSTEM_ADMIN'], departmentExternalId: 'D-ARCH', status: 'DISABLED' }]
    };
    const selfDisable = await preview(input);
    assert.equal(selfDisable.status, 409);
    assert.equal((await readJson(selfDisable)).error, 'CANNOT_DISABLE_SELF');
    const lastAdmin = await preview({
      ...input,
      users: [{ ...input.users[0], status: 'ACTIVE', role: ['EMPLOYEE'] }]
    });
    assert.equal(lastAdmin.status, 409);
    assert.equal((await readJson(lastAdmin)).error, 'LAST_ACTIVE_ADMIN_REQUIRED');
  });
});

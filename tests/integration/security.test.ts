import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integrationEnabled, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();

describe('请求安全与可观测性集成验证', { skip: !integrationEnabled, concurrency: false }, () => {
  before(async () => {
    await resetTestDb();
    await server.start({ SMART_OFFICE_AUTH_RATE_LIMIT: '3', SMART_OFFICE_AUTH_RATE_LIMIT_WINDOW_MS: '60000' });
  });

  after(async () => {
    await server.stop();
  });

  it('传播合法请求 ID 并返回完整安全响应头', async () => {
    const response = await server.request('/healthz', { headers: { 'X-Request-Id': 'security-it-0001' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'security-it-0001');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    const csp = response.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /form-action 'self'/);
    const page = await server.request('/');
    const pageCsp = page.headers.get('content-security-policy') || '';
    assert.match(pageCsp, /script-src 'self'/);
    assert.doesNotMatch(pageCsp, /cdn\.tailwindcss\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/);
    assert.match(await page.text(), /\/vendor\/fonts\/fonts\.css/);
  });

  it('向本机监控端点暴露数据库与请求指标', async () => {
    const response = await server.request('/metrics');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/plain/);
    const metrics = await response.text();
    assert.match(metrics, /smart_office_database_up 1/);
    assert.match(metrics, /smart_office_http_requests_total [1-9]/);
    assert.match(metrics, /smart_office_http_request_duration_seconds_count [1-9]/);
  });

  it('在解析前拒绝超过限制的 JSON 请求体', async () => {
    const options = await (await server.request('/api/auth/options')).json() as any;
    const adminId = options.users.find((user: any) => user.role.includes('SYSTEM_ADMIN')).id;
    const admin = await server.login(adminId);
    const response = await server.request('/api/bookings', {
      method: 'POST',
      headers: { Cookie: admin.cookie },
      body: JSON.stringify({ booking: { purpose: 'x'.repeat(1024 * 1024) } })
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, 'BODY_TOO_LARGE');
  });

  it('认证回调超过窗口配额后返回 429 和 Retry-After', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await server.request('/api/auth/callback?code=invalid&state=invalid');
      assert.equal(response.status, 401);
    }
    const limited = await server.request('/api/auth/callback?code=invalid&state=invalid');
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error, 'AUTH_RATE_LIMITED');
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    const metrics = await (await server.request('/metrics')).text();
    assert.match(metrics, /smart_office_auth_rate_limited_total 1/);
  });
});

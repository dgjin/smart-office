import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();

test.describe('生产模式安全验收', () => {
  test.skip(!integrationEnabled, '仅允许显式隔离 MySQL 测试环境');

  test.beforeAll(async () => {
    await resetTestDb();
    await server.start({ NODE_ENV: 'production', SMART_OFFICE_DEV_AUTH: 'false' });
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('生产 CSP、安全会话、权限化读模型和偏好写入可用', async ({ browser }) => {
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await queryTestDb(`INSERT INTO sessions (id, token_hash, user_id, idle_expires_at, absolute_expires_at)
      VALUES (?, ?, '3', DATE_ADD(NOW(3), INTERVAL 8 HOUR), DATE_ADD(NOW(3), INTERVAL 7 DAY))`,
    [crypto.randomUUID(), tokenHash]);

    const me = await server.request('/api/auth/me', {
      headers: { Cookie: `__Host-smart_office_session=${encodeURIComponent(token)}` }
    });
    expect(me.status).toBe(200);

    const context = await browser.newContext();
    const externalRequests: string[] = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
        externalRequests.push(url.href);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    const fontResponses: string[] = [];
    page.on('response', response => {
      if (response.url().includes('/vendor/fonts/') && response.url().endsWith('.woff2')) fontResponses.push(response.url());
    });
    await page.goto(server.baseUrl);
    await expect(page.getByText('未配置可用的认证方式，请联系管理员检查 OIDC 或开发认证配置。', { exact: true })).toBeVisible();
    await expect(page.getByText('正在检查认证配置…', { exact: true })).toHaveCount(0);
    await page.evaluate(value => {
      document.cookie = `__Host-smart_office_session=${value}; Path=/; Secure; SameSite=Lax`;
    }, token);
    expect((await context.cookies()).some(cookie => cookie.name === '__Host-smart_office_session')).toBe(true);
    const cspErrors: string[] = [];
    page.on('pageerror', error => cspErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /Content Security Policy|Refused to/i.test(message.text())) {
        cspErrors.push(message.text());
      }
    });

    const browserMeRequest = page.waitForRequest(request => request.url().endsWith('/api/auth/me'));
    const browserMe = page.waitForResponse(response => response.url().endsWith('/api/auth/me'));
    const response = await page.reload();
    expect((await (await browserMeRequest).allHeaders()).cookie).toContain(token);
    expect((await browserMe).status()).toBe(200);
    expect(response?.headers()['content-security-policy']).toContain("default-src 'self'");
    expect(response?.headers()['strict-transport-security']).toContain('max-age=31536000');
    expect(response?.headers()['x-frame-options']).toBe('DENY');
    await expect(page.locator('.studio-app')).toBeVisible();
    await expect(page.getByText('李员工', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: '空间资源库', exact: true }).click();
    await expect(page.getByText('Alpha 战略会议室', { exact: true }).first()).toBeVisible();
    const preferenceWrite = page.waitForResponse(response => response.url().endsWith('/api/preferences')
      && response.request().method() === 'PUT' && response.ok());
    await expect(page.getByTitle('翡翠绿', { exact: true })).toHaveCSS('background-color', 'rgb(5, 150, 105)');
    await page.getByTitle('翡翠绿', { exact: true }).click();
    await preferenceWrite;
    await page.reload();
    await expect(page.locator('.studio-app')).toHaveAttribute('data-theme', 'emerald');
    expect(fontResponses.length).toBeGreaterThan(0);
    expect(externalRequests).toEqual([]);
    expect(cspErrors).toEqual([]);
    await context.close();
  });

  test('总部3D在页面隐藏时停止请求动画帧，恢复可见后继续渲染', async ({ page }) => {
    await page.addInitScript(() => {
      const request = window.requestAnimationFrame.bind(window);
      (window as any).__hq3dRafCount = 0;
      window.requestAnimationFrame = callback => {
        (window as any).__hq3dRafCount += 1;
        return request(callback);
      };
    });
    await page.goto(`${server.baseUrl}/hq3d.html?embed=spatial`);
    await expect(page.locator('canvas')).toBeVisible();
    await page.waitForFunction(() => (window as any).__hq3dRafCount > 2);
    await page.evaluate(() => {
      let hidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      (window as any).__setHq3dHidden = (value: boolean) => {
        hidden = value;
        document.dispatchEvent(new Event('visibilitychange'));
      };
      (window as any).__setHq3dHidden(true);
    });
    await page.waitForTimeout(100);
    const pausedAt = await page.evaluate(() => (window as any).__hq3dRafCount);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as any).__hq3dRafCount)).toBe(pausedAt);
    await page.evaluate(() => (window as any).__setHq3dHidden(false));
    await page.waitForFunction(count => (window as any).__hq3dRafCount > count, pausedAt);
  });
});

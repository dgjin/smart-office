import { test, expect, type Browser, type Page } from '@playwright/test';
import { integrationEnabled, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();

const login = async (page: Page, name: string) => {
  await page.goto(server.baseUrl);
  const account = page.locator('.login-account').filter({ has: page.locator('.login-account-name', { hasText: name }) });
  await expect(account).toBeVisible();
  const workspace = page.waitForResponse(response => response.url().endsWith('/api/workspace') && response.request().method() === 'GET' && response.ok());
  await account.click();
  await workspace;
  await expect(page.locator('.studio-app')).toBeVisible();
};

const openWorkspace = async (browser: Browser, name: string, viewport = { width: 1440, height: 1000 }) => {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await login(page, name);
  return { context, page };
};

const expectLiveSnapshot = async (page: Page) => {
  await expect(page.getByRole('heading', { name: '会议与办公空间监控', exact: true })).toBeVisible();
  await expect(page.locator('.monitoring-connection [role="status"]')).toHaveText('实时推送已连接');
  await expect(page.locator('.monitoring-room-card').first()).toBeVisible();
  await expect(page.locator('.monitoring-office-table-shell tbody tr').first()).toBeVisible();
};

test.describe('监控大屏浏览器验收', () => {
  test.skip(!integrationEnabled, '仅允许显式隔离 MySQL 测试环境');

  test.beforeAll(async () => {
    await resetTestDb();
    await server.start();
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('桌面实时接收新资源并支持会议室和办公室筛选、分页与主题', async ({ browser }, testInfo) => {
    const { context, page } = await openWorkspace(browser, '超级管理员');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    if (await page.locator('.studio-app').getAttribute('data-sidebar') === 'collapsed') {
      await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
    }
    const themeWrite = page.waitForResponse(response => response.url().endsWith('/api/preferences') && response.request().method() === 'PUT' && response.ok());
    await page.getByTitle('东方蓝', { exact: true }).click();
    await themeWrite;
    await page.getByRole('button', { name: '监控大屏', exact: true }).click();
    await expectLiveSnapshot(page);
    await expect(page.locator('.monitoring-metric')).toHaveCount(4);
    await expect(page.locator('.monitoring-office-table-shell tbody tr')).toHaveCount(40);
    await page.screenshot({ path: testInfo.outputPath('monitoring-desktop-coamc.png') });

    await page.getByRole('group', { name: '会议室状态筛选' }).getByRole('button', { name: '空闲', exact: true }).click();
    await expect(page.locator('.monitoring-room-card').first()).toBeVisible();
    await expect(page.locator('.monitoring-room-card:not([data-status="IDLE"])')).toHaveCount(0);
    const resource = {
      id: `r-monitoring-e2e-${Date.now()}`,
      name: '监控浏览器实时验收室',
      type: 'ROOM',
      capacity: 8,
      location: '主楼 3层',
      features: [],
      status: 'AVAILABLE'
    };
    const created = await page.request.post(`${server.baseUrl}/api/resources`, {
      headers: { Origin: server.baseUrl },
      data: { resource }
    });
    expect(created.status(), JSON.stringify(await created.json())).toBe(201);
    await expect(page.getByRole('heading', { name: resource.name, exact: true })).toBeVisible();

    await page.getByRole('group', { name: '会议室状态筛选' }).getByRole('button', { name: '全部', exact: true }).click();
    const more = page.getByRole('button', { name: /^显示更多/ });
    await more.click();
    await expect(page.locator('.monitoring-office-table-shell tbody tr')).toHaveCount(80);
    await page.locator('.monitoring-office-summary button[data-status="ASSIGNED"]').click();
    await expect(page.locator('.monitoring-office-status:not([data-status="ASSIGNED"])')).toHaveCount(0);

    const snapshotResponse = await page.request.get(`${server.baseUrl}/api/monitoring/snapshot`);
    expect(snapshotResponse.status()).toBe(200);
    const snapshot = await snapshotResponse.json();
    const office = snapshot.offices.find((item: any) => item.department && item.status === 'ASSIGNED');
    expect(office).toBeTruthy();
    await page.getByRole('combobox', { name: '楼栋', exact: true }).selectOption(office.buildingId);
    await page.getByRole('combobox', { name: '楼层', exact: true }).selectOption(String(office.floorNo));
    await page.getByRole('searchbox', { name: '搜索办公室' }).fill(office.department);
    await expect(page.locator('.monitoring-office-table-shell tbody tr').first()).toContainText(office.department);
    await expect(page.locator('.monitoring-office-table-shell tbody tr').first()).toContainText(office.roomNumber);

    const classicWrite = page.waitForResponse(response => response.url().endsWith('/api/preferences') && response.request().method() === 'PUT' && response.ok());
    await page.getByTitle('翡翠绿', { exact: true }).click();
    await classicWrite;
    await expect(page.locator('.studio-app')).toHaveAttribute('data-theme', 'emerald');
    expect(errors).toEqual([]);
    await context.close();
  });

  test('移动端从更多进入并保持实时状态、筛选和表格滚动可用', async ({ browser }, testInfo) => {
    const { context, page } = await openWorkspace(browser, '李员工', { width: 375, height: 812 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('navigation', { name: '移动端主导航', exact: true }).getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('dialog', { name: '更多功能', exact: true }).getByRole('button', { name: '监控大屏', exact: true }).click();
    await expectLiveSnapshot(page);
    await expect(page.locator('.monitoring-metric')).toHaveCount(4);
    await expect(page.locator('.studio-agent-launcher')).toBeHidden();
    await expect(page.locator('.monitoring-assistant')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('monitoring-mobile-375.png') });

    const tableShell = page.locator('.monitoring-office-table-shell');
    await expect(tableShell).toHaveCSS('overflow-x', 'auto');
    await page.locator('.monitoring-office-summary button[data-status="VACANT"]').click();
    await expect(page.locator('.monitoring-office-status:not([data-status="VACANT"])')).toHaveCount(0);
    await page.getByRole('button', { name: '清除办公室状态筛选', exact: true }).click();
    await page.getByRole('group', { name: '会议室状态筛选' }).getByRole('button', { name: '占用中', exact: true }).click();
    await expect(page.locator('.monitoring-room-card[data-status="IDLE"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });
});

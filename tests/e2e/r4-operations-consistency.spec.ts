import { expect, test, type Browser, type Page } from '@playwright/test';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();

const login = async (page: Page, name: string) => {
  await page.goto(server.baseUrl);
  const account = page.locator('.login-account').filter({ has: page.locator('.login-account-name', { hasText: name }) });
  await expect(account).toBeVisible();
  const workspace = page.waitForResponse(response => response.url().endsWith('/api/workspace') && response.ok());
  await account.click();
  await workspace;
  await expect(page.locator('.studio-app')).toBeVisible();
};

const openWorkspace = async (browser: Browser, name: string) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await login(page, name);
  return { context, page };
};

const openAdminView = async (page: Page, name: string) => {
  const target = page.getByRole('button', { name, exact: true });
  if (!await target.isVisible()) await page.getByRole('button', { name: '系统管理', exact: true }).click();
  await target.click();
};

test.describe('R4 业务配置与运营一致性浏览器回归', () => {
  test.skip(!integrationEnabled, '仅允许显式隔离 MySQL 测试环境');

  test.beforeAll(async () => {
    await resetTestDb();
    await server.start();
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('新增和编辑多角色成员均保留完整角色集合', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '超级管理员');
    await openAdminView(page, '成员中心');
    await page.getByRole('button', { name: '录入成员', exact: true }).click();
    const createModal = page.locator('.fixed.inset-0').filter({ has: page.getByRole('heading', { name: '录入新成员', exact: true }) });
    await createModal.getByPlaceholder('姓名', { exact: true }).fill('R4 多角色成员');
    await createModal.getByPlaceholder('电子邮箱', { exact: true }).fill('r4-multi-role@company.com');
    await createModal.getByPlaceholder('移动电话', { exact: true }).fill('13800000904');
    await createModal.getByPlaceholder('办公电话', { exact: true }).fill('010-88880904');
    await createModal.getByRole('checkbox', { name: '审批负责人', exact: true }).check();
    await expect(createModal.getByRole('checkbox', { name: '正式员工', exact: true })).toBeChecked();
    const created = page.waitForResponse(response => response.url().endsWith('/api/users') && response.request().method() === 'POST' && response.status() === 201);
    await createModal.getByRole('button', { name: '保存', exact: true }).click();
    await created;

    let row = page.locator('tbody tr').filter({ hasText: 'R4 多角色成员' });
    await expect(row).toContainText('正式员工');
    await expect(row).toContainText('审批负责人');
    await row.locator('td:last-child button').nth(1).click();
    const editModal = page.locator('.fixed.inset-0').filter({ has: page.getByRole('heading', { name: '编辑成员', exact: true }) });
    await expect(editModal.getByRole('checkbox', { name: '正式员工', exact: true })).toBeChecked();
    await expect(editModal.getByRole('checkbox', { name: '审批负责人', exact: true })).toBeChecked();
    await editModal.getByPlaceholder('办公电话', { exact: true }).fill('010-88881904');
    const updated = page.waitForResponse(response => /\/api\/users\/u-/.test(response.url()) && response.request().method() === 'PUT' && response.ok());
    await editModal.getByRole('button', { name: '保存', exact: true }).click();
    await updated;

    await page.reload();
    await expect(page.locator('.studio-app')).toBeVisible();
    await openAdminView(page, '成员中心');
    row = page.locator('tbody tr').filter({ hasText: 'R4 多角色成员' });
    await expect(row).toContainText('正式员工');
    await expect(row).toContainText('审批负责人');
    await row.locator('td:last-child button').nth(1).click();
    await expect(editModal.getByRole('checkbox', { name: '正式员工', exact: true })).toBeChecked();
    await expect(editModal.getByRole('checkbox', { name: '审批负责人', exact: true })).toBeChecked();
    const saved = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'users'");
    const users = typeof saved[0].payload === 'string' ? JSON.parse(saved[0].payload) : saved[0].payload;
    expect(users.find((user: any) => user.name === 'R4 多角色成员')?.role).toEqual(['EMPLOYEE', 'APPROVAL_ADMIN']);
    await context.close();
  });

  test('后台刷新无需重新登录即可显示当前用户新通知', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '李员工');
    const title = `R4 后台通知 ${Date.now()}`;
    const refreshed = page.waitForResponse(async response => {
      if (!response.url().endsWith('/api/notifications') || !response.ok()) return false;
      const body = await response.json();
      return body.notifications?.some((item: any) => item.title === title);
    }, { timeout: 20_000 });
    await queryTestDb(`INSERT INTO notifications (id, user_id, title, content, timestamp, is_read, type, link_view)
      VALUES (?, '3', ?, '隔离环境验证后台轮询刷新。', ?, 0, 'INFO', 'BOOKINGS')`, [`r4-notice-${Date.now()}`, title, new Date()]);
    await refreshed;
    await page.getByRole('button', { name: '通知中心', exact: true }).click();
    await expect(page.locator('.studio-notification-panel').getByText(title, { exact: true })).toBeVisible();
    await context.close();
  });

  test('报表快照变化后阻断旧导出、刷新快照并允许重新下载', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '超级管理员');
    const initialResponse = page.waitForResponse(response => response.url().includes('/api/reports?') && response.ok());
    await openAdminView(page, '运营报表');
    const initialReport = await (await initialResponse).json();
    const admin = await server.login('1');
    const changed = await server.request('/api/departments', {
      method: 'POST', headers: { Cookie: admin.cookie }, body: JSON.stringify({ department: { id: `dpt-r4-${Date.now()}`, name: `R4快照部门${Date.now()}`, parentId: 'dpt-root' } })
    });
    expect(changed.status).toBe(201);

    const staleExport = page.waitForResponse(response => response.url().includes('/api/reports/export?') && response.status() === 409);
    const refreshedReport = page.waitForResponse(response => response.url().includes('/api/reports?') && response.ok());
    await page.getByRole('button', { name: '导出 CSV', exact: true }).click();
    expect((await (await staleExport).json()).error).toBe('REPORT_SNAPSHOT_CHANGED');
    const latestReport = await (await refreshedReport).json();
    expect(latestReport.revision).toBeGreaterThan(initialReport.revision);
    await expect(page.getByRole('alert')).toHaveText('报表数据已更新，已刷新到最新快照，请重新导出。');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 CSV', exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await context.close();
  });
});

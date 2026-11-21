import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Booking } from '../../types.ts';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
const names: Record<string, string> = { admin: '超级管理员', requester: '李员工' };

const insertBooking = async (booking: Booking) => {
  await queryTestDb(`INSERT INTO bookings (id, user_id, resource_id, start_time, end_time, status, payload, created_at, schedule_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`, [
    booking.id, booking.userId, booking.resourceId, new Date(booking.startTime), new Date(booking.endTime),
    booking.status, JSON.stringify(booking), new Date(booking.createdAt)
  ]);
};
const booking = (overrides: Partial<Booking> & Pick<Booking, 'id' | 'resourceId' | 'startTime' | 'endTime' | 'purpose'>): Booking => ({
  userId: '3', type: 'ROOM', status: 'APPROVED', participants: 4, createdAt: new Date().toISOString(), currentNodeIndex: 1,
  approvalHistory: [], attendeeIds: [], meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL',
  requesterDepartmentId: 'dpt3', scheduleVersion: 1, serviceRequirements: [], ...overrides
});
const monitorPage = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(`console: ${message.text()}`);
  });
  page.on('response', response => {
    const anonymousCheck = response.url().endsWith('/api/auth/me') && response.status() === 401;
    if (response.url().includes('/api/') && response.status() >= 400 && !anonymousCheck) errors.push(`http ${response.status}: ${response.url()}`);
  });
  return errors;
};
const login = async (page: Page, name: string) => {
  await page.goto(server.baseUrl);
  const account = page.locator('.login-account').filter({ has: page.locator('.login-account-name', { hasText: name }) });
  await expect(account).toBeVisible();
  const workspace = page.waitForResponse(response => response.url().endsWith('/api/workspace') && response.ok());
  await account.click();
  await workspace;
  await expect(page.locator('.studio-app')).toBeVisible();
};
const openWorkspace = async (browser: Browser, userId: string, viewport = { width: 1440, height: 1000 }) => {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = monitorPage(page);
  await login(page, names[userId]);
  return { context, page, errors };
};
const openAdminView = async (page: Page, name: string) => {
  const target = page.getByRole('button', { name, exact: true });
  if (!await target.isVisible()) await page.getByRole('button', { name: '系统管理', exact: true }).click();
  await target.click();
};

test.describe('MRP6 真实 Chrome 驾驶舱、异常、设备与报表', () => {
  test.skip(!integrationEnabled, '仅允许显式隔离 MySQL 测试环境');

  test.beforeAll(async () => {
    await resetTestDb();
    await server.start({ SMART_OFFICE_DEVICE_OFFLINE_AFTER_SECONDS: '10' });
    const now = Date.now();
    await insertBooking(booking({
      id: 'mrp6-browser-current', resourceId: 'r1', purpose: 'Chrome 门口屏当前会议',
      startTime: new Date(now - 10 * 60000).toISOString(), endTime: new Date(now + 50 * 60000).toISOString()
    }));
    await insertBooking(booking({
      id: 'mrp6-browser-no-show', resourceId: 'r2', purpose: 'Chrome 未签到复核', status: 'CANCELLED', noShow: true,
      releaseType: 'NO_SHOW', releasedAt: new Date(now - 60000).toISOString(),
      startTime: new Date(now - 2 * 3600000).toISOString(), endTime: new Date(now - 3600000).toISOString()
    }));
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('驾驶舱断网保留最后读模型并恢复，异常中心留下完整处理记录', async ({ browser }) => {
    const requester = await openWorkspace(browser, 'requester');
    await expect(requester.page.locator('.agenda-next-title')).toHaveText('Chrome 门口屏当前会议');
    await requester.page.route('**/api/dashboard', route => route.abort());
    await requester.page.route('**/api/exceptions', route => route.abort());
    await requester.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(requester.page.getByText('连接异常，更改未保存', { exact: true }).first()).toBeVisible();
    await expect(requester.page.locator('.agenda-next-title')).toHaveText('Chrome 门口屏当前会议');
    await requester.page.unroute('**/api/dashboard');
    await requester.page.unroute('**/api/exceptions');
    const recovered = requester.page.waitForResponse(response => response.url().endsWith('/api/dashboard') && response.ok());
    await requester.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await recovered;
    await expect(requester.page.getByText('已同步至 MySQL', { exact: true })).toBeVisible();
    await expect(requester.page.locator('.agenda-next-title')).toHaveCount(1);
    expect(requester.errors).toEqual([]);
    await requester.context.close();

    const admin = await openWorkspace(browser, 'admin');
    await admin.page.getByRole('button', { name: '异常中心', exact: true }).click();
    let card = admin.page.locator('article').filter({ hasText: 'Chrome 未签到复核' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: '填写处理记录', exact: true }).click();
    await card.getByRole('textbox').fill('已联系申请人并核实现场');
    await Promise.all([
      admin.page.waitForResponse(response => response.url().includes('/api/exceptions/') && response.status() === 200),
      card.getByRole('button', { name: '认领并保存', exact: true }).click()
    ]);
    await expect(card.getByText('已认领', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: '填写处理记录', exact: true }).click();
    await card.getByRole('textbox').fill('资源和服务释放结果均已复核');
    await Promise.all([
      admin.page.waitForResponse(response => response.url().includes('/api/exceptions/') && response.status() === 200),
      card.getByRole('button', { name: '复核完成并关闭', exact: true }).click()
    ]);
    await admin.page.getByRole('tab', { name: '已关闭', exact: true }).click();
    card = admin.page.locator('article').filter({ hasText: 'Chrome 未签到复核' });
    await expect(card.getByText('已关闭', { exact: true })).toBeVisible();
    await expect(card.getByText('资源和服务释放结果均已复核', { exact: true }).first()).toBeVisible();
    await card.getByText('处理记录（2）', { exact: true }).click();
    await expect(card.getByText('已联系申请人并核实现场', { exact: true })).toBeVisible();
    expect(admin.errors).toEqual([]);
    await admin.context.close();
  });

  test('设备一次性密钥驱动门口屏，离线保留快照，轮换与吊销立即清空权限', async ({ browser }) => {
    const admin = await openWorkspace(browser, 'admin');
    await openAdminView(admin.page, '门口屏设备');
    await admin.page.getByLabel('设备名称', { exact: true }).fill('Chrome Alpha 门口屏');
    await admin.page.getByLabel('绑定会议室', { exact: true }).selectOption('r1');
    await Promise.all([
      admin.page.waitForResponse(response => response.url().endsWith('/api/devices') && response.status() === 201),
      admin.page.getByRole('button', { name: '创建并生成密钥', exact: true }).click()
    ]);
    const credential = admin.page.locator('input[aria-label="一次性设备密钥"]');
    const token = await credential.inputValue();
    expect(token).toMatch(/^door_/);
    const card = admin.page.locator('article').filter({ hasText: 'Chrome Alpha 门口屏' });
    await expect(card).toBeVisible();

    const doorContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const door = await doorContext.newPage();
    await door.goto(`${server.baseUrl}/door-display`);
    await door.getByLabel('设备密钥', { exact: true }).fill(token);
    const connected = door.waitForResponse(response => response.url().endsWith('/api/device/snapshot') && response.ok());
    await door.getByRole('button', { name: '连接并显示日程', exact: true }).click();
    const snapshot = await (await connected).json();
    await expect(door.locator('.door-display h1')).toHaveText('Alpha 战略会议室');
    await expect(door.locator('.door-current h2')).toHaveText('Chrome 门口屏当前会议');
    await door.screenshot({ path: 'test-results/mrp6-door-display-1920.png', fullPage: true });
    const cacheKey = `SMART_OFFICE_DOOR_LAST_SNAPSHOT:${token.slice(0, 12)}`;
    expect(await door.evaluate(key => localStorage.getItem(key), cacheKey)).toBeTruthy();
    await doorContext.setOffline(true);
    await expect(door.locator('.door-live')).toContainText('离线快照');
    await expect(door.locator('.door-current h2')).toHaveText('Chrome 门口屏当前会议');
    const reconnected = door.waitForResponse(response => response.url().endsWith('/api/device/snapshot') && response.ok());
    await doorContext.setOffline(false);
    await reconnected;
    await expect(door.locator('.door-live')).toContainText('实时日程');
    await expect(door.locator('.door-agenda li')).toHaveCount(snapshot.bookings.length);

    await card.getByRole('button', { name: '轮换密钥', exact: true }).click();
    await Promise.all([
      admin.page.waitForResponse(response => response.url().endsWith('/rotate') && response.ok()),
      card.getByRole('button', { name: '确认执行', exact: true }).click()
    ]);
    const rotatedToken = await credential.inputValue();
    expect(rotatedToken).not.toBe(token);
    const rotatedOut = door.waitForResponse(response => response.url().endsWith('/api/device/snapshot') && response.status() === 401);
    await door.evaluate(() => window.dispatchEvent(new Event('online')));
    await rotatedOut;
    await expect(door.getByRole('button', { name: '连接并显示日程', exact: true })).toBeVisible();
    expect(await door.evaluate(key => localStorage.getItem(key), cacheKey)).toBeNull();
    expect(await door.evaluate(() => sessionStorage.getItem('SMART_OFFICE_DOOR_SESSION_TOKEN'))).toBeNull();

    await door.getByLabel('设备密钥', { exact: true }).fill(rotatedToken);
    const reauthorized = door.waitForResponse(response => response.url().endsWith('/api/device/snapshot') && response.ok());
    await door.getByRole('button', { name: '连接并显示日程', exact: true }).click();
    await reauthorized;
    await expect(door.locator('.door-display')).toBeVisible();
    await card.getByRole('button', { name: '吊销设备', exact: true }).click();
    await Promise.all([
      admin.page.waitForResponse(response => response.url().endsWith('/revoke') && response.ok()),
      card.getByRole('button', { name: '确认执行', exact: true }).click()
    ]);
    const revoked = door.waitForResponse(response => response.url().endsWith('/api/device/snapshot') && response.status() === 401);
    await door.evaluate(() => window.dispatchEvent(new Event('online')));
    await revoked;
    await expect(door.getByRole('button', { name: '连接并显示日程', exact: true })).toBeVisible();
    await expect(card.getByText('已吊销', { exact: true })).toBeVisible();
    expect(admin.errors).toEqual([]);
    await doorContext.close();
    await admin.context.close();
  });

  test('其他设备或过期缓存不得展示日程，网络恢复后重新获取有效快照', async ({ browser }) => {
    const admin = await server.login('1');
    const created = await server.request('/api/devices', {
      method: 'POST', headers: { Cookie: admin.cookie },
      body: JSON.stringify({ name: 'Chrome 缓存边界门口屏', resourceId: 'r1' })
    });
    expect(created.status).toBe(201);
    const { token } = await created.json() as any;
    const cacheKey = `SMART_OFFICE_DOOR_LAST_SNAPSHOT:${token.slice(0, 12)}`;
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const door = await context.newPage();
    await door.goto(`${server.baseUrl}/door-display`);
    await door.getByLabel('设备密钥', { exact: true }).fill(token);
    const connected = door.waitForResponse(response => response.url().endsWith('/api/device/snapshot') && response.ok());
    await door.getByRole('button', { name: '连接并显示日程', exact: true }).click();
    await connected;
    await expect(door.locator('.door-current h2')).toHaveText('Chrome 门口屏当前会议');

    await door.route('**/api/device/*', route => route.abort());
    await door.evaluate(key => {
      const cached = JSON.parse(localStorage.getItem(key)!);
      cached.device.tokenPrefix = 'door_replaced';
      localStorage.setItem(key, JSON.stringify(cached));
    }, cacheKey);
    await door.reload();
    await expect(door.getByRole('heading', { name: '日程快照不可用', exact: true })).toBeVisible();
    await expect(door.getByText('Chrome 门口屏当前会议', { exact: true })).toHaveCount(0);
    expect(await door.evaluate(key => localStorage.getItem(key), cacheKey)).toBeNull();

    await door.unroute('**/api/device/*');
    const replacedRecovered = door.waitForResponse(response => response.url().endsWith('/api/device/snapshot') && response.ok());
    await door.evaluate(() => window.dispatchEvent(new Event('online')));
    await replacedRecovered;
    await expect(door.locator('.door-current h2')).toHaveText('Chrome 门口屏当前会议');

    await door.route('**/api/device/*', route => route.abort());
    await door.evaluate(key => {
      const cached = JSON.parse(localStorage.getItem(key)!);
      const generatedAt = Date.now() - 6 * 60000;
      cached.generatedAt = new Date(generatedAt).toISOString();
      cached.expiresAt = new Date(generatedAt + 5 * 60000).toISOString();
      localStorage.setItem(key, JSON.stringify(cached));
    }, cacheKey);
    await door.reload();
    await expect(door.getByRole('heading', { name: '日程快照不可用', exact: true })).toBeVisible();
    await expect(door.getByText('Chrome 门口屏当前会议', { exact: true })).toHaveCount(0);
    expect(await door.evaluate(key => localStorage.getItem(key), cacheKey)).toBeNull();

    await door.unroute('**/api/device/*');
    const expiredRecovered = door.waitForResponse(response => response.url().endsWith('/api/device/snapshot') && response.ok());
    await door.evaluate(() => window.dispatchEvent(new Event('online')));
    await expiredRecovered;
    await expect(door.locator('.door-current h2')).toHaveText('Chrome 门口屏当前会议');
    await door.screenshot({ path: 'test-results/mrp8-door-cache-recovered-1920.png', fullPage: true });
    await door.getByRole('button', { name: '断开并清除本机快照', exact: true }).click();
    expect(await door.evaluate(key => localStorage.getItem(key), cacheKey)).toBeNull();
    await context.close();
  });

  test('运营报表按维度筛选并下载真实 CSV/XLSX，移动端保留横向表格阅读', async ({ browser }) => {
    const admin = await openWorkspace(browser, 'admin');
    await openAdminView(admin.page, '运营报表');
    await expect(admin.page.getByRole('heading', { name: '利用率与审批效率', exact: true })).toBeVisible();
    await expect(admin.page.getByText('多维统计', { exact: true })).toBeVisible();
    await admin.page.getByLabel('报表维度', { exact: true }).selectOption('BUILDING_FLOOR');
    const reportTable = admin.page.locator('.studio-table-shell').first();
    await expect(reportTable.locator('tbody tr').first()).toBeVisible();
    const dimensions = await reportTable.locator('tbody tr td:first-child').allTextContents();
    expect(dimensions.every(value => value.trim() === '楼栋楼层')).toBe(true);

    const csvDownload = admin.page.waitForEvent('download');
    await admin.page.getByRole('button', { name: '导出 CSV', exact: true }).click();
    const csvPath = await (await csvDownload).path();
    const csv = await readFile(csvPath!);
    expect([...csv.subarray(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]);
    expect(csv.toString('utf8')).toContain('楼栋楼层');

    const xlsxDownload = admin.page.waitForEvent('download');
    await admin.page.getByRole('button', { name: '导出 XLSX', exact: true }).click();
    const xlsxPath = await (await xlsxDownload).path();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await readFile(xlsxPath!));
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['多维汇总', '预约对账', '签到明细', '服务明细', '差异清单', '导出说明']);
    expect(workbook.getWorksheet('预约对账')!.getSheetValues().flat()).toContain('Chrome 门口屏当前会议');
    await expect(admin.page.locator('.studio-toast')).toHaveCount(0, { timeout: 6000 });
    await admin.page.screenshot({ path: 'test-results/mrp6-report-desktop-1440.png', fullPage: true });

    await admin.page.setViewportSize({ width: 390, height: 844 });
    await expect(admin.page.getByRole('button', { name: '导出 XLSX', exact: true })).toBeVisible();
    expect(await admin.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const mobileTable = await reportTable.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(mobileTable.scrollWidth).toBeGreaterThan(mobileTable.clientWidth);
    await reportTable.scrollIntoViewIfNeeded();
    await admin.page.screenshot({ path: 'test-results/mrp6-report-mobile-390.png' });
    await admin.page.setViewportSize({ width: 844, height: 390 });
    await expect(admin.page.getByText('对账差异与使用状态', { exact: true })).toBeVisible();
    expect(admin.errors).toEqual([]);
    await admin.context.close();
  });
});

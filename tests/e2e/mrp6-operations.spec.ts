import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Booking, WorkOrder } from '../../types.ts';
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
const insertWorkOrder = async (order: WorkOrder) => {
  const rows = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'workOrders'");
  const current = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
  await queryTestDb("UPDATE office_state SET payload = ? WHERE state_key = 'workOrders'", [JSON.stringify([...current, order])]);
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
    const adminSession = await server.login('1');
    for (const [floor, id, name] of [[16, 'r-gap07-16', 'GAP07 十六层领导厅'], [19, 'r-gap07-19', 'GAP07 十九层保密厅'], [20, 'r-gap07-20', 'GAP07 二十层接待厅']] as const) {
      const created = await server.request('/api/resources', {
        method: 'POST', headers: { Cookie: adminSession.cookie }, body: JSON.stringify({ resource: {
          id, code: `GAP-${floor}01`, name, type: 'ROOM', capacity: 12, location: `1号楼 ${floor}层 · ${floor}01`,
          building: 'MAIN', floor, roomNumber: `${floor}01`, roomCategory: 'MEDIUM', features: ['投屏显示器'], status: 'AVAILABLE',
          isPublic: false, isExclusive: true, exclusiveLeaderLevel: '公司领导', openStart: '00:00', openEnd: '23:59'
        } })
      });
      expect(created.status, JSON.stringify(await created.clone().json())).toBe(201);
    }
    const now = Date.now();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const atToday = (hour: number) => new Date(today.getTime() + hour * 3600000).toISOString();
    await insertBooking(booking({
      id: 'mrp6-browser-current', resourceId: 'r1', purpose: 'Chrome 门口屏当前会议', participants: 6,
      contactSnapshot: { userId: '3', name: '李员工', landline: '010-88886668', mobile: '13800000003' },
      serviceRequirements: [{ type: 'TEA', fieldValues: { servings: '6' }, catalogSnapshot: {
        catalogItemId: 'tea', catalogVersion: 1, name: '茶水服务', responsibleRole: 'SERVICE_COORDINATOR', slaResponseMinutes: 30,
        heavyService: false, cancellable: true, fields: [{ key: 'servings', label: '茶水份数', type: 'NUMBER', required: true }]
      } }],
      checkedInAt: new Date(now - 5 * 60000).toISOString(), actualStartTime: new Date(now - 10 * 60000).toISOString(),
      startTime: new Date(now - 10 * 60000).toISOString(), endTime: new Date(now + 50 * 60000).toISOString()
    }));
    await insertWorkOrder({
      id: 'mrp6-browser-supply', bookingId: 'mrp6-browser-current', type: 'TEA', title: 'Chrome 茶水备料',
      assigneeRole: 'SERVICE_COORDINATOR', status: 'DONE', createdAt: new Date(now - 15 * 60000).toISOString(),
      scheduleVersion: 1, costAmount: 12.5,
      requirementSnapshot: { type: 'TEA', fieldValues: { servings: '6' }, catalogSnapshot: {
        catalogItemId: 'tea', catalogVersion: 1, name: '茶水服务', responsibleRole: 'SERVICE_COORDINATOR', slaResponseMinutes: 30,
        heavyService: false, cancellable: true, fields: [{ key: 'servings', label: '茶水份数', type: 'NUMBER', required: true }]
      } }
    });
    await insertBooking(booking({
      id: 'mrp6-browser-important', userId: '2', resourceId: 'r-gap07-16', purpose: 'GAP07 领导重点会议', meetingType: 'IMPORTANT', hasLeader: true,
      leaderDetails: '公司领导', checkedInAt: new Date(now - 25 * 60000).toISOString(), actualStartTime: new Date(now - 30 * 60000).toISOString(),
      startTime: new Date(now - 30 * 60000).toISOString(), endTime: new Date(now + 60 * 60000).toISOString()
    }));
    await insertBooking(booking({
      id: 'mrp6-browser-confidential', userId: '2', resourceId: 'r-gap07-19', purpose: 'GAP07 涉密主题不得泄露',
      meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL',
      checkedInAt: new Date(now - 25 * 60000).toISOString(), actualStartTime: new Date(now - 30 * 60000).toISOString(),
      startTime: new Date(now - 30 * 60000).toISOString(), endTime: new Date(now + 60 * 60000).toISOString()
    }));
    await insertBooking(booking({
      id: 'mrp6-browser-no-show', resourceId: 'r1', purpose: 'Chrome 未签到复核', status: 'CANCELLED', noShow: true,
      releaseType: 'NO_SHOW', releasedAt: atToday(6.25), startTime: atToday(5), endTime: atToday(6)
    }));
    await insertBooking(booking({
      id: 'mrp6-browser-early', resourceId: 'r1', purpose: 'Chrome 提前结束会议', status: 'COMPLETED',
      endedEarlyAt: atToday(8), actualStartTime: atToday(7), actualEndTime: atToday(8), releaseType: 'MANUAL_EXCEPTION',
      startTime: atToday(7), endTime: atToday(9)
    }));
    await insertBooking(booking({
      id: 'mrp6-browser-cancelled', resourceId: 'r1', purpose: 'Chrome 主动取消会议', status: 'CANCELLED', releaseType: 'CANCELLED',
      startTime: atToday(10), endTime: atToday(11)
    }));
    await insertBooking(booking({
      id: 'mrp6-browser-released', resourceId: 'r1', purpose: 'Chrome 确认未使用会议', status: 'CANCELLED', releaseType: 'UNUSED_CONFIRMED',
      startTime: atToday(11), endTime: atToday(12)
    }));
    for (let index = 1; index <= 4; index += 1) {
      await insertBooking(booking({
        id: `mrp6-browser-next-${index}`, resourceId: 'r1', purpose: `GAP09 后续会议 ${index}`,
        startTime: new Date(now + index * 10 * 60000).toISOString(), endTime: new Date(now + (index * 10 + 50) * 60000).toISOString()
      }));
    }
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('GAP-07 全量时间轴、五档七日视图与领导驾驶舱在真实 Chrome 中一致呈现', async ({ browser }) => {
    const admin = await openWorkspace(browser, 'admin', { width: 1920, height: 1080 });
    const dashboard = admin.page.locator('.executive-dashboard');
    await expect(dashboard).toBeVisible();
    await expect(admin.page.locator('.executive-metric')).toHaveCount(8);
    const dashboardPayload = await admin.page.evaluate(async () => (await fetch('/api/dashboard')).json());
    const metrics = [
      ['会议室总数', 'roomCount', '间'], ['当前使用中', 'currentInUse', '间'], ['当前空闲', 'currentIdle', '间'],
      ['今日预约场次', 'todayBookingCount', '场'], ['今日占用率', 'todayUtilization', '%'],
      ['本周平均占用率', 'weekAverageUtilization', '%'], ['今日爽约', 'todayNoShowCount', '场'], ['超时未释放', 'overdueReleaseCount', '间']
    ] as const;
    for (const [label, key, unit] of metrics) {
      const metric = dashboard.locator('.executive-metric').filter({ hasText: label });
      await expect(metric.locator('strong')).toHaveText(`${dashboardPayload.executive[key]}${unit}`);
    }
    await expect(admin.page.locator('.executive-room')).toHaveCount(3);
    await expect(admin.page.locator('.executive-room').filter({ hasText: 'GAP07 十六层领导厅' })).toContainText('使用中');
    await expect(admin.page.locator('.executive-room').filter({ hasText: 'GAP07 十九层保密厅' })).toContainText('涉密不可见');
    await expect(admin.page.locator('.executive-room').filter({ hasText: 'GAP07 二十层接待厅' })).toContainText('当前空闲');
    await expect(admin.page.locator('.executive-exceptions')).toContainText('Chrome 未签到复核');

    const timeline = admin.page.locator('.studio-timeline');
    await expect(timeline.locator('.timeline-track')).toHaveCount(6);
    await expect(timeline.locator('.timeline-floor-group')).toHaveCount(4);
    const groupTitles = await timeline.locator('.timeline-floor-group h4').allTextContents();
    expect(groupTitles.map(text => text.replace(/\d+ 个空间/, '').trim())).toEqual(['16层', '19层', '20层', '其他楼层']);
    await expect(timeline.locator('.timeline-legend > span')).toHaveCount(6);
    await expect(timeline.locator('.timeline-now')).toHaveCount(6);
    const ticks = timeline.locator('.min-w-\\[900px\\] > div:first-child .flex-1.flex > div');
    const hourlyTickCount = await ticks.count();
    await timeline.getByRole('button', { name: '半小时', exact: true }).click();
    await expect(timeline.getByRole('button', { name: '半小时', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await ticks.count()).toBeGreaterThan(hourlyTickCount);

    const confidential = timeline.getByRole('button', { name: /GAP07 十九层保密厅，涉密会议，占用/ });
    await expect(confidential).toBeDisabled();
    await expect(confidential).toContainText('占用');
    await expect(admin.page.getByText('GAP07 涉密主题不得泄露', { exact: true })).toHaveCount(0);
    await timeline.getByRole('button', { name: /Alpha 战略会议室，Chrome 门口屏当前会议/ }).click();
    const dialog = admin.page.getByRole('dialog', { name: '当日会议详情' });
    const current = dialog.locator('article').filter({ hasText: 'Chrome 门口屏当前会议' });
    await expect(current).toContainText('市场部');
    await expect(current).toContainText('李员工');
    await expect(current).toContainText('010-88886668 / 13800000003');
    await expect(current).toContainText('6 人');
    await expect(current).toContainText('茶水服务');
    await expect(current).toContainText('茶水份数：6');
    await dialog.getByRole('button', { name: '关闭当日会议详情' }).click();

    await admin.page.getByRole('tab', { name: /本周/ }).click();
    const matrix = admin.page.locator('.studio-usage-grid');
    await expect(matrix).toBeVisible();
    await expect(matrix.locator('.occupancy-trend-day')).toHaveCount(7);
    await expect(matrix.locator('.occupancy-legend > span')).toHaveCount(5);
    const levelColors = await matrix.locator('.occupancy-legend i').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
    expect(new Set(levelColors).size).toBe(5);
    const importantRow = matrix.locator('tbody tr').filter({ hasText: 'GAP07 十六层领导厅' });
    await expect(importantRow.locator('.occupancy-cell').first()).toContainText('重点 1');
    await importantRow.locator('.occupancy-cell').first().click();
    await expect(admin.page.getByRole('dialog', { name: '当日会议详情' })).toContainText('GAP07 领导重点会议');
    await admin.page.getByRole('button', { name: '关闭当日会议详情' }).click();
    await admin.page.getByRole('tab', { name: /今日/ }).click();
    await admin.page.locator('.studio-main').evaluate(element => element.scrollTo({ top: 0 }));
    await admin.page.screenshot({ path: 'test-results/gap07-executive-dashboard-1920.png', fullPage: true });
    expect(await admin.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await admin.page.setViewportSize({ width: 390, height: 844 });
    await expect(dashboard).toBeVisible();
    await expect(timeline).toBeVisible();
    expect(await admin.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await dashboard.evaluate(element => element.scrollIntoView({ block: 'start' }));
    await admin.page.screenshot({ path: 'test-results/gap07-executive-dashboard-mobile.png', fullPage: true });
    expect(admin.errors).toEqual([]);
    await admin.context.close();

    const requester = await openWorkspace(browser, 'requester');
    await expect(requester.page.locator('.agenda-next-title')).toHaveText('Chrome 门口屏当前会议');
    await expect(requester.page.locator('.executive-dashboard')).toHaveCount(0);
    await expect(requester.page.locator('.studio-timeline')).toBeVisible();
    expect(requester.errors).toEqual([]);
    await requester.context.close();
  });

  test('GAP-08 预约变化十秒内自动刷新，保留当前七日视图且不重新加载页面', async ({ browser }) => {
    const admin = await openWorkspace(browser, 'admin');
    await expect(admin.page.locator('.executive-dashboard')).toBeVisible();
    const before = await admin.page.evaluate(async () => (await fetch('/api/dashboard')).json());
    await admin.page.getByRole('tab', { name: /本周/ }).click();
    const matrix = admin.page.locator('.studio-usage-grid');
    await expect(matrix).toBeVisible();
    await admin.page.evaluate(() => { (window as any).__gap08PageMarker = 'retained'; });
    const now = Date.now();
    await insertBooking(booking({
      id: 'mrp6-browser-live-refresh', userId: '2', resourceId: 'r-gap07-20', purpose: 'GAP08 十秒自动刷新会议',
      meetingType: 'IMPORTANT', hasLeader: true, leaderDetails: '公司领导',
      checkedInAt: new Date(now).toISOString(), actualStartTime: new Date(now).toISOString(),
      startTime: new Date(now).toISOString(), endTime: new Date(now + 3600000).toISOString()
    }));
    const refreshedRow = matrix.locator('tbody tr').filter({ hasText: 'GAP07 二十层接待厅' });
    await expect(refreshedRow.locator('.occupancy-cell').first()).toContainText('重点 1', { timeout: 12000 });
    const after = await admin.page.evaluate(async () => (await fetch('/api/dashboard')).json());
    expect(after.executive.todayBookingCount).toBe(before.executive.todayBookingCount + 1);
    const bookingMetric = admin.page.locator('.executive-metric').filter({ hasText: '今日预约场次' });
    await expect(bookingMetric.locator('strong')).toHaveText(`${after.executive.todayBookingCount}场`);
    await expect(admin.page.getByRole('tab', { name: /本周/ })).toHaveAttribute('aria-selected', 'true');
    await expect(matrix).toBeVisible();
    expect(await admin.page.evaluate(() => (window as any).__gap08PageMarker)).toBe('retained');
    expect(admin.errors).toEqual([]);
    await admin.context.close();
  });

  test('驾驶舱断网保留最后读模型并恢复，异常中心留下完整处理记录', async ({ browser }) => {
    const requester = await openWorkspace(browser, 'requester');
    await expect(requester.page.locator('.agenda-next-title')).toHaveText('Chrome 门口屏当前会议');
    await requester.page.route('**/api/workspace', route => route.abort());
    await requester.page.route('**/api/dashboard', route => route.abort());
    await requester.page.route('**/api/exceptions', route => route.abort());
    await requester.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(requester.page.getByText('连接异常，更改未保存', { exact: true }).first()).toBeVisible();
    await expect(requester.page.locator('.agenda-next-title')).toHaveText('Chrome 门口屏当前会议');
    const reconnectStart = new Date();
    reconnectStart.setHours(15, 0, 0, 0);
    const reconnectEnd = new Date(reconnectStart);
    reconnectEnd.setHours(16);
    await insertBooking(booking({
      id: 'mrp6-browser-reconnect', resourceId: 'r-gap07-20', purpose: 'GAP08 断网恢复补齐会议',
      meetingType: 'IMPORTANT', hasLeader: true, leaderDetails: '公司领导',
      checkedInAt: reconnectStart.toISOString(), actualStartTime: reconnectStart.toISOString(),
      startTime: reconnectStart.toISOString(), endTime: reconnectEnd.toISOString()
    }));
    await requester.page.unroute('**/api/workspace');
    await requester.page.unroute('**/api/dashboard');
    await requester.page.unroute('**/api/exceptions');
    const recoveredWorkspace = requester.page.waitForResponse(response => response.url().endsWith('/api/workspace') && response.ok());
    const recoveredDashboard = requester.page.waitForResponse(response => response.url().endsWith('/api/dashboard') && response.ok());
    const recoveredExceptions = requester.page.waitForResponse(response => response.url().endsWith('/api/exceptions') && response.ok());
    await requester.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await Promise.all([recoveredWorkspace, recoveredDashboard, recoveredExceptions]);
    await expect(requester.page.getByText('已同步至 MySQL', { exact: true })).toBeVisible();
    await expect(requester.page.locator('.agenda-next-title')).toHaveCount(1);
    await expect(requester.page.locator('.timeline-booking').filter({ hasText: 'GAP08 断网恢复补齐会议' })).toBeVisible();
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
    await expect(door.locator('.door-room-code')).toHaveText('R1');
    await expect(door.locator('.door-current h2')).toHaveText('Chrome 门口屏当前会议');
    await expect(door.locator('.door-current .door-department')).toHaveText('市场部');
    await expect(door.locator('.door-countdown')).toContainText('剩余');
    await expect(door.locator('.door-next')).toContainText('GAP09 后续会议 1');
    await expect(door.locator('.door-next')).toContainText('市场部');
    await expect(door.locator('.door-agenda li')).toHaveCount(3);
    await expect(door.locator('.door-agenda li').filter({ hasText: 'Chrome 门口屏当前会议' })).toContainText('进行中');
    await expect(door.locator('.door-agenda li').filter({ hasText: 'GAP09 后续会议 1' })).toContainText('待开始');
    await expect(door.locator('.door-agenda').getByText('GAP09 后续会议 3', { exact: true })).toHaveCount(0);
    await expect(door.locator('.door-more')).toHaveText('另有 2 场，更多预约请查看系统');
    await expect(door.getByText('Chrome 未签到复核', { exact: true })).toHaveCount(0);
    const doorDimensions = await door.evaluate(() => ({ height: document.documentElement.scrollHeight, viewport: window.innerHeight }));
    expect(doorDimensions.height, JSON.stringify(doorDimensions)).toBeLessThanOrEqual(doorDimensions.viewport);
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
    await expect(door.locator('.door-agenda li')).toHaveCount(3);

    await door.evaluate(() => { (window as any).__gap09BeforeRestart = true; });
    await card.getByRole('button', { name: '远程重启', exact: true }).click();
    await Promise.all([
      admin.page.waitForResponse(response => response.url().endsWith('/restart') && response.ok()),
      card.getByRole('button', { name: '确认执行', exact: true }).click()
    ]);
    const reloaded = door.waitForEvent('framenavigated');
    const restartSnapshot = door.waitForResponse(response => response.url().endsWith('/api/device/snapshot') && response.ok());
    await door.evaluate(() => window.dispatchEvent(new Event('online')));
    await Promise.all([reloaded, restartSnapshot]);
    await expect(door.locator('.door-current h2')).toHaveText('Chrome 门口屏当前会议');
    expect(await door.evaluate(() => (window as any).__gap09BeforeRestart)).toBeUndefined();

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
    const rangeSelect = admin.page.getByLabel('报表时间范围', { exact: true });
    const anchorInput = admin.page.getByLabel('报表基准日期', { exact: true });
    const today = await anchorInput.inputValue();
    const selectRange = async (value: 'DAY' | 'WEEK' | 'MONTH' | 'ALL') => {
      const response = admin.page.waitForResponse(item => item.url().includes('/api/reports?') && item.ok());
      await rangeSelect.selectOption(value);
      return (await response).json();
    };
    const supplySection = admin.page.locator('section').filter({ has: admin.page.getByRole('heading', { name: '会务备料量与执行状态', exact: true }) });
    const supplyRow = supplySection.locator('tbody tr').filter({ hasText: '茶水服务' });
    await expect(supplyRow).toContainText('tea · v1');
    await expect(supplyRow).toContainText('6 份');
    await expect(supplyRow.locator('td').nth(8)).toHaveText('1');

    const dayReport = await selectRange('DAY');
    const dayStart = new Date(`${today}T00:00:00`);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    expect(dayReport.start).toBe(dayStart.toISOString());
    expect(dayReport.end).toBe(dayEnd.toISOString());
    await expect(supplyRow).toContainText('6 份');

    const emptyResponse = admin.page.waitForResponse(item => item.url().includes('/api/reports?') && item.ok());
    await anchorInput.fill('2099-01-15');
    await emptyResponse;
    await expect(supplySection.getByText('当前范围没有可汇总的结构化备料需求', { exact: true })).toBeVisible();
    const restoredResponse = admin.page.waitForResponse(item => item.url().includes('/api/reports?') && item.ok());
    await anchorInput.fill(today);
    await restoredResponse;

    const weekReport = await selectRange('WEEK');
    const weekStart = new Date(`${today}T00:00:00`);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    expect(weekReport.start).toBe(weekStart.toISOString());
    expect(weekReport.end).toBe(weekEnd.toISOString());
    const monthReport = await selectRange('MONTH');
    const monthStart = new Date(`${today}T00:00:00`);
    monthStart.setDate(1);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    expect(monthReport.start).toBe(monthStart.toISOString());
    expect(monthReport.end).toBe(monthEnd.toISOString());
    await expect(supplyRow).toContainText('6 份');
    await selectRange('ALL');

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
    expect(csv.toString('utf8')).toContain('"备料统计"');
    expect(csv.toString('utf8')).toContain('"茶水服务","tea","1","servings","茶水份数","份"');

    const xlsxDownload = admin.page.waitForEvent('download');
    await admin.page.getByRole('button', { name: '导出 XLSX', exact: true }).click();
    const xlsxPath = await (await xlsxDownload).path();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await readFile(xlsxPath!));
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['多维汇总', '预约对账', '签到明细', '备料统计', '服务明细', '差异清单', '导出说明']);
    expect(workbook.getWorksheet('预约对账')!.getSheetValues().flat()).toContain('Chrome 门口屏当前会议');
    let teaSupplyRow: ExcelJS.Row | undefined;
    workbook.getWorksheet('备料统计')!.eachRow(row => {
      if (row.getCell(3).value === 'tea') teaSupplyRow = row;
    });
    expect(teaSupplyRow?.getCell(2).value).toBe('茶水服务');
    expect(teaSupplyRow?.getCell(7).value).toBe('份');
    expect(teaSupplyRow?.getCell(9).value).toBe(6);
    expect(teaSupplyRow?.getCell(14).value).toBe(1);
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

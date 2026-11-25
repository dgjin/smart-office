import { test, expect, type Browser, type Page } from '@playwright/test';
import type { MonitoringScope } from '../../types.ts';
import { integrationEnabled, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
type Session = Awaited<ReturnType<TestServer['login']>>;
let adminSession: Session;

const roleIds = { room: 'E2E_MONITOR_ROOM', office: 'E2E_MONITOR_OFFICE', all: 'E2E_MONITOR_ALL' };
const userIds = { room: 'u-e2e-monitor-room', office: 'u-e2e-monitor-office', all: 'u-e2e-monitor-all' };
const roles = [
  { id: roleIds.room, name: 'E2E 会议室监控员', description: '浏览器独立授权验收', color: 'indigo', monitoringScopes: ['MEETING_ROOMS'] },
  { id: roleIds.office, name: 'E2E 办公室监控员', description: '浏览器独立授权验收', color: 'emerald', monitoringScopes: ['OFFICES'] },
  { id: roleIds.all, name: 'E2E 双监控验收员', description: '浏览器撤权验收', color: 'amber', monitoringScopes: ['MEETING_ROOMS', 'OFFICES'] }
];

const call = (pathname: string, method: string, body?: unknown) => server.request(pathname, {
  method,
  headers: { Cookie: adminSession.cookie },
  body: body === undefined ? undefined : JSON.stringify(body)
});
const updateRole = async (id: string, monitoringScopes: MonitoringScope[]) => {
  const role = roles.find(item => item.id === id)!;
  const response = await call(`/api/roles/${id}`, 'PUT', { role: { ...role, monitoringScopes } });
  expect(response.status, JSON.stringify(await response.json())).toBe(200);
};

const openActor = async (browser: Browser, userId: string, viewport = { width: 1440, height: 1000 }) => {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const authenticated = await page.request.get(`${server.baseUrl}/api/auth/dev?userId=${encodeURIComponent(userId)}`);
  expect(authenticated.status()).toBe(200);
  const workspace = page.waitForResponse(response => response.url().endsWith('/api/workspace') && response.request().method() === 'GET' && response.ok());
  await page.goto(server.baseUrl);
  await workspace;
  await expect(page.locator('.studio-app')).toBeVisible();
  return { context, page };
};

const expandSidebar = async (page: Page) => {
  if (await page.locator('.studio-app').getAttribute('data-sidebar') === 'collapsed') {
    await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
  }
};
const openAdminView = async (page: Page, label: string) => {
  await expandSidebar(page);
  const target = page.getByRole('button', { name: label, exact: true });
  if (!await target.isVisible()) await page.getByRole('button', { name: '系统管理', exact: true }).click();
  await target.click();
};
const expectMeetingSnapshot = async (page: Page) => {
  await expect(page.locator('.monitoring-screen').getByRole('heading', { name: '会议室监控大屏', exact: true })).toBeVisible();
  await expect(page.locator('.monitoring-screen')).toHaveAttribute('data-scope', 'MEETING_ROOMS');
  await expect(page.locator('.monitoring-connection [role="status"]')).toHaveText('实时推送已连接');
  await expect(page.locator('.monitoring-room-card').first()).toBeVisible();
  await expect(page.locator('.monitoring-office-table-shell')).toHaveCount(0);
};
const expectOfficeSnapshot = async (page: Page) => {
  await expect(page.locator('.monitoring-screen').getByRole('heading', { name: '办公室监控大屏', exact: true })).toBeVisible();
  await expect(page.locator('.monitoring-screen')).toHaveAttribute('data-scope', 'OFFICES');
  await expect(page.locator('.monitoring-connection [role="status"]')).toHaveText('实时推送已连接');
  await expect(page.locator('.monitoring-office-table-shell tbody tr').first()).toBeVisible();
  await expect(page.locator('.monitoring-room-grid')).toHaveCount(0);
};
const readPalette = async (page: Page) => page.locator('.monitoring-screen').evaluate(screen => {
  const styles = getComputedStyle(screen);
  return ['--monitor-in-use', '--monitor-reserved', '--monitor-idle', '--monitor-maintenance', '--monitor-pending']
    .map(name => styles.getPropertyValue(name).trim());
});
const expectUniversalPalette = async (page: Page) => {
  expect(await readPalette(page)).toEqual(['#b42318', '#175cd3', '#067647', '#b54708', '#475467']);
};
const expectRoomStatusColors = async (page: Page) => {
  await expectUniversalPalette(page);
  const roomStatuses = await page.locator('.monitoring-room-card').evaluateAll(cards => cards.map(card => ({
    status: card.getAttribute('data-status'),
    color: getComputedStyle(card).borderTopColor,
    headerBackground: getComputedStyle(card.querySelector('.monitoring-card-head')!).backgroundColor,
    badgeBackground: getComputedStyle(card.querySelector('.monitoring-status-badge')!).backgroundColor,
    badgeColor: getComputedStyle(card.querySelector('.monitoring-status-badge')!).color,
    hasIcon: Boolean(card.querySelector('.monitoring-status-badge svg')),
    label: card.querySelector('.monitoring-status-badge')!.textContent
  })));
  expect(new Set(roomStatuses.map(item => item.color)).size).toBe(new Set(roomStatuses.map(item => item.status)).size);
  expect(new Set(roomStatuses.map(item => item.headerBackground)).size).toBe(new Set(roomStatuses.map(item => item.status)).size);
  for (const item of roomStatuses) {
    expect(item.badgeBackground).toBe(item.color);
    expect(item.badgeColor).toBe('rgb(255, 255, 255)');
    expect(item.hasIcon).toBe(true);
    expect(item.label).toBeTruthy();
  }
};
const expectOfficeStatusColors = async (page: Page) => {
  await expectUniversalPalette(page);
  const summaries = await page.locator('.monitoring-office-summary button').evaluateAll(buttons => buttons.map(button => ({
    status: button.getAttribute('data-status'),
    border: getComputedStyle(button).borderTopColor,
    background: getComputedStyle(button).backgroundColor,
    hasIcon: Boolean(button.querySelector('.monitoring-office-summary-label svg'))
  })));
  expect(new Set(summaries.map(item => item.border)).size).toBe(4);
  expect(new Set(summaries.map(item => item.background)).size).toBe(4);
  expect(summaries.every(item => item.hasIcon)).toBe(true);
  const colors = new Map(summaries.map(item => [item.status, item.border]));
  const badges = await page.locator('.monitoring-office-status').evaluateAll(items => items.map(item => ({
    status: item.getAttribute('data-status'),
    color: getComputedStyle(item).color,
    background: getComputedStyle(item).backgroundColor,
    hasIcon: Boolean(item.querySelector('svg'))
  })));
  for (const badge of badges) {
    expect(badge.color).toBe('rgb(255, 255, 255)');
    expect(badge.background).toBe(colors.get(badge.status));
    expect(badge.hasIcon).toBe(true);
  }
};

test.describe('双监控大屏浏览器验收', () => {
  test.skip(!integrationEnabled, '仅允许显式隔离 MySQL 测试环境');

  test.beforeAll(async () => {
    await resetTestDb();
    await server.start();
    adminSession = await server.login('1');
    for (const role of roles) {
      const response = await call('/api/roles', 'POST', { role });
      expect(response.status, JSON.stringify(await response.json())).toBe(201);
    }
    for (const [key, id] of Object.entries(userIds)) {
      const roleId = roleIds[key as keyof typeof roleIds];
      const response = await call('/api/users', 'POST', {
        user: { id, name: roles.find(role => role.id === roleId)!.name, email: `${id}@company.com`, role: [roleId], department: '行政部', mobile: '13800000200' }
      });
      expect(response.status, JSON.stringify(await response.json())).toBe(201);
    }
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('管理员使用两个独立链接，刷新与前进后退保持页面且实时筛选可用', async ({ browser }, testInfo) => {
    const { context, page } = await openActor(browser, '1');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await expandSidebar(page);
      const meetingLink = page.getByRole('link', { name: '会议室监控', exact: true });
      const officeLink = page.getByRole('link', { name: '办公室监控', exact: true });
      await expect(meetingLink).toHaveAttribute('href', '#/monitoring/meeting-rooms');
      await expect(officeLink).toHaveAttribute('href', '#/monitoring/offices');
      await meetingLink.click();
      await expectMeetingSnapshot(page);
      await expectRoomStatusColors(page);
      await expect(page).toHaveURL(/#\/monitoring\/meeting-rooms$/);
      await expect(page.locator('.monitoring-metric')).toHaveCount(4);

      await page.getByRole('group', { name: '会议室状态筛选' }).getByRole('button', { name: '空闲', exact: true }).click();
      await expect(page.locator('.monitoring-room-card:not([data-status="IDLE"])')).toHaveCount(0);
      const resource = { id: `r-monitoring-e2e-${Date.now()}`, name: '监控浏览器实时验收室', type: 'ROOM', capacity: 8, location: '主楼 3层', features: [], status: 'AVAILABLE' };
      const created = await page.request.post(`${server.baseUrl}/api/resources`, { headers: { Origin: server.baseUrl }, data: { resource } });
      expect(created.status(), JSON.stringify(await created.json())).toBe(201);
      await expect(page.getByRole('heading', { name: resource.name, exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('monitoring-meeting-rooms-desktop.png'), fullPage: true });

      await officeLink.click();
      await expectOfficeSnapshot(page);
      await expectOfficeStatusColors(page);
      await expect(page).toHaveURL(/#\/monitoring\/offices$/);
      await expect(page.locator('.monitoring-office-table-shell tbody tr')).toHaveCount(40);
      const more = page.getByRole('button', { name: /^显示更多/ });
      await more.click();
      await expect(page.locator('.monitoring-office-table-shell tbody tr')).toHaveCount(80);
      await page.locator('.monitoring-office-summary button[data-status="ASSIGNED"]').click();
      await expect(page.locator('.monitoring-office-status:not([data-status="ASSIGNED"])')).toHaveCount(0);
      await page.getByRole('button', { name: '清除办公室状态筛选', exact: true }).click();

      const snapshotResponse = await page.request.get(`${server.baseUrl}/api/monitoring/offices/snapshot`);
      expect(snapshotResponse.status()).toBe(200);
      const snapshot = await snapshotResponse.json();
      const office = snapshot.offices.find((item: any) => item.department && item.status === 'ASSIGNED');
      expect(office).toBeTruthy();
      await page.getByRole('combobox', { name: '楼栋', exact: true }).selectOption(office.buildingId);
      await page.getByRole('combobox', { name: '楼层', exact: true }).selectOption(String(office.floorNo));
      await page.getByRole('searchbox', { name: '搜索办公室' }).fill(office.department);
      await expect(page.locator('.monitoring-office-table-shell tbody tr').first()).toContainText(office.department);

      const palette = await readPalette(page);
      const classicWrite = page.waitForResponse(response => response.url().endsWith('/api/preferences') && response.request().method() === 'PUT' && response.ok());
      await page.getByTitle('翡翠绿', { exact: true }).click();
      await classicWrite;
      await expect(page.locator('.studio-app')).toHaveAttribute('data-theme', 'emerald');
      expect(await readPalette(page)).toEqual(palette);

      await page.reload();
      await expectOfficeSnapshot(page);
      await page.goBack();
      await expectMeetingSnapshot(page);
      await page.goForward();
      await expectOfficeSnapshot(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('未授权员工没有入口，深链接和直接 API 均被拒绝', async ({ browser }) => {
    const { context, page } = await openActor(browser, '3');
    try {
      await expect(page.getByRole('link', { name: '会议室监控', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: '办公室监控', exact: true })).toHaveCount(0);
      for (const path of ['meeting-rooms', 'offices']) {
        expect((await page.request.get(`${server.baseUrl}/api/monitoring/${path}/snapshot`)).status()).toBe(403);
        expect((await page.request.get(`${server.baseUrl}/api/monitoring/${path}/events`)).status()).toBe(403);
      }
      await page.goto(`${server.baseUrl}/#/monitoring/meeting-rooms`);
      await expect.poll(() => new URL(page.url()).hash).toBe('');
      await expect(page.locator('.monitoring-screen')).toHaveCount(0);
      await page.evaluate(() => { window.location.hash = '/monitoring/offices'; });
      await expect.poll(() => new URL(page.url()).hash).toBe('');
      await expect(page.locator('.monitoring-screen')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('指定角色只看获授权页面，管理员可在角色管理中追加另一项授权', async ({ browser }) => {
    const room = await openActor(browser, userIds.room);
    try {
      await expect(room.page.getByRole('link', { name: '会议室监控', exact: true })).toBeVisible();
      await expect(room.page.getByRole('link', { name: '办公室监控', exact: true })).toHaveCount(0);
      await room.page.getByRole('link', { name: '会议室监控', exact: true }).click();
      await expectMeetingSnapshot(room.page);
      expect((await room.page.request.get(`${server.baseUrl}/api/monitoring/offices/snapshot`)).status()).toBe(403);
    } finally {
      await room.context.close();
    }

    const office = await openActor(browser, userIds.office);
    try {
      await expect(office.page.getByRole('link', { name: '会议室监控', exact: true })).toHaveCount(0);
      await expect(office.page.getByRole('link', { name: '办公室监控', exact: true })).toBeVisible();
      await office.page.getByRole('link', { name: '办公室监控', exact: true }).click();
      await expectOfficeSnapshot(office.page);
      expect((await office.page.request.get(`${server.baseUrl}/api/monitoring/meeting-rooms/snapshot`)).status()).toBe(403);
    } finally {
      await office.context.close();
    }

    const admin = await openActor(browser, '1');
    try {
      await openAdminView(admin.page, '角色管理');
      await admin.page.getByRole('button', { name: '编辑角色E2E 会议室监控员', exact: true }).click();
      const roomCheckbox = admin.page.getByRole('checkbox', { name: /会议室监控/ });
      const officeCheckbox = admin.page.getByRole('checkbox', { name: /办公室监控/ });
      await expect(roomCheckbox).toBeChecked();
      await expect(officeCheckbox).not.toBeChecked();
      await officeCheckbox.check();
      const saved = admin.page.waitForResponse(response => response.url().endsWith(`/api/roles/${roleIds.room}`) && response.request().method() === 'PUT' && response.ok());
      await admin.page.getByRole('button', { name: '保存', exact: true }).click();
      await saved;
      const roleCard = admin.page.locator('.group').filter({ has: admin.page.getByRole('heading', { name: 'E2E 会议室监控员', exact: true }) });
      await expect(roleCard).toContainText('会议室监控、办公室监控');
    } finally {
      await updateRole(roleIds.room, ['MEETING_ROOMS']);
      await admin.context.close();
    }
  });

  test('SSE 撤权后立即清除受控数据，刷新深链接返回工作台', async ({ browser }) => {
    const { context, page } = await openActor(browser, userIds.all);
    try {
      await page.goto(`${server.baseUrl}/#/monitoring/meeting-rooms`);
      await expectMeetingSnapshot(page);
      await updateRole(roleIds.all, ['OFFICES']);
      await expect(page.locator('.monitoring-connection [role="status"]')).toHaveText('实时连接已停止');
      await expect(page.locator('.monitoring-connection-note')).toContainText('权限已变更');
      await expect(page.locator('.monitoring-room-card')).toHaveCount(0);
      expect((await page.request.get(`${server.baseUrl}/api/monitoring/meeting-rooms/snapshot`)).status()).toBe(403);
      expect((await page.request.get(`${server.baseUrl}/api/monitoring/offices/snapshot`)).status()).toBe(200);
      await page.reload();
      await expect.poll(() => new URL(page.url()).hash).toBe('');
      await expect(page.locator('.monitoring-screen')).toHaveCount(0);
    } finally {
      await updateRole(roleIds.all, ['MEETING_ROOMS', 'OFFICES']);
      await context.close();
    }
  });

  test('移动端分别进入双页面，保持回顶、状态图标、筛选与横向表格滚动', async ({ browser }, testInfo) => {
    const { context, page } = await openActor(browser, userIds.all, { width: 375, height: 812 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.locator('.studio-main').evaluate(element => element.scrollTo({ top: element.scrollHeight }));
      expect(await page.locator('.studio-main').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      const moreNavigation = page.getByRole('navigation', { name: '移动端主导航', exact: true });
      await moreNavigation.getByRole('button', { name: '更多', exact: true }).click();
      await page.getByRole('dialog', { name: '更多功能', exact: true }).getByRole('button', { name: '会议室监控', exact: true }).click();
      await expectMeetingSnapshot(page);
      await expect.poll(() => page.locator('.studio-main').evaluate(element => element.scrollTop)).toBe(0);
      await expectRoomStatusColors(page);
      await expect(page.locator('.studio-agent-launcher')).toBeHidden();
      await expect(page.locator('.monitoring-assistant')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('monitoring-meeting-rooms-mobile-375.png'), fullPage: true });

      await moreNavigation.getByRole('button', { name: '更多', exact: true }).click();
      await page.getByRole('dialog', { name: '更多功能', exact: true }).getByRole('button', { name: '办公室监控', exact: true }).click();
      await expectOfficeSnapshot(page);
      await expectOfficeStatusColors(page);
      const tableShell = page.locator('.monitoring-office-table-shell');
      await expect(tableShell).toHaveCSS('overflow-x', 'auto');
      await page.locator('.monitoring-office-summary button[data-status="VACANT"]').click();
      await expect(page.locator('.monitoring-office-status:not([data-status="VACANT"])')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('monitoring-offices-mobile-375.png'), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

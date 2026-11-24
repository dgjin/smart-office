import { readFile } from 'node:fs/promises';
import { test, expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();

const login = async (page: Page, name: string) => {
  await page.goto(server.baseUrl);
  const account = page.locator('.login-account').filter({ has: page.locator('.login-account-name', { hasText: name }) });
  await expect(account).toBeVisible();
  const snapshot = page.waitForResponse(response => response.url().endsWith('/api/workspace') && response.request().method() === 'GET' && response.ok());
  await account.click();
  await snapshot;
  await expect(page.locator('.studio-app')).toBeVisible();
};

const openWorkspace = async (browser: Browser, name: string, viewport = { width: 1440, height: 1000 }) => {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await login(page, name);
  return { context, page };
};

const approvePurpose = async (browser: Browser, name: string, purpose: string) => {
  const { context, page } = await openWorkspace(browser, name);
  await page.getByRole('button', { name: '审批工作台', exact: true }).click();
  const card = page.locator('div').filter({ has: page.getByText(purpose, { exact: false }) }).filter({ has: page.getByRole('button', { name: '通过审批', exact: true }) }).last();
  await expect(card).toBeVisible();
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/agent/action') && response.status() === 200),
    card.getByRole('button', { name: '通过审批', exact: true }).click()
  ]);
  await context.close();
};

test.describe('MySQL-only 浏览器验收', () => {
  test.skip(!integrationEnabled, '仅允许显式隔离 MySQL 测试环境');

  test.beforeAll(async () => {
    await resetTestDb();
    await server.start();
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('移除旧浏览器副本，主题和侧栏偏好在刷新、重启及新会话后恢复', async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem('SMART_OFFICE_DATA_V35', '{"users":[{"id":"forged"}]}');
      localStorage.setItem('SMART_OFFICE_THEME', 'rose');
      localStorage.setItem('SMART_OFFICE_NOTIFICATIONS', '[{"title":"forged"}]');
      localStorage.setItem('SMART_OFFICE_REMINDERS', '["forged"]');
    });
    const page = await context.newPage();
    await login(page, '李员工');
    const stored = await page.evaluate(() => Object.keys(localStorage));
    expect(stored).not.toContain('SMART_OFFICE_DATA_V35');
    expect(stored).not.toContain('SMART_OFFICE_THEME');
    expect(stored).not.toContain('SMART_OFFICE_NOTIFICATIONS');
    expect(stored).not.toContain('SMART_OFFICE_REMINDERS');

    const preferenceWrite = page.waitForResponse(response => response.url().endsWith('/api/preferences') && response.request().method() === 'PUT' && response.ok());
    await page.getByTitle('翡翠绿', { exact: true }).click();
    await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
    await preferenceWrite;
    await expect(page.locator('.studio-app')).toHaveAttribute('data-theme', 'emerald');
    await expect(page.locator('.studio-app')).toHaveAttribute('data-sidebar', 'collapsed');
    await page.reload();
    await expect(page.locator('.studio-app')).toHaveAttribute('data-theme', 'emerald');
    await expect(page.locator('.studio-app')).toHaveAttribute('data-sidebar', 'collapsed');

    await server.stop();
    await server.start();
    await page.reload();
    await expect(page.locator('.studio-app')).toHaveAttribute('data-theme', 'emerald');
    await expect(page.locator('.studio-app')).toHaveAttribute('data-sidebar', 'collapsed');
    await context.close();

    const fresh = await openWorkspace(browser, '李员工');
    await expect(fresh.page.locator('.studio-app')).toHaveAttribute('data-theme', 'emerald');
    await expect(fresh.page.locator('.studio-app')).toHaveAttribute('data-sidebar', 'collapsed');
    expect(await fresh.page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    await fresh.context.close();
  });

  test('东方蓝与原主题可在桌面和移动端互换并跨刷新恢复', async ({ browser }) => {
    const desktop = await openWorkspace(browser, '李员工');
    if (await desktop.page.locator('.studio-app').getAttribute('data-sidebar') === 'collapsed') {
      await desktop.page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
    }
    await expect(desktop.page.getByTitle('东方蓝', { exact: true })).toBeVisible();
    const desktopWrite = desktop.page.waitForResponse(response => response.url().endsWith('/api/preferences') && response.request().method() === 'PUT' && response.ok());
    await desktop.page.getByTitle('东方蓝', { exact: true }).click();
    await desktopWrite;
    await expect(desktop.page.locator('.studio-app')).toHaveAttribute('data-theme', 'coamc');
    const orientLogo = desktop.page.getByRole('img', { name: '中国东方', exact: true });
    await expect(orientLogo).toBeVisible();
    await expect(orientLogo).toHaveAttribute('src', '/images/china-orient-logo-horizontal.png');
    await expect(desktop.page.locator('.studio-brand-copy')).toBeHidden();
    await expect(desktop.page.locator('.studio-sidebar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(desktop.page.getByRole('button', { name: '会议工作台', exact: true })).toHaveCSS('background-color', 'rgb(0, 66, 127)');
    await desktop.page.reload();
    await expect(desktop.page.locator('.studio-app')).toHaveAttribute('data-theme', 'coamc');
    await expect(desktop.page.getByRole('img', { name: '中国东方', exact: true })).toBeVisible();
    await desktop.page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
    await expect(desktop.page.locator('.studio-brand-symbol-orient')).toBeVisible();
    await expect(desktop.page.locator('.studio-brand-logo-orient')).toBeHidden();
    await desktop.page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
    await expect(desktop.page.getByRole('img', { name: '中国东方', exact: true })).toBeVisible();

    const classicWrite = desktop.page.waitForResponse(response => response.url().endsWith('/api/preferences') && response.request().method() === 'PUT' && response.ok());
    await desktop.page.getByTitle('翡翠绿', { exact: true }).click();
    await classicWrite;
    await expect(desktop.page.locator('.studio-app')).toHaveAttribute('data-theme', 'emerald');
    await expect(desktop.page.locator('.studio-brand-copy')).toBeHidden();
    await expect(desktop.page.locator('.studio-brand-orient')).toBeVisible();
    await expect(desktop.page.locator('.studio-brand-orient')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(desktop.page.getByRole('img', { name: '中国东方', exact: true })).toHaveAttribute('src', '/images/china-orient-logo-horizontal.png');
    await desktop.page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
    await expect(desktop.page.locator('.studio-brand-symbol-orient')).toBeVisible();
    await expect(desktop.page.locator('.studio-brand-symbol-orient')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(desktop.page.locator('.studio-brand-logo-orient')).toBeHidden();
    await desktop.page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
    for (const [name, id] of [['商务蓝', 'indigo'], ['活力橙', 'orange'], ['胭脂红', 'rose'], ['极光紫', 'purple']]) {
      const themeWrite = desktop.page.waitForResponse(response => response.url().endsWith('/api/preferences') && response.request().method() === 'PUT' && response.ok());
      await desktop.page.getByTitle(name, { exact: true }).click();
      await themeWrite;
      await expect(desktop.page.locator('.studio-app')).toHaveAttribute('data-theme', id);
      await expect(desktop.page.getByRole('img', { name: '中国东方', exact: true })).toBeVisible();
      await expect(desktop.page.locator('.studio-brand-orient')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(desktop.page.locator('.studio-brand-copy')).toBeHidden();
    }
    await desktop.context.close();

    const mobile = await openWorkspace(browser, '李员工', { width: 375, height: 812 });
    await mobile.page.getByRole('button', { name: '更多', exact: true }).click();
    const sheet = mobile.page.getByRole('dialog', { name: '更多功能', exact: true });
    await expect(sheet).toBeVisible();
    const mobileWrite = mobile.page.waitForResponse(response => response.url().endsWith('/api/preferences') && response.request().method() === 'PUT' && response.ok());
    await sheet.getByRole('button', { name: '东方蓝', exact: true }).click();
    await mobileWrite;
    await expect(sheet.getByRole('button', { name: '东方蓝', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('button', { name: '关闭更多功能', exact: true }).last().click();
    await expect(mobile.page.locator('.studio-app')).toHaveAttribute('data-theme', 'coamc');
    await mobile.page.reload();
    await expect(mobile.page.locator('.studio-app')).toHaveAttribute('data-theme', 'coamc');
    const mobileNav = mobile.page.getByRole('navigation', { name: '移动端主导航', exact: true });
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole('button', { name: '看板', exact: true })).toHaveCSS('background-color', 'rgb(0, 66, 127)');
    expect(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await mobileNav.getByRole('button', { name: '资源', exact: true }).click();
    await expect(mobile.page.locator('.studio-page-title')).toHaveText('空间资源库');
    await mobile.context.close();
  });

  test('东方蓝同步总部3D与空间导航并保留经典主题和移动交互', async ({ browser }) => {
    const desktop = await openWorkspace(browser, '李员工');
    if (await desktop.page.locator('.studio-app').getAttribute('data-sidebar') === 'collapsed') {
      await desktop.page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
    }
    if (await desktop.page.locator('.studio-app').getAttribute('data-theme') !== 'coamc') {
      const preferenceWrite = desktop.page.waitForResponse(response => response.url().endsWith('/api/preferences') && response.request().method() === 'PUT' && response.ok());
      await desktop.page.getByTitle('东方蓝', { exact: true }).click();
      await preferenceWrite;
    }
    await desktop.page.getByRole('button', { name: '总部楼层 3D', exact: true }).click();
    const hqFrameElement = desktop.page.locator('iframe[title="总部楼层 3D 分布图"]');
    await expect(hqFrameElement).toHaveAttribute('src', '/hq3d.html?theme=coamc');
    const hq = desktop.page.frameLocator('iframe[title="总部楼层 3D 分布图"]');
    await expect(hq.locator('html')).toHaveAttribute('data-theme', 'coamc');
    await expect(hq.getByRole('img', { name: '中国东方', exact: true })).toBeVisible();
    await expect(hq.locator('.seg button.on').first()).toHaveCSS('background-color', 'rgb(0, 66, 127)');
    await hq.locator('.fitem').filter({ hasText: /^2F/ }).click();
    await hq.locator('#paneTabs [data-pane="rooms"]').click();
    await hq.locator('#roomList .rm').filter({ hasText: '礼堂' }).click();
    await expect(hq.locator('#dName')).toHaveText('礼堂');

    await desktop.page.getByRole('button', { name: '空间资源库', exact: true }).click();
    const spatialFrameElement = desktop.page.locator('.building-cutaway');
    await expect(spatialFrameElement).toHaveAttribute('src', '/hq3d.html?embed=spatial&theme=coamc');
    const spatial = desktop.page.frameLocator('.building-cutaway');
    await expect(spatial.locator('html')).toHaveAttribute('data-theme', 'coamc');
    await expect(spatial.locator('html')).toHaveClass(/spatial-embed/);

    const classicWrite = desktop.page.waitForResponse(response => response.url().endsWith('/api/preferences') && response.request().method() === 'PUT' && response.ok());
    await desktop.page.getByTitle('翡翠绿', { exact: true }).click();
    await classicWrite;
    await expect(spatialFrameElement).toHaveAttribute('src', '/hq3d.html?embed=spatial&theme=classic');
    await expect(spatial.locator('html')).not.toHaveAttribute('data-theme', 'coamc');
    await desktop.page.getByRole('button', { name: '总部楼层 3D', exact: true }).click();
    await expect(hqFrameElement).toHaveAttribute('src', '/hq3d.html?theme=classic');
    await expect(hq.getByRole('img', { name: '中国东方', exact: true })).toBeVisible();
    await expect(hq.locator('.brand .logo')).toBeHidden();
    await desktop.page.getByRole('button', { name: '空间资源库', exact: true }).click();
    const orientWrite = desktop.page.waitForResponse(response => response.url().endsWith('/api/preferences') && response.request().method() === 'PUT' && response.ok());
    await desktop.page.getByTitle('东方蓝', { exact: true }).click();
    await orientWrite;
    await expect(spatial.locator('html')).toHaveAttribute('data-theme', 'coamc');
    await desktop.context.close();

    const mobile = await openWorkspace(browser, '李员工', { width: 375, height: 812 });
    const mobileNav = mobile.page.getByRole('navigation', { name: '移动端主导航', exact: true });
    await mobileNav.getByRole('button', { name: '更多', exact: true }).click();
    await mobile.page.getByRole('dialog', { name: '更多功能', exact: true })
      .getByRole('button', { name: '总部楼层 3D', exact: true }).click();
    const mobileHq = mobile.page.frameLocator('iframe[title="总部楼层 3D 分布图"]');
    await expect(mobileHq.locator('html')).toHaveAttribute('data-theme', 'coamc');
    await expect(mobileHq.getByRole('img', { name: '中国东方', exact: true })).toBeVisible();
    expect(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await mobileHq.locator('html').evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await mobileHq.locator('html').evaluate(() => innerWidth)).toBe(375);
    const mobileFrameBox = await mobile.page.locator('iframe[title="总部楼层 3D 分布图"]').boundingBox();
    expect(mobileFrameBox?.x).toBeGreaterThanOrEqual(0);
    expect((mobileFrameBox?.x ?? 0) + (mobileFrameBox?.width ?? 0)).toBeLessThanOrEqual(375);
    await mobile.context.close();
  });

  test('智问助手总部3D查询卡片定位真实楼栋楼层和房间', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '李员工');
    const snapshotResponse = await page.request.get(`${server.baseUrl}/api/hq3d/snapshot`);
    expect(snapshotResponse.status()).toBe(200);
    const snapshot = await snapshotResponse.json();
    const building = snapshot.buildings.find((item: any) => item.id === 'main') || snapshot.buildings[0];
    const floor = building.floors.find((item: any) => item.floorNo === 2) || building.floors[0];
    const room = floor.rooms.find((item: any) => item.label === '礼堂') || floor.rooms[0];
    const summary = `定位${building.name} ${floor.tag} ${room.label}`;
    await page.route('**/api/agent/chat', route => route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({
        type: 'done', reply: `已找到${room.label}，可打开总部3D查看。`,
        actions: [{ type: 'NAVIGATE', view: 'HQ_3D', summary, hq3d: { buildingId: building.id, floorNo: floor.floorNo, roomUid: room.uid } }],
        trace: [{ tool: 'query_hq3d_spaces', ok: true, ms: 1 }]
      })}\n\n`
    }));

    await page.getByRole('button', { name: '打开智能助手', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '对话式办公助手' });
    await dialog.getByRole('textbox', { name: '输入办公需求' }).fill(`${building.name}${floor.tag}${room.label}在哪里？`);
    await dialog.getByRole('button', { name: '发送', exact: true }).click();
    await expect(dialog.getByText(summary, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '前往查看', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const frameElement = page.locator('iframe[title="总部楼层 3D 分布图"]');
    await expect(frameElement).toHaveAttribute('src', /navigationId=\d+/);
    const src = await frameElement.getAttribute('src');
    const target = new URL(src!, server.baseUrl).searchParams;
    expect(target.get('buildingId')).toBe(building.id);
    expect(target.get('floorNo')).toBe(String(floor.floorNo));
    expect(target.get('roomUid')).toBe(room.uid);
    const hq = page.frameLocator('iframe[title="总部楼层 3D 分布图"]');
    await expect(hq.locator('#dName')).toHaveText(room.label);
    await expect(hq.locator('.fitem.on')).toContainText(floor.tag);
    await context.close();
  });

  test('真实预约表单完成两级审批，并由服务端持久化预约与工单', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '李员工');
    const purpose = `浏览器验收预约 ${Date.now()}`;
    await page.getByRole('button', { name: '空间资源库', exact: true }).click();
    const row = page.locator('tr').filter({ hasText: 'Alpha 战略会议室' });
    await row.getByRole('button', { name: '预约', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '预约Alpha 战略会议室' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: '申请用途' }).fill(purpose);
    await dialog.getByLabel('参与人数', { exact: true }).fill('4');
    await dialog.getByLabel('会议类型', { exact: true }).selectOption('NORMAL');
    await dialog.getByLabel('涉密确认', { exact: true }).selectOption('NON_CONFIDENTIAL');
    const date = new Date(Date.now() + 7 * 86400000);
    const dateValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    await dialog.getByLabel('自定义预约日期').fill(dateValue);
    await dialog.getByLabel('预约开始时间').selectOption('10:00');
    await dialog.getByLabel('预约结束时间').selectOption('11:00');
    await dialog.getByRole('button', { name: '视频会议', exact: true }).click();
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/bookings') && response.status() === 201),
      dialog.getByRole('button', { name: '确认预约', exact: true }).click()
    ]);
    await page.getByRole('button', { name: '我的申请', exact: true }).click();
    await expect(page.getByText(purpose, { exact: true })).toBeVisible();
    await page.getByText(purpose, { exact: true }).click();
    await expect(page.getByRole('button', { name: '下载 ICS 日历', exact: true })).toHaveCount(0);
    await context.close();

    await approvePurpose(browser, '审批负责人', purpose);
    await approvePurpose(browser, '超级管理员', purpose);
    const rows = await queryTestDb<any[]>('SELECT status, payload FROM bookings WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, \'$.purpose\')) = ?', [purpose]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('APPROVED');
    expect(rows[0].payload.userId).toBe('3');
    expect(rows[0].payload.currentNodeIndex).toBe(1);
    const workOrderState = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'workOrders'");
    const workOrders = typeof workOrderState[0].payload === 'string' ? JSON.parse(workOrderState[0].payload) : workOrderState[0].payload;
    expect(workOrders.some((order: any) => order.bookingId === rows[0].payload.id && order.type === 'VIDEO')).toBe(true);

    const owner = await openWorkspace(browser, '李员工');
    await owner.page.getByRole('button', { name: '我的申请', exact: true }).click();
    await expect(owner.page.getByText(purpose, { exact: true })).toBeVisible();
    await expect(owner.page.locator('.status-upcoming')).toHaveText('待开始');
    await owner.page.getByText(purpose, { exact: true }).click();
    const icsDownload = owner.page.waitForEvent('download');
    await owner.page.getByRole('button', { name: '下载 ICS 日历', exact: true }).click();
    const icsFile = await icsDownload;
    const icsPath = await icsFile.path();
    expect(icsPath).not.toBeNull();
    const ics = await readFile(icsPath!, 'utf8');
    expect(ics).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0');
    expect(ics).toContain(`SUMMARY:${purpose}\r\n`);
    expect(ics).toContain('STATUS:CONFIRMED\r\n');
    expect(ics).toContain('DTSTART:');
    expect(ics).toContain('DTEND:');
    await owner.context.close();
  });

  test('ChatDock 对话与草案跨刷新、会话和 Node 重启恢复，仍须人工打开表单确认', async ({ browser }) => {
    const apiUser = await server.login('3');
    const snapshotResponse = await server.request('/api/workspace', { headers: { Cookie: apiUser.cookie } });
    const snapshot = await snapshotResponse.json();
    const resource = snapshot.resources.find((item: any) => item.name === 'Alpha 战略会议室');
    const purpose = `恢复草案 ${Date.now()}`;
    const start = new Date(Date.now() + 9 * 86400000);
    start.setHours(14, 0, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    const seed = await server.request('/api/agent/conversation', {
      method: 'PUT',
      headers: { Cookie: apiUser.cookie },
      body: JSON.stringify({
        revision: 0,
        state: {
          turns: [
            { role: 'user', content: '请保留这份会议草案' },
            { role: 'assistant', content: '已生成草案，请核对。', actions: [{
              type: 'PROPOSE_BOOKING',
              draft: {
                resourceId: resource.id,
                startTime: start.toISOString(),
                endTime: end.toISOString(),
                purpose,
                participants: 6,
                requiredFeatures: ['VIDEO'],
                isVideoConference: true
              }
            }] }
          ],
          handled: {},
          input: '未发送的输入草稿'
        }
      })
    });
    expect(seed.status).toBe(200);

    const { context, page } = await openWorkspace(browser, '李员工');
    await page.getByRole('button', { name: '打开智能助手', exact: true }).click();
    let draft = page.getByRole('region', { name: '待确认申请草案' });
    await expect(draft).toBeVisible();
    await expect(draft.getByText(purpose, { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('描述你的需求，Enter 发送')).toHaveValue('未发送的输入草稿');
    await page.reload();
    await expect(page.locator('.studio-app')).toBeVisible();
    await page.getByRole('button', { name: '打开智能助手', exact: true }).click();
    await expect(page.getByRole('region', { name: '待确认申请草案' }).getByText(purpose, { exact: true })).toBeVisible();
    await context.close();

    await server.stop();
    await server.start();
    const fresh = await openWorkspace(browser, '李员工');
    await fresh.page.getByRole('button', { name: '打开智能助手', exact: true }).click();
    draft = fresh.page.getByRole('region', { name: '待确认申请草案' });
    await expect(draft.getByText(purpose, { exact: true })).toBeVisible();
    await draft.getByRole('button', { name: '修订申请', exact: true }).click();
    const revisedPurpose = `${purpose} · 已修订`;
    await draft.getByLabel('申请用途').fill(revisedPurpose);
    await Promise.all([
      fresh.page.waitForResponse(response => response.url().endsWith('/api/agent/conversation') && response.request().method() === 'PUT' && response.ok()),
      draft.getByRole('button', { name: '保存修订', exact: true }).click()
    ]);
    await expect(draft.getByText(revisedPurpose, { exact: true })).toBeVisible();
    await Promise.all([
      fresh.page.waitForResponse(response => response.url().endsWith('/api/agent/conversation') && response.request().method() === 'PUT' && response.ok()),
      draft.getByRole('button', { name: '放弃此次草案', exact: true }).click()
    ]);
    await expect(fresh.page.getByText('申请草案已放弃，未提交任何数据。', { exact: true })).toBeVisible();
    await fresh.page.reload();
    await expect(fresh.page.locator('.studio-app')).toBeVisible();
    await fresh.page.getByRole('button', { name: '打开智能助手', exact: true }).click();
    await expect(fresh.page.getByText('申请草案已放弃，未提交任何数据。', { exact: true })).toBeVisible();
    await Promise.all([
      fresh.page.waitForResponse(response => response.url().endsWith('/api/agent/conversation') && response.request().method() === 'PUT' && response.ok()),
      fresh.page.getByRole('button', { name: '恢复草案', exact: true }).click()
    ]);
    draft = fresh.page.getByRole('region', { name: '待确认申请草案' });
    const openedStateSave = fresh.page.waitForResponse(response => response.url().endsWith('/api/agent/conversation') && response.request().method() === 'PUT' && response.ok());
    await draft.getByRole('button', { name: '确认信息，打开申请表', exact: true }).click();
    await openedStateSave;
    const bookingForm = fresh.page.getByRole('dialog', { name: '预约Alpha 战略会议室' });
    await expect(bookingForm).toBeVisible();
    await expect(bookingForm.getByRole('textbox', { name: '申请用途' })).toHaveValue(revisedPurpose);
    const rows = await queryTestDb<any[]>("SELECT id FROM bookings WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.purpose')) = ?", [revisedPurpose]);
    expect(rows).toHaveLength(0);
    await fresh.context.close();
  });

  test('ChatDock 保护中文组词、约束焦点与移动触控，并通过对话框 axe 检查', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '李员工', { width: 375, height: 812 });
    let chatRequests = 0;
    await page.route('**/api/agent/chat', async route => {
      chatRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"type":"done","reply":"已收到需求。","actions":[],"trace":[]}\n\n'
      });
    });
    const trigger = page.getByRole('button', { name: '打开智能助手', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '对话式办公助手' });
    const input = dialog.getByRole('textbox', { name: '输入办公需求' });
    const send = dialog.getByRole('button', { name: '发送', exact: true });
    const close = dialog.getByRole('button', { name: '关闭', exact: true });
    await expect(input).toBeFocused();
    await input.fill('项目组评审');
    for (const control of [send, close]) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    const firstControl = dialog.getByRole('button').first();
    await send.focus();
    await page.keyboard.press('Tab');
    await expect(firstControl).toBeFocused();
    await input.focus();
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: true });
    await page.waitForTimeout(100);
    expect(chatRequests).toBe(0);
    const sent = page.waitForRequest(request => request.url().endsWith('/api/agent/chat') && request.method() === 'POST');
    await input.press('Enter');
    await sent;
    expect(chatRequests).toBe(1);
    await expect(dialog.getByText('已收到需求。', { exact: true })).toBeVisible();
    const accessibility = await new AxeBuilder({ page }).include('.chat-shell').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await context.close();
  });

  test('帮助抽屉按角色检索、联动智能帮助并恢复触发按钮焦点', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '李员工');
    await page.route('**/api/agent/chat', route => route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"type":"done","reply":"请在我的申请中展开预约并选择修改。","actions":[],"trace":[]}\n\n'
    }));
    const trigger = page.locator('.studio-topbar').getByRole('button', { name: '打开帮助', exact: true });
    await expect(trigger).toBeVisible();
    await expect(page.getByRole('button', { name: '打开帮助', exact: true })).toHaveCount(1);
    await trigger.click();
    let drawer = page.getByRole('dialog', { name: '帮助与智能指导' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByPlaceholder('搜索预约、审批、报表、设备…')).toBeFocused();
    await drawer.getByPlaceholder('搜索预约、审批、报表、设备…').fill('组织同步');
    await expect(drawer.getByText('没有找到匹配指南', { exact: true })).toBeVisible();
    await drawer.getByPlaceholder('搜索预约、审批、报表、设备…').fill('修改预约');
    await expect(drawer.getByRole('heading', { name: '修改、取消与提前结束预约', exact: true })).toBeVisible();
    await drawer.getByRole('button', { name: '针对此指南提问', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '对话式办公助手' })).toBeVisible();
    await expect(page.getByText('请在我的申请中展开预约并选择修改。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await trigger.click();
    drawer = page.getByRole('dialog', { name: '帮助与智能指导' });
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await context.close();

    const admin = await openWorkspace(browser, '超级管理员');
    await admin.page.getByRole('button', { name: '打开帮助', exact: true }).click();
    const adminDrawer = admin.page.getByRole('dialog', { name: '帮助与智能指导' });
    await adminDrawer.getByPlaceholder('搜索预约、审批、报表、设备…').fill('所属公司');
    await expect(adminDrawer.getByRole('heading', { name: '维护、加锁与删除空间资源', exact: true })).toBeVisible();
    await expect(adminDrawer).toContainText('资源“所属公司”与流程配置的“资源公司范围”使用同一台账值');
    await adminDrawer.getByPlaceholder('搜索预约、审批、报表、设备…').fill('资源公司范围');
    await adminDrawer.getByRole('button', { name: /动态审批规则与流程版本/ }).click();
    await expect(adminDrawer.getByRole('heading', { name: '动态审批规则与流程版本', exact: true })).toBeVisible();
    await expect(adminDrawer).toContainText('新申请冻结提交时的资源公司，在途申请不因后续资源或流程修改而改变历史范围');
    await expect(adminDrawer).toContainText('保存到草稿');
    await expect(adminDrawer).toContainText('发布新版本');
    await expect(adminDrawer).toContainText('在途申请继续使用提交时冻结的规则与流程');
    await adminDrawer.getByPlaceholder('搜索预约、审批、报表、设备…').fill('楼层图导入');
    await expect(adminDrawer.getByRole('heading', { name: '整栋与单层楼层图导入', exact: true })).toBeVisible();
    await expect(adminDrawer).toContainText('未被图片识别的现有房间会自动保留');
    await expect(adminDrawer).toContainText('识别文字变化会进入预检');
    await expect(adminDrawer).toContainText('已绑定资源的房间不能通过精确文件省略停用');
    await adminDrawer.getByPlaceholder('搜索预约、审批、报表、设备…').fill('原生楼层图Excel');
    await expect(adminDrawer.getByRole('heading', { name: '整栋与单层楼层图导入', exact: true })).toBeVisible();
    await expect(adminDrawer).toContainText('二层存在“全/部分”时优先“全”');
    await expect(adminDrawer).toContainText('十四层存在“新/旧”时优先“新”');
    await adminDrawer.getByPlaceholder('搜索预约、审批、报表、设备…').fill('图片OCR');
    await expect(adminDrawer.getByRole('heading', { name: '整栋与单层楼层图导入', exact: true })).toBeVisible();
    await adminDrawer.getByPlaceholder('搜索预约、审批、报表、设备…').fill('运营报表');
    await expect(adminDrawer.getByRole('heading', { name: '运营管理看板与明细对账', exact: true })).toBeVisible();
    await adminDrawer.getByRole('button', { name: '打开功能', exact: true }).click();
    await expect(admin.page.getByRole('heading', { name: '运营报表', exact: true })).toBeVisible();
    await admin.context.close();
  });

  test('修改预约动作跨刷新保留会务快照并只打开正式表单', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '李员工');
    const purpose = `助手修改预约 ${Date.now()}`;
    await page.getByRole('button', { name: '空间资源库', exact: true }).click();
    const row = page.locator('tr').filter({ hasText: 'Alpha 战略会议室' });
    await row.getByRole('button', { name: '预约', exact: true }).click();
    const createDialog = page.getByRole('dialog', { name: '预约Alpha 战略会议室' });
    await createDialog.getByRole('textbox', { name: '申请用途' }).fill(purpose);
    await createDialog.getByLabel('参与人数', { exact: true }).fill('4');
    await createDialog.getByLabel('会议类型', { exact: true }).selectOption('NORMAL');
    await createDialog.getByLabel('涉密确认', { exact: true }).selectOption('NON_CONFIDENTIAL');
    const start = new Date(Date.now() + 10 * 86400000);
    const dateValue = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    await createDialog.getByLabel('自定义预约日期').fill(dateValue);
    await createDialog.getByLabel('预约开始时间').selectOption('10:00');
    await createDialog.getByLabel('预约结束时间').selectOption('11:00');
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/bookings') && response.status() === 201),
      createDialog.getByRole('button', { name: '确认预约', exact: true }).click()
    ]);
    const bookingRows = await queryTestDb<any[]>("SELECT id, payload FROM bookings WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.purpose')) = ?", [purpose]);
    const booking = bookingRows[0].payload;
    const apiUser = await server.login('3');
    const currentResponse = await server.request('/api/agent/conversation', { headers: { Cookie: apiUser.cookie } });
    const current = await currentResponse.json();
    const revisedPurpose = `${purpose} · 已调整`;
    const seed = await server.request('/api/agent/conversation', {
      method: 'PUT',
      headers: { Cookie: apiUser.cookie },
      body: JSON.stringify({
        revision: current.revision,
        state: {
          turns: [{ role: 'assistant', content: '已生成修改草案。', actions: [{
            type: 'PROPOSE_EDIT_BOOKING', bookingId: booking.id, summary: `修改「${purpose}」`,
            draft: {
              resourceId: booking.resourceId, type: 'ROOM', startTime: booking.startTime, endTime: booking.endTime,
              purpose: revisedPurpose, participants: 6, meetingType: 'NORMAL',
              serviceRequirements: [{ type: 'VEHICLE', fieldValues: { quantity: '2' }, catalogSnapshot: {
                catalogItemId: 'service-vehicle', catalogVersion: 3, name: '历史车辆保障', responsibleRole: 'SERVICE_COORDINATOR',
                slaResponseMinutes: 15, heavyService: true, cancellable: true,
                fields: [{ key: 'quantity', label: '车辆数', type: 'NUMBER', required: true }]
              } }]
            }
          }] }],
          handled: {}, input: ''
        }
      })
    });
    expect(seed.status).toBe(200);
    const persistedResponse = await server.request('/api/agent/conversation', { headers: { Cookie: apiUser.cookie } });
    const persisted = await persistedResponse.json();
    expect(persisted.state.turns[0].actions[0].draft.serviceRequirements[0].catalogSnapshot.catalogVersion).toBe(3);

    await page.reload();
    await page.getByRole('button', { name: '打开智能助手', exact: true }).click();
    await page.getByRole('button', { name: '核对并修改', exact: true }).click();
    const editDialog = page.getByRole('dialog', { name: '修改预约Alpha 战略会议室' });
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByRole('textbox', { name: '申请用途' })).toHaveValue(revisedPurpose);
    await expect(editDialog.getByLabel('参与人数', { exact: true })).toHaveValue('6');
    const unchanged = await queryTestDb<any[]>('SELECT payload FROM bookings WHERE id = ?', [booking.id]);
    expect(unchanged[0].payload.purpose).toBe(purpose);
    await context.close();
  });

  test('移动端主导航、顶部帮助、更多菜单和智能助手均保持可用', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '超级管理员', { width: 375, height: 812 });
    const navigation = page.getByRole('navigation', { name: '移动端主导航' });
    await expect(navigation).toBeVisible();
    await navigation.getByRole('button', { name: '资源', exact: true }).click();
    await expect(page.getByRole('heading', { name: '空间资源库', exact: true })).toBeVisible();
    await expect(page.locator('.building-room').first().getByRole('button', { name: /^编辑.+基本信息$/ })).toBeVisible();
    await navigation.getByRole('button', { name: '更多', exact: true }).click();
    const moreSheet = page.getByRole('dialog', { name: '更多功能', exact: true });
    await expect(moreSheet).toBeVisible();
    await moreSheet.getByRole('button', { name: '数据中心', exact: true }).click();
    await expect(page.getByRole('heading', { name: '数据维护中心', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '打开智能助手', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '对话式办公助手' })).toBeVisible();
    await expect(navigation).toBeVisible();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(navigation).toBeVisible();
    const helpTrigger = page.locator('.studio-topbar').getByRole('button', { name: '打开帮助', exact: true });
    await expect(helpTrigger).toBeVisible();
    const helpBounds = await helpTrigger.boundingBox();
    expect(helpBounds).not.toBeNull();
    expect(helpBounds!.x).toBeGreaterThanOrEqual(0);
    expect(helpBounds!.x + helpBounds!.width).toBeLessThanOrEqual(375);
    await helpTrigger.click();
    await expect(page.getByRole('dialog', { name: '帮助与智能指导' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(helpTrigger).toBeFocused();
    await context.close();
  });

  test('管理员在ROOM INDEX维护并删除会议室，普通员工无管理入口且结果跨刷新持久化', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '超级管理员');
    const suffix = Date.now();
    const code = `E2E-DELETE-${suffix}`;
    const resourceId = `r-e2e-delete-${suffix}`;
    const name = `浏览器待删除资源 ${suffix}`;

    await page.getByRole('button', { name: '空间资源库', exact: true }).click();
    await page.getByRole('button', { name: '新增资源', exact: true }).click();
    await page.getByLabel('资源永久编码', { exact: true }).fill(code);
    await page.getByLabel('资源名称', { exact: true }).fill(name);
    await page.getByLabel('资源楼层', { exact: true }).selectOption('10');
    await page.getByLabel('资源房间号', { exact: true }).fill(`D${String(suffix).slice(-4)}`);
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/resources') && response.request().method() === 'POST' && response.status() === 201),
      page.getByRole('button', { name: '保存', exact: true }).click()
    ]);
    const resourceRow = page.locator('tr').filter({ hasText: name });
    await expect(resourceRow).toBeVisible();
    let roomCard = page.locator('.building-room').filter({ hasText: name });
    await expect(roomCard).toBeVisible();
    await expect(roomCard.getByRole('button', { name: `编辑${name}基本信息`, exact: true })).toBeDisabled();
    await roomCard.getByRole('button', { name: `解锁${name}管理操作`, exact: true }).click();
    await roomCard.getByRole('button', { name: `编辑${name}基本信息`, exact: true }).click();
    const editDialog = page.getByRole('dialog', { name: '编辑会议室', exact: true });
    await expect(editDialog).toBeVisible();
    await editDialog.getByLabel('资源容量', { exact: true }).fill('9');
    await editDialog.getByLabel('资源备注', { exact: true }).fill('ROOM INDEX 基本信息维护验收');
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith(`/api/resources/${resourceId}`) && response.request().method() === 'PUT' && response.ok()),
      editDialog.getByRole('button', { name: '保存', exact: true }).click()
    ]);
    await expect(roomCard).toContainText('9 人');

    await page.reload();
    await expect(page.locator('.studio-app')).toBeVisible();
    await page.getByRole('button', { name: '空间资源库', exact: true }).click();
    await page.getByLabel('快速选择1号楼楼层', { exact: true }).selectOption('10');
    roomCard = page.locator('.building-room').filter({ hasText: name });
    await expect(roomCard).toContainText('9 人');
    await expect(roomCard.getByRole('button', { name: `删除${name}`, exact: true })).toBeDisabled();
    await roomCard.getByRole('button', { name: `解锁${name}管理操作`, exact: true }).click();

    const employee = await openWorkspace(browser, '李员工');
    await employee.page.getByRole('button', { name: '空间资源库', exact: true }).click();
    await employee.page.getByLabel('快速选择1号楼楼层', { exact: true }).selectOption('10');
    const employeeRoomCard = employee.page.locator('.building-room').filter({ hasText: name });
    await expect(employeeRoomCard).toBeVisible();
    await expect(employeeRoomCard.getByRole('button', { name: `编辑${name}基本信息`, exact: true })).toHaveCount(0);
    await expect(employeeRoomCard.getByRole('button', { name: `删除${name}`, exact: true })).toHaveCount(0);
    await employee.context.close();

    page.once('dialog', dialog => dialog.accept());
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith(`/api/resources/${resourceId}`) && response.request().method() === 'DELETE' && response.ok()),
      roomCard.getByRole('button', { name: `删除${name}`, exact: true }).click()
    ]);
    await expect(page.getByText('删除成功', { exact: true })).toBeVisible();
    await expect(roomCard).toHaveCount(0);
    await expect(resourceRow).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.studio-app')).toBeVisible();
    await page.getByRole('button', { name: '空间资源库', exact: true }).click();
    await expect(page.locator('tr').filter({ hasText: name })).toHaveCount(0);

    const resourceState = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'resources'");
    const resources = typeof resourceState[0].payload === 'string' ? JSON.parse(resourceState[0].payload) : resourceState[0].payload;
    expect(resources.some((resource: any) => resource.id === resourceId)).toBe(false);
    const audits = await queryTestDb<any[]>('SELECT actor_id FROM audit_events WHERE action = ? AND entity_id = ?', ['RESOURCE_DELETE', resourceId]);
    expect(audits).toHaveLength(1);
    await context.close();
  });

  test('管理员在桌面和移动端维护动态规则草稿并发布不可变新版本', async ({ browser }) => {
    const beforeRows = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'approvalRuleSetVersions'");
    const beforeVersions = typeof beforeRows[0].payload === 'string' ? JSON.parse(beforeRows[0].payload) : beforeRows[0].payload;
    const current = beforeVersions.sort((a: any, b: any) => b.version - a.version)[0];
    const { context, page } = await openWorkspace(browser, '超级管理员');
    await page.getByRole('button', { name: '系统管理', exact: true }).click();
    await page.getByRole('button', { name: '流程配置', exact: true }).click();
    await expect(page.getByRole('heading', { name: `动态规则集 V${current.version}`, exact: true })).toBeVisible();

    await page.getByRole('button', { name: '新增规则', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '新增动态规则', exact: true });
    await dialog.getByLabel('规则名称', { exact: true }).fill('浏览器普通重服务规则');
    await dialog.getByLabel('规则会议类型重要会议', { exact: true }).uncheck();
    await dialog.getByLabel('规则会议类型普通会议', { exact: true }).check();
    await dialog.getByLabel('规则重服务条件', { exact: true }).selectOption('YES');
    await dialog.getByRole('button', { name: '保存到草稿', exact: true }).click();
    await expect(page.getByText('有未发布修改', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '编辑规则浏览器普通重服务规则', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '编辑动态规则', exact: true });
    await dialog.getByLabel('规则名称', { exact: true }).fill('浏览器普通重服务规则已编辑');
    await dialog.getByRole('button', { name: '保存到草稿', exact: true }).click();
    await expect(page.getByText('浏览器普通重服务规则已编辑', { exact: true })).toBeVisible();

    page.once('dialog', prompt => prompt.accept());
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/approval-rule-set') && response.request().method() === 'PUT' && response.ok()),
      page.getByRole('button', { name: '发布新版本', exact: true }).click()
    ]);
    await expect(page.getByRole('heading', { name: `动态规则集 V${current.version + 1}`, exact: true })).toBeVisible();
    await expect(page.getByText('浏览器普通重服务规则已编辑', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '删除规则浏览器普通重服务规则已编辑', exact: true }).click();
    page.once('dialog', prompt => prompt.accept());
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/approval-rule-set') && response.request().method() === 'PUT' && response.ok()),
      page.getByRole('button', { name: '发布新版本', exact: true }).click()
    ]);
    await expect(page.getByRole('heading', { name: `动态规则集 V${current.version + 2}`, exact: true })).toBeVisible();
    await expect(page.getByText('浏览器普通重服务规则已编辑', { exact: true })).toHaveCount(0);
    const afterRows = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'approvalRuleSetVersions'");
    const afterVersions = typeof afterRows[0].payload === 'string' ? JSON.parse(afterRows[0].payload) : afterRows[0].payload;
    expect(afterVersions).toHaveLength(beforeVersions.length + 2);
    expect(afterVersions.find((version: any) => version.version === current.version)).toEqual(current);
    expect(afterVersions.find((version: any) => version.version === current.version + 1).rules.some((rule: any) => rule.name === '浏览器普通重服务规则已编辑')).toBe(true);
    const audits = await queryTestDb<any[]>('SELECT actor_id FROM audit_events WHERE action = ? AND entity_id IN (?, ?)', ['APPROVAL_RULE_SET_PUBLISH', String(current.version + 1), String(current.version + 2)]);
    expect(audits).toHaveLength(2);
    expect(audits.every((audit: any) => audit.actor_id === '1')).toBe(true);
    await context.close();

    const mobile = await openWorkspace(browser, '超级管理员', { width: 375, height: 812 });
    await mobile.page.getByRole('button', { name: '更多', exact: true }).click();
    await mobile.page.getByRole('dialog', { name: '更多功能', exact: true }).getByRole('button', { name: '流程配置', exact: true }).click();
    await mobile.page.getByRole('button', { name: '编辑规则重要会议强化审批', exact: true }).click();
    const mobileDialog = mobile.page.getByRole('dialog', { name: '编辑动态规则', exact: true });
    await expect(mobileDialog).toBeVisible();
    await mobileDialog.getByLabel('规则名称', { exact: true }).fill('移动端草稿名称');
    await mobileDialog.getByRole('button', { name: '保存到草稿', exact: true }).click();
    await expect(mobile.page.getByText('有未发布修改', { exact: true })).toBeVisible();
    await mobile.page.getByRole('button', { name: '重置草稿', exact: true }).click();
    await expect(mobile.page.getByText('有未发布修改', { exact: true })).toHaveCount(0);
    await expect(mobile.page.getByRole('button', { name: '发布新版本', exact: true })).toBeDisabled();
    expect(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await mobile.context.close();
  });

  test('业务错误码在界面统一显示中文且接口契约保持不变', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '超级管理员');
    let apiError = '';
    await page.route('**/api/approval-delegates', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      apiError = 'REQUESTER_NOT_FOUND';
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: apiError, detail: apiError })
      });
    });

    await page.getByRole('button', { name: '系统管理', exact: true }).click();
    await page.getByRole('button', { name: '流程配置', exact: true }).click();
    await page.getByRole('button', { name: '新增代理', exact: true }).click();
    await page.getByRole('button', { name: '创建代理', exact: true }).click();

    await expect(page.getByRole('alert')).toHaveText('申请人信息不存在或已失效，请联系管理员核对成员档案后重试。');
    await expect(page.locator('body')).not.toContainText('REQUESTER_NOT_FOUND');
    expect(apiError).toBe('REQUESTER_NOT_FOUND');
    await context.close();
  });

  test('管理端维护资源公司、发布节点范围、创建代理并查询审计', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '超级管理员');
    const campus = `浏览器验收公司 ${Date.now()}`;

    await page.getByRole('button', { name: '空间资源库', exact: true }).click();
    const resourceRow = page.locator('tr').filter({ hasText: 'Alpha 战略会议室' });
    await expect(resourceRow.getByRole('button', { name: '编辑Alpha 战略会议室', exact: true })).toBeDisabled();
    await resourceRow.getByRole('button', { name: '解锁Alpha 战略会议室', exact: true }).click();
    await resourceRow.getByRole('button', { name: '编辑Alpha 战略会议室', exact: true }).click();
    await page.getByLabel('资源所属公司', { exact: true }).fill(campus);
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/resources/') && response.request().method() === 'PUT' && response.ok()),
      page.getByRole('button', { name: '保存', exact: true }).click()
    ]);
    await expect(resourceRow).toContainText(campus);

    await page.getByRole('button', { name: '批量导入', exact: true }).click();
    const templateDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载模板', exact: true }).click();
    const templatePath = await (await templateDownload).path();
    const template = await readFile(templatePath!, 'utf8');
    expect(template).toContain('公共资源(是/否),公司(可选),设备(竖线分隔)');
    expect(template).toContain(',总部公司,');
    expect(template).not.toContain('园区');

    const legacyCsv = `永久编码,资源名称,类型(会议室/工位),容量,楼栋(主楼/配楼),楼层,房间号,位置补充(可选),容量分类(自动/礼堂),开放开始(可选),开放结束(可选),专属(是/否),适用领导层级(可选),公共资源(是/否),园区(可选),设备(竖线分隔),状态(可选),备注(可选)\nR1,Alpha 战略会议室,会议室,10,主楼,10,,,自动,08:00,20:00,否,,是,${campus}·旧模板,投屏显示器|视频会议系统,空闲,`;
    await page.getByLabel('批量导入数据', { exact: true }).fill(legacyCsv);
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/resources/ledger/preflight') && response.request().method() === 'POST' && response.ok()),
      page.getByRole('button', { name: '生成预检报告', exact: true }).click()
    ]);
    const preflightReport = page.getByRole('region', { name: '资源台账预检报告', exact: true });
    await expect(preflightReport).toContainText('R1');
    await expect(preflightReport).toContainText('公司');
    await expect(preflightReport).toContainText('可导入 1 条变更。');
    await page.getByRole('button', { name: '取消', exact: true }).click();

    await page.getByRole('button', { name: '系统管理', exact: true }).click();
    await page.getByRole('button', { name: '流程配置', exact: true }).click();
    const nodeCard = page.locator('div.group').filter({ has: page.getByText('行政预审', { exact: true }) });
    await nodeCard.hover();
    await nodeCard.locator('button').nth(2).click();
    await page.getByLabel('市场部', { exact: true }).check();
    await page.getByLabel('审批资源公司范围', { exact: true }).fill(campus);
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/workflow') && response.request().method() === 'PUT' && response.ok()),
      page.getByRole('button', { name: '保存并发布新版本', exact: true }).click()
    ]);
    await expect(nodeCard).toContainText('部门：市场部');
    await expect(nodeCard).toContainText(`公司：${campus}`);

    await page.getByRole('button', { name: '新增代理', exact: true }).click();
    await page.getByLabel('代理审批委托人', { exact: true }).selectOption('2');
    await page.getByLabel('代理审批代理人', { exact: true }).selectOption('3');
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/approval-delegates') && response.request().method() === 'POST' && response.status() === 201),
      page.getByRole('button', { name: '创建代理', exact: true }).click()
    ]);
    const delegationSection = page.locator('section').filter({ has: page.getByRole('heading', { name: '代理审批', exact: true }) });
    await expect(delegationSection).toContainText('审批负责人');
    await expect(delegationSection).toContainText('李员工');
    await expect(delegationSection.getByText('生效中', { exact: true })).toBeVisible();

    const auditResponse = page.waitForResponse(response => response.url().includes('/api/audit?') && response.ok());
    await page.getByRole('button', { name: '数据中心', exact: true }).click();
    await auditResponse;
    await page.getByLabel('筛选审计记录', { exact: true }).fill('WORKFLOW_PUBLISH');
    const auditTable = page.locator('section').filter({ has: page.getByRole('heading', { name: '操作审计', exact: true }) });
    await expect(auditTable).toContainText('WORKFLOW_PUBLISH');
    const workflowVersionRows = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'workflowVersions'");
    const workflowVersions = typeof workflowVersionRows[0].payload === 'string' ? JSON.parse(workflowVersionRows[0].payload) : workflowVersionRows[0].payload;
    const latestWorkflowVersion = Math.max(...workflowVersions.map((item: any) => item.version));
    await expect(auditTable).toContainText(`WORKFLOW / ${latestWorkflowVersion}`);
    await page.getByLabel('筛选审计记录', { exact: true }).fill('DELEGATION_CREATE');
    await expect(auditTable).toContainText('DELEGATION_CREATE');
    await expect(auditTable).toContainText('超级管理员');

    await page.getByLabel('筛选审计记录', { exact: true }).fill('');
    await page.getByLabel('审计操作人', { exact: true }).selectOption('1');
    await page.getByLabel('审计动作', { exact: true }).fill('WORKFLOW_PUBLISH');
    await page.getByLabel('审计对象类型', { exact: true }).selectOption('WORKFLOW');
    await page.getByLabel('审计对象ID', { exact: true }).fill(String(latestWorkflowVersion));
    const today = new Date();
    const dateValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await page.getByLabel('审计开始日期', { exact: true }).fill(dateValue);
    await page.getByLabel('审计结束日期', { exact: true }).fill(dateValue);
    const combinedAuditResponse = page.waitForResponse(response => response.url().includes('/api/audit?') && response.ok());
    await page.getByRole('button', { name: '查询审计', exact: true }).click();
    const combinedAudit = await (await combinedAuditResponse).json();
    expect(combinedAudit.events).toHaveLength(1);
    expect(combinedAudit.events[0].details.before.nodes).toBeDefined();
    expect(combinedAudit.events[0].details.after.nodes).toBeDefined();
    await expect(auditTable.locator('tbody tr')).toHaveCount(1);
    await expect(auditTable).toContainText(`WORKFLOW / ${latestWorkflowVersion}`);

    await page.getByRole('button', { name: '运营报表', exact: true }).click();
    await expect(page.getByRole('heading', { name: '利用率与审批效率', exact: true })).toBeVisible();
    await page.getByLabel('报表时间范围', { exact: true }).selectOption('ALL');
    await page.getByRole('tab', { name: '明细与对账', exact: true }).click();
    await expect(page.getByRole('region', { name: '多维统计', exact: true }).locator('tbody')).toContainText('Alpha 战略会议室');
    const csvDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 CSV', exact: true }).click();
    const csvFile = await csvDownload;
    const csvPath = await csvFile.path();
    expect(csvPath).not.toBeNull();
    const csv = await readFile(csvPath!, 'utf8');
    expect(csv).toContain('"维度","名称","预约数","使用小时","使用率(%)"');
    expect(csv).toContain('"整体","全公司"');
    expect(csv).toContain('"资源","Alpha 战略会议室"');
    await context.close();
  });
});

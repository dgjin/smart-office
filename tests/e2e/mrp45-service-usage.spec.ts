import crypto from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Booking, WorkOrder } from '../../types.ts';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
type Session = Awaited<ReturnType<TestServer['login']>>;
const ids = { admin: '1', approver: '2', requester: '3', coordinator: 'u-mrp45-browser-coordinator' };
const names: Record<string, string> = {
  [ids.admin]: '超级管理员', [ids.approver]: '审批负责人', [ids.requester]: '李员工',
  [ids.coordinator]: 'MRP45浏览器会务员'
};
const sessions = new Map<string, Session>();

const session = (userId: string) => {
  const value = sessions.get(userId);
  if (!value) throw new Error(`缺少浏览器测试会话 ${userId}`);
  return value;
};
const api = (pathname: string, method: string, actorId: string, body?: unknown) => server.request(pathname, {
  method,
  headers: { Cookie: session(actorId).cookie },
  body: body === undefined ? undefined : JSON.stringify(body)
});
const readCollection = async <T>(key: string): Promise<T[]> => {
  const rows = await queryTestDb<any[]>('SELECT payload FROM office_state WHERE state_key = ?', [key]);
  expect(rows).toHaveLength(1);
  return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
};
const readBooking = async (id: string): Promise<Booking> => {
  const rows = await queryTestDb<any[]>('SELECT payload FROM bookings WHERE id = ?', [id]);
  expect(rows).toHaveLength(1);
  return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
};
const waitFor = async (check: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('等待浏览器验收任务超时');
};
const insertApprovedBooking = async (input: { id: string; start: Date; end: Date; purpose: string; tea?: boolean }) => {
  const payload: Booking = {
    id: input.id, userId: ids.requester, resourceId: 'r1', type: 'ROOM',
    startTime: input.start.toISOString(), endTime: input.end.toISOString(), status: 'APPROVED',
    purpose: input.purpose, participants: 4, createdAt: new Date().toISOString(), currentNodeIndex: 1,
    approvalHistory: [], attendeeIds: [], meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL',
    requesterDepartmentId: 'dpt3', scheduleVersion: 1,
    serviceRequirements: input.tea ? [{ type: 'TEA', fieldValues: { servings: '4' } }] : []
  };
  await queryTestDb(`INSERT INTO bookings (id, user_id, resource_id, start_time, end_time, status, payload, created_at, schedule_version)
    VALUES (?, ?, 'r1', ?, ?, 'APPROVED', ?, ?, 1)`, [
    input.id, ids.requester, input.start, input.end, JSON.stringify(payload), new Date(payload.createdAt)
  ]);
};
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
const openService = async (page: Page) => {
  await page.getByRole('button', { name: '服务工单', exact: true }).click();
  await expect(page.getByRole('heading', { name: '会务服务与使用释放' })).toBeVisible();
};
const openBookings = async (page: Page) => {
  const desktop = page.getByRole('button', { name: '我的申请', exact: true });
  if (await desktop.isVisible()) await desktop.click();
  else await page.getByRole('navigation', { name: '移动端主导航' }).getByRole('button', { name: '申请', exact: true }).click();
};
const transition = async (bookingId: string, actorId: string, action: string, body: Record<string, unknown> = {}) => {
  const response = await api(`/api/work-orders/wo-${bookingId}-v1-TEA/transitions`, 'POST', actorId, { action, ...body });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
};

test.describe('MRP4-5 真实 Chrome 会务与使用闭环', () => {
  test.skip(!integrationEnabled, '仅允许显式隔离 MySQL 测试环境');

  test.beforeAll(async () => {
    await resetTestDb();
    await server.start({ SMART_OFFICE_JOB_INTERVAL_MS: '50', SMART_OFFICE_JOB_LEASE_MS: '1000' });
    for (const id of [ids.admin, ids.approver, ids.requester]) sessions.set(id, await server.login(id));
    const created = await api('/api/users', 'POST', ids.admin, {
      user: {
        id: ids.coordinator, name: names[ids.coordinator], email: `${ids.coordinator}@company.com`,
        role: ['SERVICE_COORDINATOR'], department: '行政部', landline: '010-88889999', mobile: '13800000131'
      }
    });
    expect(created.status, JSON.stringify(await created.clone().json())).toBe(201);
    sessions.set(ids.coordinator, await server.login(ids.coordinator));
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('待定工单不能绕过补充，申请人填写后由会务执行并回写成本', async ({ browser }) => {
    const bookingId = `browser-service-${crypto.randomUUID()}`;
    await insertApprovedBooking({
      id: bookingId, start: new Date(Date.now() + 2 * 3600000), end: new Date(Date.now() + 3 * 3600000),
      purpose: 'Chrome 会务工单闭环', tea: true
    });
    await waitFor(async () => (await readCollection<WorkOrder>('workOrders')).some(order => order.id === `wo-${bookingId}-v1-TEA`));
    await transition(bookingId, ids.coordinator, 'REQUEST_INFO', { reason: '请确认人数与送达要求' });

    const coordinator = await openWorkspace(browser, ids.coordinator);
    await openService(coordinator.page);
    const coordinatorCard = coordinator.page.locator('article').filter({ hasText: '茶水服务' });
    await coordinatorCard.getByRole('button', { name: '处理工单', exact: true }).click();
    await expect(coordinatorCard.getByLabel(/状态操作/).locator('option')).toHaveText(['取消工单', '登记异常']);
    await expect(coordinatorCard.getByRole('button', { name: '补充待定信息', exact: true })).toBeVisible();
    await coordinator.context.close();

    const requester = await openWorkspace(browser, ids.requester);
    await openService(requester.page);
    const requesterCard = requester.page.locator('article').filter({ hasText: '茶水服务' });
    await requesterCard.getByRole('button', { name: '补充待定信息', exact: true }).click();
    await requesterCard.getByLabel(/茶水份数/).fill('6');
    await requesterCard.getByLabel(/茶水与送达要求/).fill('会前二十分钟送达');
    await Promise.all([
      requester.page.waitForResponse(response => response.url().includes('/transitions') && response.status() === 200),
      requesterCard.getByRole('button', { name: '提交补充信息', exact: true }).click()
    ]);
    await expect(requesterCard.getByText('待响应', { exact: true })).toBeVisible();
    await expect(requesterCard.getByText('会前二十分钟送达', { exact: true })).toBeVisible();
    await requester.context.close();

    const operator = await openWorkspace(browser, ids.coordinator);
    await openService(operator.page);
    const operatorCard = operator.page.locator('article').filter({ hasText: '茶水服务' });
    await operatorCard.getByRole('button', { name: '处理工单', exact: true }).click();
    await Promise.all([
      operator.page.waitForResponse(response => response.url().includes('/transitions') && response.status() === 200),
      operatorCard.getByRole('button', { name: '提交开始执行', exact: true }).click()
    ]);
    await operatorCard.getByRole('button', { name: '处理工单', exact: true }).click();
    await operatorCard.getByLabel('工单执行结果').fill('茶水已按确认要求送达');
    await operatorCard.getByLabel('工单成本金额').fill('36.5');
    await operatorCard.getByLabel('工单成本说明').fill('浏览器验收物料');
    await Promise.all([
      operator.page.waitForResponse(response => response.url().includes('/transitions') && response.status() === 200),
      operatorCard.getByRole('button', { name: '提交执行完成', exact: true }).click()
    ]);
    await expect(operatorCard.getByText('已完成', { exact: true })).toBeVisible();
    await expect(operatorCard.getByText(/成本：¥36\.5/)).toBeVisible();
    expect(operator.errors).toEqual([]);
    await operator.context.close();
  });

  test('旧二维码、旧版本和离线扫码不发请求，最新本人二维码由服务端保存签到', async ({ browser }) => {
    const bookingId = `browser-qr-${crypto.randomUUID()}`;
    await insertApprovedBooking({
      id: bookingId, start: new Date(Date.now() - 5 * 60000), end: new Date(Date.now() + 55 * 60000), purpose: 'Chrome 二维码安全签到'
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = monitorPage(page);
    await page.addInitScript(() => {
      (window as any).__qrValue = '';
      (window as any).BarcodeDetector = class {
        async detect() {
          const value = (window as any).__qrValue;
          return value ? [{ rawValue: value }] : [];
        }
      };
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] })
      } });
      Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, get: () => null, set: () => undefined });
    });
    await login(page, names[ids.requester]);
    let checkInRequests = 0;
    page.on('request', request => {
      if (request.url().endsWith(`/api/bookings/${bookingId}/check-in`)) checkInRequests += 1;
    });
    await page.getByRole('button', { name: '扫码签到', exact: true }).click();
    await expect(page.getByLabel('二维码扫描画面')).toBeVisible();

    await page.evaluate(id => { (window as any).__qrValue = `smart-office:check-in:${id}`; }, bookingId);
    await expect(page.getByText('二维码未对应当前可签到会议，或缺少预约版本，请使用最新会议二维码。', { exact: true })).toBeVisible();
    expect(checkInRequests).toBe(0);
    await page.evaluate(id => { (window as any).__qrValue = `smart-office:check-in:${id}:v2`; }, bookingId);
    await expect(page.getByText('二维码对应已改期或恢复前的预约，请扫描最新二维码。', { exact: true })).toBeVisible();
    expect(checkInRequests).toBe(0);

    await context.setOffline(true);
    await page.evaluate(id => { (window as any).__qrValue = `smart-office:check-in:${id}:v1`; }, bookingId);
    await expect(page.getByText('当前离线，扫码签到不可用；未保存任何签到，请联网后重试。', { exact: true })).toBeVisible();
    expect(checkInRequests).toBe(0);
    await context.setOffline(false);

    const requestPromise = page.waitForRequest(request => request.url().endsWith(`/api/bookings/${bookingId}/check-in`));
    await page.evaluate(id => { (window as any).__qrValue = `smart-office:check-in:${id}:v1`; }, bookingId);
    const request = await requestPromise;
    expect(request.postDataJSON()).toMatchObject({ source: 'QR', scheduleVersion: 1, subjectUserId: ids.requester });
    expect((await request.response())!.status()).toBe(200);
    await expect(page.getByRole('dialog', { name: '会议签到' })).toHaveCount(0);
    expect(checkInRequests).toBe(1);
    expect((await readBooking(bookingId)).checkInSource).toBe('QR');
    expect(errors).toEqual([]);
    await context.close();
  });

  test('会务人工签到、申请人使用确认和提前结束在页面形成一致事实', async ({ browser }) => {
    const bookingId = `browser-usage-${crypto.randomUUID()}`;
    const purpose = 'Chrome 实际使用闭环';
    await insertApprovedBooking({
      id: bookingId, start: new Date(Date.now() - 5 * 60000), end: new Date(Date.now() + 55 * 60000), purpose
    });
    const coordinator = await openWorkspace(browser, ids.coordinator);
    await openService(coordinator.page);
    await coordinator.page.getByRole('tab', { name: '签到与释放' }).click();
    await coordinator.page.getByLabel('现场管理预约').selectOption(bookingId);
    await Promise.all([
      coordinator.page.waitForResponse(response => response.url().endsWith('/check-in') && response.status() === 200),
      coordinator.page.getByRole('button', { name: '人工签到', exact: true }).click()
    ]);
    await expect(coordinator.page.getByRole('button', { name: '撤销签到', exact: true })).toBeVisible();
    await coordinator.context.close();

    const requester = await openWorkspace(browser, ids.requester);
    await openBookings(requester.page);
    await requester.page.getByText(purpose, { exact: true }).click();
    const usage = requester.page.getByRole('region', { name: `${purpose}使用与申诉` });
    await usage.getByLabel(`${purpose}使用确认说明`).fill('会议正常进行');
    await Promise.all([
      requester.page.waitForResponse(response => response.url().endsWith('/usage-confirmation') && response.status() === 200),
      usage.getByRole('button', { name: '保存使用确认', exact: true }).click()
    ]);
    requester.page.once('dialog', dialog => dialog.accept());
    await Promise.all([
      requester.page.waitForResponse(response => response.url().endsWith('/complete') && response.status() === 200),
      requester.page.getByRole('button', { name: '提前结束并释放', exact: true }).click()
    ]);
    await expect(requester.page.getByText('结束', { exact: true })).toBeVisible();
    const completed = await readBooking(bookingId);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.actualStartTime).toBeTruthy();
    expect(completed.actualEndTime).toBeTruthy();
    expect(requester.errors).toEqual([]);
    await requester.context.close();
  });

  test('移动端未使用确认与申诉可见，审批负责人只能处理申诉并可恢复预约', async ({ browser }) => {
    const bookingId = `browser-appeal-${crypto.randomUUID()}`;
    const purpose = 'Chrome 未使用申诉闭环';
    await insertApprovedBooking({
      id: bookingId, start: new Date(Date.now() + 3 * 3600000), end: new Date(Date.now() + 4 * 3600000), purpose
    });
    const requester = await openWorkspace(browser, ids.requester, { width: 390, height: 844 });
    await openBookings(requester.page);
    await requester.page.getByText(purpose, { exact: true }).click();
    const usage = requester.page.getByRole('region', { name: `${purpose}使用与申诉` });
    await usage.getByRole('button', { name: '确认未使用', exact: true }).click();
    await usage.getByLabel(`${purpose}使用确认说明`).fill('议题取消，确认未到场');
    requester.page.once('dialog', dialog => dialog.accept());
    await Promise.all([
      requester.page.waitForResponse(response => response.url().endsWith('/usage-confirmation') && response.status() === 200),
      usage.getByRole('button', { name: '保存使用确认', exact: true }).click()
    ]);
    await expect(usage.getByText(/确认未使用 ·/)).toBeVisible();
    await usage.getByLabel(`${purpose}申诉理由`).fill('现场核实需要恢复会议');
    await Promise.all([
      requester.page.waitForResponse(response => response.url().endsWith('/usage-appeals') && response.status() === 201),
      usage.getByRole('button', { name: '提交释放申诉', exact: true }).click()
    ]);
    await expect(usage.getByText('待处理', { exact: true })).toBeVisible();
    expect(requester.errors).toEqual([]);
    await requester.context.close();

    const approver = await openWorkspace(browser, ids.approver);
    await openService(approver.page);
    await expect(approver.page.getByRole('tab', { name: '释放申诉' })).toBeVisible();
    await expect(approver.page.getByRole('tab', { name: '签到与释放' })).toHaveCount(0);
    await expect(approver.page.getByRole('tab', { name: '责任区与班次' })).toHaveCount(0);
    await expect(approver.page.getByRole('tab', { name: '服务目录' })).toHaveCount(0);
    await approver.page.getByRole('tab', { name: '释放申诉' }).click();
    const appeal = approver.page.locator('article').filter({ hasText: purpose });
    await appeal.getByLabel(/申诉处理意见/).fill('核查通过，恢复本次预约');
    await Promise.all([
      approver.page.waitForResponse(response => response.url().includes('/api/usage-appeals/') && response.status() === 200),
      appeal.getByRole('button', { name: '恢复预约', exact: true }).click()
    ]);
    await expect(appeal.getByText('已恢复', { exact: true })).toBeVisible();
    const restored = await readBooking(bookingId);
    expect(restored.status).toBe('APPROVED');
    expect(restored.scheduleVersion).toBe(2);
    expect(approver.errors).toEqual([]);
    await approver.context.close();
  });
});

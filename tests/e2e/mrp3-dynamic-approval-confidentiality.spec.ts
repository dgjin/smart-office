import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { Booking } from '../../types.ts';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
type Session = Awaited<ReturnType<TestServer['login']>>;
const ids = {
  admin: '1', approver: '2', requester: '3',
  security: 'u-mrp3-browser-security', outsider: 'u-mrp3-browser-outsider',
  oldAttendee: 'u-mrp3-browser-old-attendee', newAttendee: 'u-mrp3-browser-new-attendee',
  whitelistUser: 'u-mrp3-browser-whitelist'
};
const names: Record<string, string> = {
  [ids.admin]: '超级管理员', [ids.approver]: '审批负责人', [ids.requester]: '李员工',
  [ids.security]: 'MRP3浏览器保密管理员', [ids.outsider]: 'MRP3浏览器无关员工',
  [ids.oldAttendee]: 'MRP3浏览器原参会人', [ids.newAttendee]: 'MRP3浏览器新参会人',
  [ids.whitelistUser]: 'MRP3浏览器白名单成员'
};
const sessions = new Map<string, Session>();
let bookingSequence = 0;

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
const createUser = async (id: string) => {
  const response = await api('/api/users', 'POST', ids.admin, {
    user: {
      id, name: names[id], email: `${id}@company.com`, role: [id === ids.security ? 'SECURITY_ADMIN' : 'EMPLOYEE'],
      department: '市场部', landline: '010-88889999', mobile: '13800009999'
    }
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  sessions.set(id, await server.login(id));
};
const addWhitelist = async (userId: string) => {
  const response = await api('/api/confidential-whitelist', 'POST', ids.security, {
    entry: { userId, reason: 'MRP3 真实 Chrome 验收白名单' }
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
};
const createBooking = async (purpose: string, overrides: Record<string, unknown> = {}) => {
  const start = new Date();
  start.setDate(start.getDate() + 41 + bookingSequence++);
  start.setHours(10, 0, 0, 0);
  const booking = {
    id: crypto.randomUUID(), userId: ids.requester, resourceId: 'r1', type: 'ROOM',
    startTime: start.toISOString(), endTime: new Date(start.getTime() + 3600000).toISOString(),
    status: 'PENDING', purpose, participants: 2, meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL',
    createdAt: new Date().toISOString(), currentNodeIndex: 0, approvalHistory: [], ...overrides
  };
  const response = await api('/api/bookings', 'POST', ids.requester, { booking });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return (await response.json()).booking as Booking;
};
const approve = async (actorId: string, bookingId: string) => {
  const response = await api('/api/agent/action', 'POST', actorId, {
    action: { type: 'PROPOSE_APPROVAL', bookingId, decision: 'APPROVE', comment: 'MRP3 Chrome 验收通过', summary: '通过审批' }
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
};
const readBooking = async (bookingId: string): Promise<Booking> => {
  const rows = await queryTestDb<any[]>('SELECT payload FROM bookings WHERE id = ?', [bookingId]);
  expect(rows).toHaveLength(1);
  return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
};
const readAuthorizations = async (bookingId: string) => {
  const rows = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'confidentialityAuthorizations'");
  const values = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
  return values.filter((item: any) => item.bookingId === bookingId);
};
const monitorPage = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(`console: ${message.text()}`);
  });
  page.on('response', response => {
    const expectedAnonymousCheck = response.url().endsWith('/api/auth/me') && response.status() === 401;
    if (response.url().includes('/api/') && response.status() >= 400 && !expectedAnonymousCheck) errors.push(`http ${response.status}: ${response.url()}`);
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
const openWorkspace = async (browser: Browser, name: string) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = monitorPage(page);
  await login(page, name);
  return { context, page, errors };
};
const openResources = async (page: Page) => {
  const desktop = page.getByRole('button', { name: '空间资源库', exact: true });
  if (await desktop.isVisible()) await desktop.click();
  else await page.getByRole('navigation', { name: '移动端主导航' }).getByRole('button', { name: '资源', exact: true }).click();
};
const openBooking = async (page: Page, resourceName: string) => {
  await openResources(page);
  const row = page.locator('tr').filter({ hasText: resourceName });
  await row.getByRole('button', { name: '预约', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `预约${resourceName}` });
  await expect(dialog).toBeVisible();
  return dialog;
};
const fillSchedule = async (dialog: ReturnType<Page['getByRole']>, daysAhead: number) => {
  const start = new Date();
  start.setDate(start.getDate() + daysAhead);
  start.setHours(10, 0, 0, 0);
  const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  await dialog.getByLabel('自定义预约日期').fill(date);
  await dialog.getByLabel('预约开始时间').selectOption('10:00');
  await dialog.getByLabel('预约结束时间').selectOption('11:00');
};
const openMyBookingEditor = async (page: Page, purpose: string) => {
  await page.getByRole('button', { name: '我的申请', exact: true }).click();
  const title = page.getByText(purpose, { exact: true });
  await expect(title).toBeVisible();
  await title.click();
  await page.getByRole('button', { name: '修改预约', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /修改预约/ });
  await expect(dialog).toBeVisible();
  return dialog;
};
const openConfidentiality = async (page: Page) => {
  const item = page.getByRole('button', { name: '保密控制', exact: true });
  if (!await item.isVisible()) await page.getByRole('button', { name: '系统管理', exact: true }).click();
  await item.click();
};
const issueAuthorization = async (browser: Browser, actorId: string, bookingId: string, action: 'DECLASSIFY' | 'ATTENDEE_CHANGE', reason: string) => {
  const { context, page, errors } = await openWorkspace(browser, names[actorId]);
  await openConfidentiality(page);
  await page.getByLabel('涉密变更申请', { exact: true }).selectOption(bookingId);
  await page.getByLabel('涉密变更类型', { exact: true }).selectOption(action);
  await page.getByLabel('涉密变更授权理由', { exact: true }).fill(reason);
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/api/bookings/${bookingId}/confidential-authorizations`) && response.status() === 201),
    page.getByRole('button', { name: '签发一次性授权', exact: true }).click()
  ]);
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
  await expect(page.getByText('未使用', { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
};

test.describe('MRP3 动态审批与保密控制真实 Chrome 验收', () => {
  test.skip(!integrationEnabled, '仅允许显式隔离 MySQL 测试环境');
  test.setTimeout(180_000);
  test.use({ actionTimeout: 10_000 });

  test.beforeAll(async () => {
    await resetTestDb();
    await server.start();
    for (const id of [ids.admin, ids.approver, ids.requester]) sessions.set(id, await server.login(id));
    for (const id of [ids.security, ids.outsider, ids.oldAttendee, ids.newAttendee, ids.whitelistUser]) await createUser(id);
    for (const id of [ids.requester, ids.oldAttendee, ids.newAttendee]) await addWhitelist(id);
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('保密管理员维护白名单，375px 移动端可进入保密控制且无横向溢出', async ({ page }) => {
    const errors = monitorPage(page);
    await login(page, names[ids.security]);
    await openConfidentiality(page);
    await page.getByLabel('白名单成员', { exact: true }).selectOption(ids.whitelistUser);
    const reason = `MRP3浏览器白名单 ${Date.now()}`;
    await page.getByLabel('白名单设置理由', { exact: true }).fill(reason);
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/confidential-whitelist') && response.status() === 201),
      page.getByRole('button', { name: '加入白名单', exact: true }).click()
    ]);
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
    await page.screenshot({ path: '.wb/reports/mrp3-desktop-whitelist.png', fullPage: true });
    page.once('dialog', dialog => dialog.accept());
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/confidential-whitelist/') && response.request().method() === 'DELETE' && response.ok()),
      page.getByRole('button', { name: `移除${names[ids.whitelistUser]}的白名单资格`, exact: true }).click()
    ]);
    await expect(page.getByText(reason, { exact: true })).toHaveCount(0);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('navigation', { name: '移动端主导航' }).getByRole('button', { name: '更多', exact: true }).click();
    const menu = page.getByRole('dialog', { name: '更多功能', exact: true });
    await menu.getByRole('button', { name: '保密控制', exact: true }).click();
    await expect(page.getByRole('heading', { name: '保密控制', exact: true, level: 3 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await expect(page.getByRole('navigation', { name: '移动端主导航' })).toBeVisible();
    await page.screenshot({ path: '.wb/reports/mrp3-mobile-confidentiality.png', fullPage: true });
    expect(errors).toEqual([]);
  });

  test('审批工作台展示重要会议命中依据及冻结的流程与规则集版本', async ({ page }) => {
    const errors = monitorPage(page);
    const purpose = `MRP3重要规则浏览器验收 ${Date.now()}`;
    const booking = await createBooking(purpose, { meetingType: 'IMPORTANT' });
    await login(page, names[ids.approver]);
    await page.getByRole('button', { name: '审批工作台', exact: true }).click();
    const card = page.locator('div').filter({ has: page.getByText(purpose, { exact: false }) })
      .filter({ has: page.getByRole('button', { name: '通过审批', exact: true }) }).last();
    await expect(card).toBeVisible();
    await expect(card).toContainText(`流程 V${booking.workflowVersion}`);
    await expect(card).toContainText(`规则集 V${booking.approvalRuleSetVersion}`);
    await expect(card).toContainText('命中依据：');
    await expect(card).toContainText('重要会议');
    await page.screenshot({ path: '.wb/reports/mrp3-approval-rule-explanation.png', fullPage: true });
    expect(errors).toEqual([]);
  });

  test('涉密参会变更先阻断，授权后编辑核销，审批完成仅授权账号可下载 ICS', async ({ browser }) => {
    const owner = await openWorkspace(browser, names[ids.requester]);
    const purpose = `MRP3涉密参会变更 ${Date.now()}`;
    const dialog = await openBooking(owner.page, 'Alpha 战略会议室');
    await dialog.getByRole('textbox', { name: '申请用途' }).fill(purpose);
    await dialog.getByLabel('参与人数', { exact: true }).fill('2');
    await dialog.getByLabel('会议类型', { exact: true }).selectOption('CONFIDENTIAL');
    await dialog.getByLabel('涉密确认', { exact: true }).selectOption('CONFIDENTIAL');
    await fillSchedule(dialog, 32);
    await dialog.locator('label').filter({ hasText: names[ids.oldAttendee] }).getByRole('checkbox').check();
    await Promise.all([
      owner.page.waitForResponse(response => response.url().endsWith('/api/bookings') && response.status() === 201),
      dialog.getByRole('button', { name: '确认预约', exact: true }).click()
    ]);
    const created = (await queryTestDb<any[]>('SELECT id FROM bookings WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, \'$.purpose\')) = ?', [purpose]))[0];

    const blocked = await openMyBookingEditor(owner.page, purpose);
    await blocked.locator('label').filter({ hasText: names[ids.newAttendee] }).getByRole('checkbox').check();
    await blocked.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(blocked.getByRole('alert')).toContainText('涉密参会范围变化需要一名授权人的有效授权');
    await expect(owner.page.locator('#booking-attendees')).toBeFocused();
    await owner.page.screenshot({ path: '.wb/reports/mrp3-attendee-change-blocked.png', fullPage: true });
    await blocked.getByRole('button', { name: '取消', exact: true }).click();

    const reason = 'MRP3 浏览器参会范围变更授权';
    await issueAuthorization(browser, ids.security, created.id, 'ATTENDEE_CHANGE', reason);
    await owner.page.reload();
    await expect(owner.page.locator('.studio-app')).toBeVisible();
    const editor = await openMyBookingEditor(owner.page, purpose);
    await editor.locator('label').filter({ hasText: names[ids.newAttendee] }).getByRole('checkbox').check();
    await Promise.all([
      owner.page.waitForResponse(response => response.url().endsWith(`/api/bookings/${created.id}`) && response.request().method() === 'PUT' && response.ok()),
      editor.getByRole('button', { name: '保存修改', exact: true }).click()
    ]);
    const changed = await readBooking(created.id);
    expect(changed.attendeeIds).toEqual(expect.arrayContaining([ids.oldAttendee, ids.newAttendee]));
    expect((await readAuthorizations(created.id)).filter((item: any) => item.action === 'ATTENDEE_CHANGE')[0].usedAt).toBeTruthy();

    await approve(ids.approver, created.id);
    await approve(ids.security, created.id);
    await approve(ids.admin, created.id);
    expect((await readBooking(created.id)).status).toBe('APPROVED');
    const forbidden = await api(`/api/bookings/${created.id}/ics`, 'GET', ids.outsider);
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error).toBe('CONFIDENTIAL_EXPORT_FORBIDDEN');

    await owner.page.reload();
    await expect(owner.page.locator('.studio-app')).toBeVisible();
    await owner.page.getByRole('button', { name: '我的申请', exact: true }).click();
    await owner.page.getByText(purpose, { exact: true }).click();
    const downloadEvent = owner.page.waitForEvent('download');
    await owner.page.getByRole('button', { name: '下载 ICS 日历', exact: true }).click();
    const download = await downloadEvent;
    const path = await download.path();
    expect(path).not.toBeNull();
    const ics = await readFile(path!, 'utf8');
    expect(ics).toContain(`SUMMARY:${purpose}\r\n`);
    expect(ics).toContain('STATUS:CONFIRMED\r\n');
    await owner.page.screenshot({ path: '.wb/reports/mrp3-authorized-ics.png', fullPage: true });
    expect(owner.errors).toEqual([]);
    await owner.context.close();
  });

  test('涉密降级需两名不同授权人，管理端仅获最小队列字段且授权可一次性核销', async ({ browser }) => {
    const purpose = `MRP3涉密降级 ${Date.now()}`;
    const booking = await createBooking(purpose, { meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL' });
    const owner = await openWorkspace(browser, names[ids.requester]);
    const blocked = await openMyBookingEditor(owner.page, purpose);
    await blocked.getByLabel('会议类型', { exact: true }).selectOption('NORMAL');
    await blocked.getByLabel('涉密确认', { exact: true }).selectOption('NON_CONFIDENTIAL');
    await blocked.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(blocked.getByRole('alert')).toContainText('涉密降级需要两名不同授权人的有效授权');
    await expect(owner.page.locator('#booking-confidentiality')).toBeFocused();
    await owner.page.screenshot({ path: '.wb/reports/mrp3-declassify-blocked.png', fullPage: true });
    await blocked.getByRole('button', { name: '取消', exact: true }).click();

    await issueAuthorization(browser, ids.admin, booking.id, 'DECLASSIFY', 'MRP3 系统管理员降级复核');
    await issueAuthorization(browser, ids.security, booking.id, 'DECLASSIFY', 'MRP3 保密管理员降级复核');
    await owner.page.reload();
    await expect(owner.page.locator('.studio-app')).toBeVisible();
    const editor = await openMyBookingEditor(owner.page, purpose);
    await editor.getByLabel('会议类型', { exact: true }).selectOption('NORMAL');
    await editor.getByLabel('涉密确认', { exact: true }).selectOption('NON_CONFIDENTIAL');
    await Promise.all([
      owner.page.waitForResponse(response => response.url().endsWith(`/api/bookings/${booking.id}`) && response.request().method() === 'PUT' && response.ok()),
      editor.getByRole('button', { name: '保存修改', exact: true }).click()
    ]);
    const changed = await readBooking(booking.id);
    expect(changed.meetingType).toBe('NORMAL');
    expect(changed.confidentialityChoice).toBe('NON_CONFIDENTIAL');
    const authorizations = await readAuthorizations(booking.id);
    expect(authorizations).toHaveLength(2);
    expect(new Set(authorizations.map((item: any) => item.authorizedBy)).size).toBe(2);
    expect(authorizations.every((item: any) => Boolean(item.usedAt))).toBe(true);
    expect(changed.status).toBe('APPROVED');
    expect(changed.approvalRuleId).toBeUndefined();
    expect(changed.approvalHistory.at(-1)?.nodeName).toBe('系统自动核准');
    expect(owner.errors).toEqual([]);
    await owner.context.close();
  });
});

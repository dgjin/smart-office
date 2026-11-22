import crypto from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
const requesterId = '3';
const outsiderId = 'u-mrp2-browser-outsider';
const hallId = 'r-mrp2-browser-hall';
const exclusiveId = 'r-mrp2-browser-exclusive';
const combinedId = 'r-mrp2-browser-combined';
let requester: Awaited<ReturnType<TestServer['login']>>;

const dateValue = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const schedule = (daysAhead: number, hour: number, durationMinutes = 60) => {
  const start = new Date();
  start.setDate(start.getDate() + daysAhead);
  start.setHours(hour, 0, 0, 0);
  return { start, end: new Date(start.getTime() + durationMinutes * 60000), date: dateValue(start) };
};
const exclusiveSchedule = (preferLast = false) => {
  const candidates = [0, 1].flatMap(days => [10, 14, 16].map(hour => schedule(days, hour))).filter(item => {
    const leadMinutes = (item.start.getTime() - Date.now()) / 60000;
    return leadMinutes >= 120 && leadMinutes <= 23 * 60;
  });
  if (!candidates.length) throw new Error('无法生成专属资源验收时段');
  return candidates[preferLast ? candidates.length - 1 : 0];
};
const api = (pathname: string, method: string, session: Awaited<ReturnType<TestServer['login']>>, body?: unknown) =>
  server.request(pathname, {
    method,
    headers: { Cookie: session.cookie },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
const login = async (page: Page) => {
  await page.goto(server.baseUrl);
  const account = page.locator('.login-account').filter({ has: page.locator('.login-account-name', { hasText: '李员工' }) });
  await expect(account).toBeVisible();
  const workspace = page.waitForResponse(response => response.url().endsWith('/api/workspace') && response.ok());
  await account.click();
  await workspace;
  await expect(page.locator('.studio-app')).toBeVisible();
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
const fillSchedule = async (dialog: ReturnType<Page['getByRole']>, value: ReturnType<typeof schedule>, end: string) => {
  await dialog.getByLabel('自定义预约日期').fill(value.date);
  await dialog.getByLabel('预约开始时间').selectOption(`${String(value.start.getHours()).padStart(2, '0')}:00`);
  await dialog.getByLabel('预约结束时间').selectOption(end);
};
const bookingPayload = async (purpose: string) => {
  const rows = await queryTestDb<any[]>('SELECT payload, rule_version FROM bookings WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, \'$.purpose\')) = ?', [purpose]);
  expect(rows).toHaveLength(1);
  return { ...(typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload), rule_version: rows[0].rule_version };
};
const monitorPage = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(`console: ${message.text()}`);
  });
  page.on('response', response => {
    const expectedAnonymousCheck = response.url().endsWith('/api/auth/me') && response.status() === 401;
    if (response.url().includes('/api/') && response.status() >= 400 && !expectedAnonymousCheck) errors.push(`http ${response.status()}: ${response.url()}`);
  });
  return errors;
};

test.describe('MRP2 核心预约规则真实 Chrome 验收', () => {
  test.skip(!integrationEnabled, '仅允许显式隔离 MySQL 测试环境');
  test.setTimeout(120_000);
  test.use({ actionTimeout: 10_000 });

  test.beforeAll(async () => {
    await resetTestDb();
    await server.start();
    const options = await (await server.request('/api/auth/options')).json();
    const adminId = options.users.find((user: any) => user.role.includes('SYSTEM_ADMIN')).id;
    const admin = await server.login(adminId);
    requester = await server.login(requesterId);
    const userResponse = await api('/api/users', 'POST', admin, {
      user: {
        id: outsiderId, name: 'MRP2浏览器参会人', email: 'mrp2-browser@company.com', role: ['EMPLOYEE'],
        department: '市场部', landline: '010-88889999', mobile: '13800000119'
      }
    });
    expect(userResponse.status).toBe(201);
    const resources = [
      {
        id: hallId, code: 'MRP2-BROWSER-HALL', name: 'MRP2浏览器礼堂', type: 'ROOM', capacity: 100,
        location: '2号楼 2层 · H202', building: 'ANNEX', floor: 2, roomNumber: 'H202', roomCategory: 'AUDITORIUM',
        features: ['视频会议'], status: 'AVAILABLE', isPublic: true, isExclusive: false, openStart: '08:00', openEnd: '20:00'
      },
      {
        id: exclusiveId, code: 'MRP2-BROWSER-EXCLUSIVE', name: 'MRP2浏览器专属室', type: 'ROOM', capacity: 8,
        location: '2号楼 2层 · E203', building: 'ANNEX', floor: 2, roomNumber: 'E203', features: [],
        status: 'AVAILABLE', isPublic: false, isExclusive: true, exclusiveLeaderLevel: '浏览器验收授权', openStart: '08:00', openEnd: '20:00'
      },
      {
        id: combinedId, code: 'MRP2-BROWSER-COMBINED', name: 'MRP2草案专属礼堂', type: 'ROOM', capacity: 80,
        location: '2号楼 3层 · H301', building: 'ANNEX', floor: 3, roomNumber: 'H301', roomCategory: 'AUDITORIUM',
        features: ['视频会议'], status: 'AVAILABLE', isPublic: false, isExclusive: true, exclusiveLeaderLevel: '浏览器验收授权', openStart: '08:00', openEnd: '20:00'
      }
    ];
    for (const resource of resources) {
      const response = await api('/api/resources', 'POST', admin, { resource });
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    }
    const outsider = await server.login(outsiderId);
    const overlap = schedule(8, 10);
    const overlapResponse = await api('/api/bookings', 'POST', outsider, {
      booking: {
        id: crypto.randomUUID(), resourceId: 'r1', type: 'ROOM', startTime: overlap.start.toISOString(), endTime: overlap.end.toISOString(),
        status: 'APPROVED', purpose: '其他会议敏感用途', participants: 4, createdAt: new Date().toISOString(), currentNodeIndex: 99,
        approvalHistory: [], meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL'
      }
    });
    expect(overlapResponse.status, JSON.stringify(await overlapResponse.clone().json())).toBe(201);
    const quotaFull = schedule(11, 8, 240);
    const quotaFullResponse = await api('/api/bookings', 'POST', requester, {
      booking: {
        id: crypto.randomUUID(), resourceId: 'r1', type: 'ROOM', startTime: quotaFull.start.toISOString(), endTime: quotaFull.end.toISOString(),
        status: 'APPROVED', purpose: 'GAP02浏览器A会议室额度已满', participants: 4, createdAt: new Date().toISOString(), currentNodeIndex: 99,
        approvalHistory: [], meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL'
      }
    });
    expect(quotaFullResponse.status, JSON.stringify(await quotaFullResponse.clone().json())).toBe(201);
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('桌面表单执行必选校验、错误聚焦、额度提示和弱重叠提示并真实落库', async ({ page }) => {
    const errors = monitorPage(page);
    await login(page);
    const purpose = `MRP2桌面验收 ${Date.now()}`;
    const dialog = await openBooking(page, 'Alpha 战略会议室');
    const purposeInput = dialog.getByRole('textbox', { name: '申请用途' });
    const participantsInput = dialog.getByLabel('参与人数', { exact: true });
    await expect(participantsInput).toHaveValue('');
    await dialog.getByRole('button', { name: '确认预约', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('有明确主题的申请用途');
    await expect(purposeInput).toBeFocused();
    await purposeInput.fill('会 议');
    await dialog.getByRole('button', { name: '确认预约', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('不能只填写“会议”或“开会”');
    await expect(purposeInput).toBeFocused();
    await purposeInput.fill(purpose);
    await dialog.getByRole('button', { name: '确认预约', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('请选择普通、重要或涉密会议类型');
    await expect(page.locator('#booking-meeting-type')).toBeFocused();
    await dialog.getByLabel('会议类型', { exact: true }).selectOption('IMPORTANT');
    await dialog.getByRole('button', { name: '确认预约', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('请明确选择本会议是否涉密');
    await expect(page.locator('#booking-confidentiality')).toBeFocused();
    await dialog.getByLabel('涉密确认', { exact: true }).selectOption('NON_CONFIDENTIAL');
    await expect(dialog.getByLabel('联系人快照说明')).toContainText('李员工');
    await expect(dialog.getByLabel('联系人快照说明')).toContainText('010-88886668');
    await expect(dialog.getByLabel('联系人快照说明')).toContainText('13800000003');
    for (const invalid of ['', '0', '-1', '1.5']) {
      await participantsInput.fill(invalid);
      await dialog.getByRole('button', { name: '确认预约', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText('参与人数必填，且必须为大于 0 的整数');
      await expect(participantsInput).toBeFocused();
      await expect(participantsInput).toHaveAttribute('aria-invalid', 'true');
    }
    await participantsInput.fill('4');
    await fillSchedule(dialog, schedule(7, 10), '11:00');
    await dialog.getByRole('button', { name: /^其他会务服务/ }).click();
    await dialog.getByRole('button', { name: '确认预约', exact: true }).click();
    await expect(page.locator('#booking-service-OTHER-notes')).toBeFocused();
    await page.locator('#booking-service-OTHER-notes').fill('席卡与桌签');
    await dialog.getByRole('button', { name: /^引导与标识/ }).click();
    await page.locator('#booking-service-SIGNAGE-notes').fill('一楼入口指引');
    await dialog.getByRole('button', { name: '茶水服务', exact: true }).click();
    await expect(dialog.getByLabel('部门额度提示')).toContainText('本次计 60 分钟');
    await page.screenshot({ path: '.wb/reports/mrp2-desktop-booking-form.png', fullPage: true });
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/bookings') && response.status() === 201),
      dialog.getByRole('button', { name: '确认预约', exact: true }).click()
    ]);
    const saved = await bookingPayload(purpose);
    expect(saved.meetingType).toBe('IMPORTANT');
    expect(saved.confidentialityChoice).toBe('NON_CONFIDENTIAL');
    expect(saved.contactSnapshot).toEqual({ userId: requesterId, name: '李员工', landline: '010-88886668', mobile: '13800000003' });
    expect(saved.serviceRequirements.map((item: any) => item.type)).toEqual(['OTHER', 'SIGNAGE', 'TEA']);
    expect(saved.serviceRequirements.map((item: any) => item.details)).toEqual(['席卡与桌签', '一楼入口指引', undefined]);
    expect(saved.serviceRequirements[0].fieldValues).toEqual({ notes: '席卡与桌签' });
    expect(saved.serviceRequirements[1].fieldValues).toEqual({ notes: '一楼入口指引' });
    expect(saved.serviceRequirements.every((item: any) => item.catalogSnapshot?.catalogVersion === 1)).toBe(true);
    expect(Number(saved.rule_version)).toBe(1);
    expect(saved.ruleSettingsSnapshot.departmentDailyNetMinutes).toBe(240);
    expect(saved.quotaDetails[0].requestedMinutes).toBe(60);

    const overlapDialog = await openBooking(page, 'Beta 灵感会议室');
    await overlapDialog.getByRole('textbox', { name: '申请用途' }).fill(`MRP2重叠提示 ${Date.now()}`);
    await fillSchedule(overlapDialog, schedule(8, 10), '11:00');
    const attendeeCheckbox = overlapDialog.locator('label').filter({ hasText: 'MRP2浏览器参会人' }).getByRole('checkbox');
    await attendeeCheckbox.check();
    await expect(attendeeCheckbox).toBeChecked();
    await expect(overlapDialog.getByLabel('部门额度提示')).toContainText('本次计 60 分钟');
    await page.screenshot({ path: '.wb/reports/mrp2-attendee-overlap.png', fullPage: true });
    const warning = overlapDialog.getByRole('status').filter({ hasText: '参会人时间重叠提示（不阻断申请）' });
    await expect(warning).toContainText('MRP2浏览器参会人在该时段已有其他预约');
    await expect(warning).not.toContainText('其他会议敏感用途');
    await overlapDialog.getByRole('button', { name: '取消', exact: true }).click();
    expect(errors).toEqual([]);
  });

  test('A会议室达到部门日额度后表单明确阻断且B会议室可独立提交', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await login(page);
    const value = schedule(11, 13);
    const roomA = await openBooking(page, 'Alpha 战略会议室');
    await roomA.getByRole('textbox', { name: '申请用途' }).fill(`GAP02浏览器A超额 ${Date.now()}`);
    await roomA.getByLabel('参与人数', { exact: true }).fill('4');
    await roomA.getByLabel('会议类型', { exact: true }).selectOption('NORMAL');
    await roomA.getByLabel('涉密确认', { exact: true }).selectOption('NON_CONFIDENTIAL');
    await fillSchedule(roomA, value, '14:00');
    await expect(roomA.getByLabel('部门额度提示')).toContainText('本部门在当前会议室的每日净额度');
    await expect(roomA.getByLabel('部门额度提示')).toContainText('不跨其他会议室扣减');
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/bookings') && response.status() === 409),
      roomA.getByRole('button', { name: '确认预约', exact: true }).click()
    ]);
    await expect(roomA.getByRole('alert')).toContainText('部门在当前会议室当日净预约额度不足');
    await roomA.getByRole('button', { name: '取消', exact: true }).click();

    const purpose = `GAP02浏览器B独立额度 ${Date.now()}`;
    const roomB = await openBooking(page, 'Beta 灵感会议室');
    await roomB.getByRole('textbox', { name: '申请用途' }).fill(purpose);
    await roomB.getByLabel('参与人数', { exact: true }).fill('4');
    await roomB.getByLabel('会议类型', { exact: true }).selectOption('NORMAL');
    await roomB.getByLabel('涉密确认', { exact: true }).selectOption('NON_CONFIDENTIAL');
    await fillSchedule(roomB, value, '14:00');
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/bookings') && response.status() === 201),
      roomB.getByRole('button', { name: '确认预约', exact: true }).click()
    ]);
    const saved = await bookingPayload(purpose);
    expect(saved.resourceId).toBe('r2');
    expect(saved.quotaDetails[0].resourceId).toBe('r2');
    expect(saved.quotaDetails[0].usedBeforeMinutes).toBe(0);
    expect(saved.quotaDetails[0].remainingMinutes).toBe(180);
    expect(saved.status).toBe('APPROVED');
    expect(saved.approvalWorkflow).toEqual([]);
    expect(saved.approvalHistory[0].nodeName).toBe('系统自动核准');
    await page.getByRole('button', { name: '通知中心', exact: true }).click();
    await expect(page.getByRole('button', { name: /预约已自动核准 资源 Beta 灵感会议室/ })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('礼堂参数和专属临时授权通过桌面表单提交并保留审计', async ({ page }) => {
    const errors = monitorPage(page);
    await login(page);
    const hallPurpose = `MRP2礼堂验收 ${Date.now()}`;
    const hall = await openBooking(page, 'MRP2浏览器礼堂');
    await hall.getByRole('textbox', { name: '申请用途' }).fill(hallPurpose);
    await hall.getByLabel('参与人数', { exact: true }).fill('20');
    await hall.getByLabel('会议类型', { exact: true }).selectOption('IMPORTANT');
    await hall.getByLabel('涉密确认', { exact: true }).selectOption('NON_CONFIDENTIAL');
    await fillSchedule(hall, schedule(9, 10), '12:00');
    await hall.locator('#booking-auditorium-layout').selectOption('CLASSROOM');
    await hall.getByLabel('彩排时长', { exact: true }).fill('45');
    await hall.getByLabel('需要舞台', { exact: true }).check();
    await hall.getByLabel('礼堂布置备注', { exact: true }).fill('前排预留');
    await hall.getByRole('button', { name: /^现场安保/ }).click();
    await hall.locator('#booking-service-SECURITY-notes').fill('南门值守');
    await page.screenshot({ path: '.wb/reports/mrp2-desktop-auditorium.png', fullPage: true });
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/bookings') && response.status() === 201),
      hall.getByRole('button', { name: '确认预约', exact: true }).click()
    ]);
    const hallSaved = await bookingPayload(hallPurpose);
    expect(hallSaved.auditoriumSetup).toEqual({ seatingLayout: 'CLASSROOM', stageRequired: true, rehearsalMinutes: 45, notes: '前排预留' });
    expect(hallSaved.serviceRequirements.map((item: any) => item.type)).toEqual(['SECURITY']);
    expect(hallSaved.serviceRequirements[0].details).toBe('南门值守');
    expect(hallSaved.serviceRequirements[0].fieldValues).toEqual({ notes: '南门值守' });
    expect(hallSaved.serviceRequirements[0].catalogSnapshot.catalogVersion).toBe(1);

    const exclusivePurpose = `MRP2专属验收 ${Date.now()}`;
    const exclusive = await openBooking(page, 'MRP2浏览器专属室');
    await exclusive.getByRole('textbox', { name: '申请用途' }).fill(exclusivePurpose);
    await exclusive.getByLabel('参与人数', { exact: true }).fill('4');
    await exclusive.getByLabel('会议类型', { exact: true }).selectOption('NORMAL');
    await exclusive.getByLabel('涉密确认', { exact: true }).selectOption('NON_CONFIDENTIAL');
    await expect(exclusive.locator('#booking-exclusive-reason')).toHaveAttribute('placeholder', /24 小时内可申请/);
    await exclusive.getByRole('button', { name: '确认预约', exact: true }).click();
    await expect(exclusive.locator('#booking-has-leader')).toBeFocused();
    await exclusive.getByRole('button', { name: '公司领导参会', exact: true }).click();
    await exclusive.getByRole('button', { name: '确认预约', exact: true }).click();
    await expect(exclusive.locator('#booking-exclusive-reason')).toBeFocused();
    await exclusive.locator('#booking-exclusive-reason').fill('临时重要接待');
    const exclusiveValue = exclusiveSchedule();
    await fillSchedule(exclusive, exclusiveValue, `${String(exclusiveValue.start.getHours() + 1).padStart(2, '0')}:00`);
    await page.screenshot({ path: '.wb/reports/mrp2-desktop-exclusive.png', fullPage: true });
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/bookings') && response.status() === 201),
      exclusive.getByRole('button', { name: '确认预约', exact: true }).click()
    ]);
    const exclusiveSaved = await bookingPayload(exclusivePurpose);
    expect(exclusiveSaved.exclusiveAccessType).toBe('TEMPORARY');
    expect(exclusiveSaved.hasLeader).toBe(true);
    expect(exclusiveSaved.exclusiveRequestReason).toBe('临时重要接待');
    const audits = await queryTestDb<any[]>('SELECT actor_id, details FROM audit_events WHERE action = ? AND entity_id = ?', ['EXCLUSIVE_ACCESS_REQUEST', exclusiveSaved.id]);
    expect(audits).toHaveLength(1);
    expect(audits[0].actor_id).toBe(requesterId);
    expect(errors).toEqual([]);
  });

  test('375px 移动端弹窗可滚动、无横向溢出且提交后底部导航可用', async ({ page }) => {
    const errors = monitorPage(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page);
    const purpose = `MRP2移动端验收 ${Date.now()}`;
    const dialog = await openBooking(page, 'Alpha 战略会议室');
    const body = dialog.locator('.booking-modal-body');
    const bounds = await body.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    const dimensions = await body.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
    expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await dialog.getByRole('textbox', { name: '申请用途' }).fill(purpose);
    await dialog.getByLabel('参与人数', { exact: true }).fill('4');
    await dialog.getByLabel('会议类型', { exact: true }).selectOption('NORMAL');
    await dialog.getByLabel('涉密确认', { exact: true }).selectOption('NON_CONFIDENTIAL');
    await fillSchedule(dialog, schedule(10, 14), '15:00');
    await page.screenshot({ path: '.wb/reports/mrp2-mobile-booking-top.png', fullPage: true });
    const submit = dialog.getByRole('button', { name: '确认预约', exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeVisible();
    await page.screenshot({ path: '.wb/reports/mrp2-mobile-booking-bottom.png', fullPage: true });
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/bookings') && response.status() === 201),
      submit.click()
    ]);
    await expect(page.getByRole('navigation', { name: '移动端主导航' })).toBeVisible();
    const saved = await bookingPayload(purpose);
    expect(saved.meetingType).toBe('NORMAL');
    expect(saved.confidentialityChoice).toBe('NON_CONFIDENTIAL');
    expect(errors).toEqual([]);
  });

  test('持久化 ChatDock 草案完整回填，涉密属性仍须人工选择后才可提交', async ({ page }) => {
    const errors = monitorPage(page);
    const value = exclusiveSchedule(true);
    const purpose = `MRP2草案回填 ${Date.now()}`;
    const response = await api('/api/agent/conversation', 'PUT', requester, {
      revision: 0,
      state: {
        turns: [
          { role: 'user', content: '请保留这份完整会议草案' },
          { role: 'assistant', content: '草案已生成，请核对。', actions: [{
            type: 'PROPOSE_BOOKING', summary: '待确认申请', draft: {
              resourceId: combinedId, startTime: value.start.toISOString(), endTime: value.end.toISOString(), purpose,
              participants: 20, meetingType: 'IMPORTANT', confidentialityChoice: 'CONFIDENTIAL',
              serviceRequirements: [{ type: 'SIGNAGE', details: '东门指引' }, { type: 'OTHER', details: '嘉宾席卡' }],
              hasLeader: true, exclusiveRequestReason: '临时重要接待', auditoriumSetup: { seatingLayout: 'CLASSROOM', stageRequired: true, rehearsalMinutes: 30, notes: '前排预留' },
              needsTeaService: true, isVideoConference: true, requiredFeatures: ['VIDEO']
            }
          }] }
        ],
        handled: {}, input: ''
      }
    });
    expect(response.status).toBe(200);
    await login(page);
    await page.getByRole('button', { name: '打开智能助手', exact: true }).click();
    const draft = page.getByRole('region', { name: '待确认申请草案' });
    await expect(draft).toBeVisible();
    await expect(draft.getByText(purpose, { exact: true })).toBeVisible();
    await expect(draft).toContainText('重要会议');
    await expect(draft).toContainText('临时重要接待');
    await expect(draft).toContainText('课桌式');
    await page.screenshot({ path: '.wb/reports/mrp2-chatdock-draft.png', fullPage: true });
    const openedState = page.waitForResponse(response => response.url().endsWith('/api/agent/conversation') && response.request().method() === 'PUT' && response.ok());
    await draft.getByRole('button', { name: '确认信息，打开申请表', exact: true }).click();
    await openedState;
    const dialog = page.getByRole('dialog', { name: '预约MRP2草案专属礼堂' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: '申请用途' })).toHaveValue(purpose);
    await expect(dialog.getByLabel('会议类型', { exact: true })).toHaveValue('IMPORTANT');
    await expect(dialog.getByLabel('涉密确认', { exact: true })).toHaveValue('');
    await expect(dialog.locator('#booking-exclusive-reason')).toHaveValue('临时重要接待');
    await expect(dialog.locator('#booking-auditorium-layout')).toHaveValue('CLASSROOM');
    await expect(dialog.getByLabel('彩排时长', { exact: true })).toHaveValue('30');
    await expect(dialog.getByLabel('需要舞台', { exact: true })).toBeChecked();
    await expect(dialog.locator('#booking-service-SIGNAGE-notes')).toHaveValue('东门指引');
    await expect(dialog.locator('#booking-service-OTHER-notes')).toHaveValue('嘉宾席卡');
    await expect(dialog.getByRole('button', { name: '茶水服务', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: '视频会议', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: '.wb/reports/mrp2-chatdock-prefill.png', fullPage: true });
    await dialog.getByRole('button', { name: '确认预约', exact: true }).click();
    await expect(page.locator('#booking-confidentiality')).toBeFocused();
    expect(await queryTestDb<any[]>('SELECT id FROM bookings WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, \'$.purpose\')) = ?', [purpose])).toHaveLength(0);
    await dialog.getByLabel('涉密确认', { exact: true }).selectOption('NON_CONFIDENTIAL');
    const [bookingResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/bookings') && response.request().method() === 'POST'),
      dialog.getByRole('button', { name: '确认预约', exact: true }).click()
    ]);
    expect(bookingResponse.status(), JSON.stringify(await bookingResponse.json())).toBe(201);
    const saved = await bookingPayload(purpose);
    expect(saved.meetingType).toBe('IMPORTANT');
    expect(saved.confidentialityChoice).toBe('NON_CONFIDENTIAL');
    expect(saved.exclusiveRequestReason).toBe('临时重要接待');
    expect(saved.auditoriumSetup.seatingLayout).toBe('CLASSROOM');
    expect(saved.serviceRequirements.map((item: any) => item.type)).toEqual(['SIGNAGE', 'OTHER', 'TEA', 'VIDEO']);
    expect(saved.serviceRequirements.map((item: any) => item.details)).toEqual(['东门指引', '嘉宾席卡', undefined, undefined]);
    expect(saved.serviceRequirements[0].fieldValues).toEqual({ notes: '东门指引' });
    expect(saved.serviceRequirements[1].fieldValues).toEqual({ notes: '嘉宾席卡' });
    expect(saved.serviceRequirements.every((item: any) => item.catalogSnapshot?.catalogVersion === 1)).toBe(true);
    expect(errors).toEqual([]);
  });
});

import { readFile } from 'node:fs/promises';
import { test, expect, type Browser, type Page } from '@playwright/test';
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

  test('真实预约表单完成两级审批，并由服务端持久化预约与工单', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '李员工');
    const purpose = `浏览器验收预约 ${Date.now()}`;
    await page.getByRole('button', { name: '空间资源库', exact: true }).click();
    const row = page.locator('tr').filter({ hasText: 'Alpha 战略会议室' });
    await row.getByRole('button', { name: '预约', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '预约Alpha 战略会议室' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: '申请用途' }).fill(purpose);
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
    await expect(owner.page.locator('.status-approved')).toHaveText('已通过');
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

  test('移动端主导航、更多菜单和智能助手均保持可用', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '超级管理员', { width: 390, height: 844 });
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

  test('管理端维护资源园区、发布节点范围、创建代理并查询审计', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '超级管理员');
    const campus = `浏览器验收园区 ${Date.now()}`;

    await page.getByRole('button', { name: '空间资源库', exact: true }).click();
    const resourceRow = page.locator('tr').filter({ hasText: 'Alpha 战略会议室' });
    await resourceRow.getByRole('button', { name: '编辑Alpha 战略会议室', exact: true }).click();
    await page.getByLabel('资源所属园区', { exact: true }).fill(campus);
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/resources/') && response.request().method() === 'PUT' && response.ok()),
      page.getByRole('button', { name: '保存', exact: true }).click()
    ]);
    await expect(resourceRow).toContainText(campus);

    await page.getByRole('button', { name: '系统管理', exact: true }).click();
    await page.getByRole('button', { name: '流程配置', exact: true }).click();
    const nodeCard = page.locator('div.group').filter({ has: page.getByText('行政预审', { exact: true }) });
    await nodeCard.hover();
    await nodeCard.locator('button').nth(2).click();
    await page.getByLabel('市场部', { exact: true }).check();
    await page.getByLabel('审批资源园区范围', { exact: true }).fill(campus);
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/workflow') && response.request().method() === 'PUT' && response.ok()),
      page.getByRole('button', { name: '保存并发布新版本', exact: true }).click()
    ]);
    await expect(nodeCard).toContainText('部门：市场部');
    await expect(nodeCard).toContainText(`园区：${campus}`);

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

    await page.getByRole('button', { name: '运营报表', exact: true }).click();
    await expect(page.getByRole('heading', { name: '利用率与审批效率', exact: true })).toBeVisible();
    await page.getByLabel('报表时间范围', { exact: true }).selectOption('ALL');
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

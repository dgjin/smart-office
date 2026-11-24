import { readFile } from 'node:fs/promises';
import { test, expect, type Browser, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { integrationEnabled, resetTestDb, TestServer } from '../support/testServer.ts';

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
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  await login(page, name);
  return { context, page };
};
const openHq3d = async (page: Page, mobile = false) => {
  if (mobile) {
    await page.getByRole('navigation', { name: '移动端主导航', exact: true }).getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('dialog', { name: '更多功能', exact: true }).getByRole('button', { name: '总部楼层 3D', exact: true }).click();
  } else {
    await page.getByRole('button', { name: '总部楼层 3D', exact: true }).click();
  }
  const frame = page.frameLocator('iframe[title="总部楼层 3D 分布图"]');
  await expect(frame.locator('#scene')).toBeVisible();
  return frame;
};
const exportFromDialog = async (page: Page, hq: ReturnType<Page['frameLocator']>) => {
  const downloaded = page.waitForEvent('download');
  await hq.getByRole('button', { name: '导出 JSON 模板', exact: true }).click();
  const download = await downloaded;
  const path = await download.path();
  expect(path).toBeTruthy();
  return JSON.parse(await readFile(path!, 'utf8'));
};
const exportExcelFromDialog = async (page: Page, hq: ReturnType<Page['frameLocator']>) => {
  const downloaded = page.waitForEvent('download');
  await hq.getByRole('button', { name: '导出 Excel 模板', exact: true }).click();
  const path = await (await downloaded).path();
  expect(path).toBeTruthy();
  return readFile(path!);
};
const uploadBufferAndPreflight = async (page: Page, hq: ReturnType<Page['frameLocator']>, file: { name: string; mimeType: string; buffer: Buffer }) => {
  await hq.locator('#layoutFile').setInputFiles(file);
  const parsed = page.waitForResponse(item => item.url().endsWith('/api/hq3d/layout/parse') && item.request().method() === 'POST' && item.ok());
  const response = page.waitForResponse(item => item.url().endsWith('/api/hq3d/layout/preflight') && item.request().method() === 'POST' && item.ok());
  await hq.getByRole('button', { name: '预检布局变更', exact: true }).click();
  const parsedPayload = await (await parsed).json();
  const preflightPayload = await (await response).json();
  return { parsed: parsedPayload, report: preflightPayload.report };
};
const uploadAndPreflight = async (page: Page, hq: ReturnType<Page['frameLocator']>, layout: unknown, filename: string) =>
  uploadBufferAndPreflight(page, hq, { name: filename, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(layout)) });
type NativeLayout = {
  building: {
    name: string;
    floors: Array<{
      floorNo: number;
      rooms: Array<{ uid: string; no?: string; label: string; lines?: string[] }>;
    }>;
  };
};
const chineseFloor = (floorNo: number) => {
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (floorNo < 10) return digits[floorNo];
  if (floorNo === 10) return '十';
  if (floorNo < 20) return `十${digits[floorNo - 10]}`;
  return `二十${floorNo > 20 ? digits[floorNo - 20] : ''}`;
};
const createNativeFloorplan = async (layout: NativeLayout, withVersions = false) => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('封皮').getCell('B4').value = '999封皮杂值';
  const addFloor = (name: string, floor: NativeLayout['building']['floors'][number], printArea = true) => {
    const sheet = workbook.addWorksheet(name);
    const lastRow = Math.max(25, floor.rooms.length + 4);
    for (let column = 2; column <= 10; column += 1) sheet.getColumn(column).width = 10;
    for (let row = 4; row <= lastRow; row += 1) sheet.getRow(row).height = 20;
    sheet.mergeCells('B1:J2');
    sheet.getCell('B1').value = name;
    floor.rooms.forEach((room, index) => {
      const row = index + 4;
      sheet.mergeCells(`B${row}:D${row}`);
      sheet.getCell(`B${row}`).value = [room.no, ...(room.lines?.length ? room.lines : [room.label])].filter(Boolean).join('\n');
    });
    if (printArea) {
      sheet.getCell('K9').value = '999打印区域外杂值';
      sheet.pageSetup.printArea = `B1:J${lastRow}`;
    }
  };
  const rejectedFloor = { floorNo: 0, rooms: [{ uid: 'rejected', no: '999', label: '不应导入', lines: ['不应导入'] }] };
  for (const floor of layout.building.floors) {
    const baseName = `${layout.building.name}${chineseFloor(floor.floorNo)}层`;
    if (withVersions && floor.floorNo === 2) {
      addFloor(`${baseName} (部分)`, rejectedFloor);
      addFloor(`${baseName}（全）`, floor, false);
    } else if (withVersions && floor.floorNo === 14) {
      addFloor(`${baseName}（旧）`, rejectedFloor);
      addFloor(`${baseName}（新）`, floor, false);
    } else {
      addFloor(baseName, floor);
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
};
const floorImage = async (
  page: Page,
  type: 'png' | 'jpeg',
  room = { no: '999', label: '图片验收室', person: '', background: 'white' }
) => {
  const fixture = await page.context().newPage();
  await fixture.setViewportSize({ width: 900, height: 520 });
  await fixture.setContent(`<!doctype html><html><body style="margin:0;background:#eef3f6;font-family:'PingFang SC','Microsoft YaHei',sans-serif"><main style="padding:36px"><h1 style="font-size:30px;margin:0 0 24px;color:#17324d">${room.no === '413' ? '主楼四层' : '主楼一层'}平面图</h1><div style="width:720px;height:330px;background:${room.background};border:3px solid #64839b;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#132f45"><strong style="font-size:56px">${room.no}</strong><span style="font-size:38px;margin-top:24px">${room.label}</span>${room.person ? `<span style="font-size:32px;margin-top:20px">${room.person}</span>` : ''}</div></main></body></html>`);
  const buffer = await fixture.screenshot({ type, fullPage: true });
  await fixture.close();
  return buffer;
};
const confirmImport = async (page: Page, hq: ReturnType<Page['frameLocator']>) => {
  const response = page.waitForResponse(item => item.url().endsWith('/api/hq3d/layout/import') && item.request().method() === 'POST' && item.ok());
  const reloaded = page.waitForEvent('framenavigated', frame => frame.url().includes('/hq3d.html'));
  await hq.getByRole('button', { name: '确认导入', exact: true }).click();
  await response;
  await expect(hq.locator('#layoutReport')).toContainText('楼层图已更新');
  await reloaded;
  await expect(hq.locator('#layoutOpen')).toBeVisible();
};

test.describe('总部3D布局文件导入浏览器验收', () => {
  test.skip(!integrationEnabled, '仅允许显式隔离 MySQL 测试环境');

  test.beforeAll(async () => {
    await resetTestDb();
    await server.start();
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('管理员可导出整栋模板并完成单层新增、预检、确认和刷新', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '超级管理员');
    const hq = openHq3d(page);
    const frame = await hq;
    await frame.getByRole('button', { name: '导入文件更新楼层图', exact: true }).click();
    const dialog = frame.getByRole('dialog', { name: '导入文件更新楼层图', exact: true });
    await expect(dialog).toBeVisible();

    await frame.getByLabel('更新范围', { exact: true }).selectOption('BUILDING');
    await expect(frame.locator('#layoutFloorField')).toBeHidden();
    const buildingLayout = await exportFromDialog(page, frame);
    expect(buildingLayout.scope.kind).toBe('BUILDING');
    expect(buildingLayout.building.floors.length).toBe(20);

    await frame.getByLabel('更新范围', { exact: true }).selectOption('FLOOR');
    await frame.getByLabel('楼层', { exact: true }).selectOption('1');
    const original = await exportFromDialog(page, frame);
    const changed = structuredClone(original);
    changed.building.floors[0].rooms.push({
      uid: 'e2e#1F#import#临时会议室', no: 'E2E', cat: 'meeting', label: 'E2E临时会议室',
      dept: '验收测试', person: '', notes: '由隔离浏览器测试创建', lines: ['E2E临时会议室'],
      nx: 0.5, nz: 0.5, nw: 0.2, nd: 0.2, frac: 0.04
    });
    await uploadAndPreflight(page, frame, changed, 'main-1f-changed.json');
    await expect(frame.locator('#layoutReport')).toContainText('预检通过');
    await expect(frame.locator('#layoutReport')).toContainText('新增 1F E2E临时会议室');
    await expect(frame.getByRole('button', { name: '确认导入', exact: true })).toBeEnabled();
    await confirmImport(page, frame);
    await frame.locator('#paneTabs [data-pane="rooms"]').click();
    await expect(frame.locator('#roomList .rm').filter({ hasText: 'E2E临时会议室' })).toBeVisible();

    await frame.getByRole('button', { name: '导入文件更新楼层图', exact: true }).click();
    await uploadAndPreflight(page, frame, original, 'main-1f-original.json');
    await expect(frame.locator('#layoutReport')).toContainText('停用 1F E2E临时会议室');
    await confirmImport(page, frame);
    await frame.locator('#paneTabs [data-pane="rooms"]').click();
    await expect(frame.locator('#roomList .rm').filter({ hasText: 'E2E临时会议室' })).toHaveCount(0);
    await context.close();
  });

  test('管理员可用Excel模板新增房间并恢复原布局', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '超级管理员');
    const frame = await openHq3d(page);
    await frame.getByRole('button', { name: '导入文件更新楼层图', exact: true }).click();
    await frame.getByLabel('更新范围', { exact: true }).selectOption('FLOOR');
    await frame.getByLabel('楼层', { exact: true }).selectOption('1');
    const original = await exportFromDialog(page, frame);
    const excel = await exportExcelFromDialog(page, frame);
    expect(excel.subarray(0, 2).toString()).toBe('PK');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excel);
    workbook.getWorksheet('房间')!.addRow([
      1, 'e2e#1F#excel#Excel验收室', 'E3', 'meeting', 'Excel验收室', '验收测试', '', '由隔离浏览器测试创建',
      'Excel验收室', 0.55, 0.5, 0.2, 0.2, 0.04
    ]);
    await uploadBufferAndPreflight(page, frame, {
      name: 'main-1f-changed.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await workbook.xlsx.writeBuffer())
    });
    await expect(frame.locator('#layoutReport')).toContainText('预检通过');
    await expect(frame.locator('#layoutReport')).toContainText('新增 1F Excel验收室');
    await confirmImport(page, frame);
    await frame.locator('#paneTabs [data-pane="rooms"]').click();
    await expect(frame.locator('#roomList .rm').filter({ hasText: 'Excel验收室' })).toBeVisible();

    await frame.getByRole('button', { name: '导入文件更新楼层图', exact: true }).click();
    await uploadAndPreflight(page, frame, original, 'main-1f-before-excel.json');
    await expect(frame.locator('#layoutReport')).toContainText('停用 1F Excel验收室');
    await confirmImport(page, frame);
    await frame.locator('#paneTabs [data-pane="rooms"]').click();
    await expect(frame.locator('#roomList .rm').filter({ hasText: 'Excel验收室' })).toHaveCount(0);
    await context.close();
  });

  test('原生楼层图Excel支持单层与整栋识别、版本选择并保留既有UID', async ({ browser }) => {
    const { context, page } = await openWorkspace(browser, '超级管理员');
    const frame = await openHq3d(page);
    await frame.getByRole('button', { name: '导入文件更新楼层图', exact: true }).click();
    await frame.getByLabel('更新范围', { exact: true }).selectOption('FLOOR');
    await frame.getByLabel('楼层', { exact: true }).selectOption('1');
    const floorLayout = await exportFromDialog(page, frame);
    const floorResult = await uploadBufferAndPreflight(page, frame, {
      name: 'native-main-1f.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await createNativeFloorplan(floorLayout)
    });
    expect(floorResult.parsed.recognizedRooms).toBe(floorLayout.building.floors[0].rooms.length);
    expect(floorResult.parsed.createdRooms).toBe(0);
    expect(floorResult.parsed.layout.building.floors[0].rooms.map((room: { uid: string }) => room.uid).sort())
      .toEqual(floorLayout.building.floors[0].rooms.map((room: { uid: string }) => room.uid).sort());
    expect(floorResult.report.ok).toBe(true);
    expect(floorResult.report.counts.created).toBe(0);
    expect(floorResult.report.counts.retired).toBe(0);
    expect(floorResult.parsed.layout.building.floors[0].rooms.some((room: { no?: string }) => room.no === '999')).toBe(false);
    await expect(frame.locator('#layoutReport')).toContainText('已按原生楼层图Excel识别1个楼层');
    await expect(frame.locator('#layoutReport')).toContainText('打印区域、合并单元格、行高和列宽');

    await frame.getByLabel('更新范围', { exact: true }).selectOption('BUILDING');
    const buildingLayout = await exportFromDialog(page, frame);
    const buildingResult = await uploadBufferAndPreflight(page, frame, {
      name: 'native-main-building.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await createNativeFloorplan(buildingLayout, true)
    });
    expect(buildingResult.parsed.layout.building.floors).toHaveLength(20);
    expect(buildingResult.parsed.layout.building.floors.find((floor: { floorNo: number }) => floor.floorNo === 2).sheet).toBe('主楼二层（全）');
    expect(buildingResult.parsed.layout.building.floors.find((floor: { floorNo: number }) => floor.floorNo === 14).sheet).toBe('主楼十四层（新）');
    expect(buildingResult.parsed.createdRooms).toBe(0);
    expect(buildingResult.report.ok).toBe(true);
    expect(buildingResult.report.counts.created).toBe(0);
    expect(buildingResult.report.counts.retired).toBe(0);
    expect(buildingResult.parsed.layout.building.floors.flatMap((floor: { rooms: Array<{ uid: string }> }) => floor.rooms.map(room => room.uid)).sort())
      .toEqual(buildingLayout.building.floors.flatMap((floor: { rooms: Array<{ uid: string }> }) => floor.rooms.map(room => room.uid)).sort());
    await expect(frame.locator('#layoutReport')).toContainText('2F选用“主楼二层（全）”');
    await expect(frame.locator('#layoutReport')).toContainText('14F选用“主楼十四层（新）”');
    await context.close();
  });

  test('黄色背景图片中的既有房间多行文字变化进入预检并保留UID', async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await openWorkspace(browser, '超级管理员');
    const frame = await openHq3d(page);
    await frame.getByRole('button', { name: '导入文件更新楼层图', exact: true }).click();
    await frame.getByLabel('更新范围', { exact: true }).selectOption('FLOOR');
    await frame.getByLabel('楼层', { exact: true }).selectOption('4');
    const buffer = await floorImage(page, 'png', { no: '413', label: '机构管理部', person: '侯强', background: '#fff200' });
    const result = await uploadBufferAndPreflight(page, frame, { name: 'main-4f-text-changed.png', mimeType: 'image/png', buffer });
    const room = result.parsed.layout.building.floors[0].rooms.find((item: { no?: string }) => item.no === '413');
    expect(room.uid).toBe('main#4F#413#业务二部');
    expect(room.label).toBe('机构管理部');
    expect(room.dept).toBe('机构管理部');
    expect(room.person).toBe('侯强');
    expect(room.lines).toEqual(['413', '机构管理部', '侯强']);
    expect(result.parsed.createdRooms).toBe(0);
    expect(result.report.counts.created).toBe(0);
    expect(result.report.counts.updated).toBe(1);
    await expect(frame.locator('#layoutReport')).toContainText('修改 4F 机构管理部');
    await expect(frame.locator('#layoutReport')).toContainText('识别文字会进入预检');
    await context.close();
  });

  test('真实PNG和JPEG经本地OCR生成候选，保留漏识别房间并可确认清理', async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await openWorkspace(browser, '超级管理员');
    const frame = await openHq3d(page);
    await frame.getByRole('button', { name: '导入文件更新楼层图', exact: true }).click();
    await frame.getByLabel('更新范围', { exact: true }).selectOption('FLOOR');
    await frame.getByLabel('楼层', { exact: true }).selectOption('1');
    const original = await exportFromDialog(page, frame);
    await uploadBufferAndPreflight(page, frame, { name: 'main-1f.png', mimeType: 'image/png', buffer: await floorImage(page, 'png') });
    await expect(frame.locator('#layoutReport')).toContainText('新增候选1间');
    await expect(frame.locator('#layoutReport')).toContainText('不会因漏识别而停用');
    await expect(frame.locator('#layoutReport')).toContainText('新增 1F 999 图片验收室');
    await confirmImport(page, frame);
    await frame.locator('#paneTabs [data-pane="rooms"]').click();
    await expect(frame.locator('#roomList .rm').filter({ hasText: '999 图片验收室' })).toBeVisible();

    await frame.getByRole('button', { name: '导入文件更新楼层图', exact: true }).click();
    await uploadBufferAndPreflight(page, frame, { name: 'main-1f.jpg', mimeType: 'image/jpeg', buffer: await floorImage(page, 'jpeg') });
    await expect(frame.locator('#layoutReport')).toContainText('新增候选0间');
    await expect(frame.locator('#layoutReport')).toContainText('无需导入');
    await expect(frame.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();

    await uploadAndPreflight(page, frame, original, 'main-1f-before-image.json');
    await expect(frame.locator('#layoutReport')).toContainText('停用 1F 999 图片验收室');
    await confirmImport(page, frame);
    await frame.locator('#paneTabs [data-pane="rooms"]').click();
    await expect(frame.locator('#roomList .rm').filter({ hasText: '999 图片验收室' })).toHaveCount(0);
    await context.close();
  });

  test('移动端可使用导出与预检，非管理员不显示布局导入入口', async ({ browser }) => {
    const mobile = await openWorkspace(browser, '超级管理员', { width: 375, height: 812 });
    const frame = await openHq3d(mobile.page, true);
    await frame.getByRole('button', { name: '导入文件更新楼层图', exact: true }).click();
    const dialog = frame.getByRole('dialog', { name: '导入文件更新楼层图', exact: true });
    await expect(dialog).toBeVisible();
    const exported = await exportFromDialog(mobile.page, frame);
    await uploadAndPreflight(mobile.page, frame, exported, 'mobile-unchanged.json');
    await expect(frame.locator('#layoutReport')).toContainText('无需导入');
    await expect(frame.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();
    expect(await frame.locator('html').evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await mobile.context.close();

    const employee = await openWorkspace(browser, '李员工');
    const employeeFrame = await openHq3d(employee.page);
    await expect(employeeFrame.locator('#layoutOpen')).toBeHidden();
    await expect(employeeFrame.locator('#layoutDialog')).toHaveCount(1);
    await employee.context.close();
  });
});

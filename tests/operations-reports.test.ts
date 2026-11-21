import test from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import type { Booking, BookingUsageFact, CheckInEvent, Resource, User, WorkOrder } from '../types.ts';
import type { OfficeDb } from '../server/tools.ts';
import {
  buildOperationsReport,
  operationsReportCsv,
  spreadsheetText,
  writeOperationsReportXlsx
} from '../server/reports.ts';

const iso = (day: number, hour = 0, minute = 0) => new Date(2026, 0, day, hour, minute).toISOString();
const START = iso(10);
const END = iso(11);

const user = (overrides: Partial<User> = {}): User => ({
  id: 'u1', name: '张三', email: 'zhang@example.com', role: ['EMPLOYEE'], department: '工程部', ...overrides
});
const resource = (overrides: Partial<Resource> = {}): Resource => ({
  id: 'r-small', name: '海棠会议室', type: 'ROOM', capacity: 8, location: '1号楼 3层', building: 'MAIN', floor: 3,
  roomCategory: 'SMALL', features: [], status: 'AVAILABLE', ...overrides
});
const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'b-early', userId: 'u1', resourceId: 'r-small', type: 'ROOM', startTime: iso(10, 9), endTime: iso(10, 11),
  status: 'COMPLETED', purpose: '项目复盘', participants: 4, createdAt: iso(9, 9), currentNodeIndex: 1,
  approvalHistory: [], attendeeIds: ['u2'], meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL', scheduleVersion: 1,
  ...overrides
});
const workOrder = (overrides: Partial<WorkOrder> = {}): WorkOrder => ({
  id: 'wo-tea', bookingId: 'b-early', type: 'TEA', title: '项目复盘茶水', assigneeRole: 'SERVICE_COORDINATOR',
  status: 'DONE', createdAt: iso(9, 10), scheduleVersion: 1, costAmount: 12.5, ...overrides
});
const checkIn = (overrides: Partial<CheckInEvent> = {}): CheckInEvent => ({
  id: 'ci-1', bookingId: 'b-early', subjectUserId: 'u1', operatorId: 'u1', source: 'QR', action: 'CHECK_IN',
  checkedInAt: iso(10, 9, 4), createdAt: iso(10, 9, 4), ...overrides
});
const usageFact = (overrides: Partial<BookingUsageFact> = {}): BookingUsageFact => ({
  bookingId: 'b-early', scheduleVersion: 1, scheduledStartTime: iso(10, 9), scheduledEndTime: iso(10, 11),
  scheduledMinutes: 120, actualStartTime: iso(10, 9, 5), actualEndTime: iso(10, 9, 55), actualMinutes: 50,
  source: 'CHECK_IN', revision: 1, ...overrides
});

const makeDb = (): OfficeDb => {
  const fact = usageFact();
  return {
    users: [
      user({ id: 'admin', name: '系统管理员', role: ['SYSTEM_ADMIN'], department: '管理部' }),
      user(),
      user({ id: 'u2', name: '李四', department: '市场部' })
    ],
    resources: [
      resource(),
      resource({ id: 'r-medium', name: '配楼玉兰厅', location: '2号楼 2层', building: 'ANNEX', floor: 2, roomCategory: 'MEDIUM', capacity: 20 }),
      resource({ id: 'r-desk', name: '开放工位 A01', type: 'DESK', location: '1号楼 4层', floor: 4, roomCategory: undefined })
    ],
    bookings: [
      booking({ actualStartTime: fact.actualStartTime, actualEndTime: fact.actualEndTime, endedEarlyAt: fact.actualEndTime }),
      booking({
        id: 'b-pending-usage', userId: 'u2', resourceId: 'r-medium', purpose: '市场沟通会', status: 'APPROVED',
        startTime: iso(10, 13), endTime: iso(10, 14), attendeeIds: []
      }),
      booking({
        id: 'b-no-show', resourceId: 'r-desk', type: 'DESK', purpose: '临时办公', status: 'CANCELLED',
        startTime: iso(10, 18, 30), endTime: iso(10, 19), noShow: true, releaseType: 'NO_SHOW', attendeeIds: []
      }),
      booking({
        id: 'b-confidential', userId: 'u2', resourceId: 'r-small', purpose: '机密项目真实名称', meetingType: 'CONFIDENTIAL',
        confidentialityChoice: 'CONFIDENTIAL', startTime: iso(10, 15), endTime: iso(10, 16), attendeeIds: []
      })
    ],
    workOrders: [
      workOrder(),
      workOrder({ id: 'wo-video', type: 'VIDEO', title: '项目复盘视频保障', costAmount: 20 })
    ],
    checkInEvents: [
      checkIn(),
      checkIn({ id: 'ci-2', subjectUserId: 'u2', operatorId: 'u1', checkedInAt: iso(10, 9, 6), createdAt: iso(10, 9, 6) }),
      checkIn({ id: 'ci-3', subjectUserId: 'u2', operatorId: 'admin', source: 'CORRECTION', action: 'REVOKE', checkedInAt: undefined, createdAt: iso(10, 9, 20), reason: '误签到' }),
      checkIn({ id: 'ci-4', subjectUserId: 'u1', operatorId: 'admin', source: 'CORRECTION', action: 'CORRECT', checkedInAt: iso(10, 9, 5), createdAt: iso(10, 9, 25), supersedesId: 'ci-1' })
    ],
    usageFacts: [fact]
  };
};

const buildReport = (db = makeDb()) => buildOperationsReport(db, db.users![0], START, END, 42);
const row = (report: ReturnType<typeof buildReport>, dimension: string, id: string) =>
  report.rows.find(item => item.dimension === dimension && item.id === id);

const xlsxBuffer = async (report: ReturnType<typeof buildReport>) => {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', chunk => chunks.push(Buffer.from(chunk)));
  await writeOperationsReportXlsx(report, output as unknown as ServerResponse);
  return Buffer.concat(chunks);
};

test('多维报表先过滤涉密预约，再对账计划、签到、实际使用和服务', () => {
  const report = buildReport();
  assert.equal(report.revision, 42);
  assert.equal(report.overall.bookingCount, 3);
  assert.equal(report.overall.scheduledHours, 3.5);
  assert.equal(report.overall.actualHours, 0.8);
  assert.equal(report.overall.usageHours, 1.8);
  assert.equal(report.overall.checkedInCount, 1);
  assert.equal(report.overall.earlyEndCount, 1);
  assert.equal(report.overall.serviceOrderCount, 2);
  assert.equal(report.overall.serviceCost, 32.5);
  assert.deepEqual(new Set(report.rows.map(item => item.dimension)), new Set([
    'RESOURCE', 'BUILDING_FLOOR', 'RESOURCE_TYPE', 'ROOM_CATEGORY', 'TIME_SLOT', 'DEPARTMENT', 'SERVICE', 'USAGE'
  ]));
  assert.equal(report.bookings.some(item => item.id === 'b-confidential'), false);
  assert.equal(JSON.stringify(report).includes('机密项目真实名称'), false);

  const early = report.bookings.find(item => item.id === 'b-early')!;
  assert.equal(early.scheduledMinutes, 120);
  assert.equal(early.actualMinutes, 50);
  assert.equal(early.earlyEndMinutes, 65);
  assert.equal(early.checkInCount, 1);
  assert.equal(early.firstCheckInAt, iso(10, 9, 5));
  assert.equal(early.serviceOrderCount, 2);
  assert.equal(early.serviceCost, 32.5);
  assert.equal(early.reconciliationStatus, '提前结束');
  assert.equal(report.bookings.find(item => item.id === 'b-pending-usage')?.reconciliationStatus, '待确认实际使用');
  assert.equal(report.bookings.find(item => item.id === 'b-no-show')?.reconciliationStatus, '未签到释放');

  assert.equal(row(report, 'BUILDING_FLOOR', '1号楼 3层')?.bookingCount, 1);
  assert.equal(row(report, 'RESOURCE_TYPE', 'DESK')?.bookingCount, 1);
  assert.equal(row(report, 'ROOM_CATEGORY', 'MEDIUM')?.bookingCount, 1);
  assert.equal(row(report, 'TIME_SLOT', '08:00-12:00')?.bookingCount, 1);
  assert.equal(row(report, 'DEPARTMENT', '工程部')?.bookingCount, 2);
  assert.equal(row(report, 'SERVICE', 'TEA')?.serviceCost, 12.5);
  assert.equal(row(report, 'SERVICE', 'VIDEO')?.serviceOrderCount, 1);
  assert.equal(row(report, 'USAGE', '提前结束')?.actualHours, 0.8);
  assert.equal(report.checkIns.length, 4);
  assert.equal(report.services.length, 2);
});

test('对账识别独立事实不一致、使用事实缺口和签到事实缺口', () => {
  const inconsistent = makeDb();
  inconsistent.bookings = [inconsistent.bookings![0]];
  inconsistent.bookings[0].actualStartTime = iso(10, 9, 10);
  assert.equal(buildReport(inconsistent).bookings[0].reconciliationStatus, '事实不一致');

  const missingUsage = makeDb();
  missingUsage.bookings = [missingUsage.bookings![0]];
  missingUsage.usageFacts = [];
  const missingUsageRow = buildReport(missingUsage).bookings[0];
  assert.equal(missingUsageRow.reconciliationStatus, '使用事实缺口');
  assert.equal(missingUsageRow.actualMinutes, 50);

  const missingCheckIn = makeDb();
  missingCheckIn.bookings = [missingCheckIn.bookings![0]];
  missingCheckIn.checkInEvents = [];
  assert.equal(buildReport(missingCheckIn).bookings[0].reconciliationStatus, '签到事实缺口');
});

test('获授权读取涉密预约时仍只导出遮蔽主题和会务标题', () => {
  const db = makeDb();
  db.confidentialAccessGrants = [{ id: 'grant-1', bookingId: 'b-confidential', userId: 'admin', access: 'SECURITY', grantedBy: 'admin', grantedAt: iso(9) }];
  db.workOrders!.push(workOrder({ id: 'wo-secret', bookingId: 'b-confidential', title: '机密项目真实名称会务', costAmount: 30 }));
  const report = buildReport(db);
  assert.equal(report.bookings.find(item => item.id === 'b-confidential')?.purpose, '涉密会议');
  assert.equal(report.services.find(item => item.id === 'wo-secret')?.title, '涉密会议会务服务');
  assert.equal(JSON.stringify(report).includes('机密项目真实名称'), false);
});

test('CSV 保留中文、BOM 与 CRLF，并中和公式前缀而不改数值符号', () => {
  assert.equal(spreadsheetText(' =1+1'), "' =1+1");
  assert.equal(spreadsheetText('+SUM(A1:A2)'), "'+SUM(A1:A2)");
  assert.equal(spreadsheetText('-2+3'), "'-2+3");
  assert.equal(spreadsheetText('@cmd'), "'@cmd");
  assert.equal(spreadsheetText('项目复盘'), '项目复盘');
  const report = buildReport();
  report.rows[0].name = '  =1+1,"东区"';
  report.overall.serviceCost = -1;
  const csv = operationsReportCsv(report);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.equal(csv.replace(/\r\n/g, '').includes('\n'), false);
  assert.match(csv, /项目|全公司/);
  assert.match(csv, /工程部/);
  assert.match(csv, /"'  =1\+1,""东区"""/);
  assert.match(csv, /,"-1"\r\n/);
  assert.doesNotMatch(csv, /,"'-1"/);
});

test('XLSX 回读六个工作表、中文时间和公式安全文本', async () => {
  const report = buildReport();
  report.bookings[0].purpose = '=2+2';
  const buffer = await xlsxBuffer(report);
  assert.ok(buffer.length > 10_000);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['多维汇总', '预约对账', '签到明细', '服务明细', '差异清单', '导出说明']);
  assert.equal(workbook.getWorksheet('预约对账')!.rowCount, report.bookings.length + 1);
  assert.equal(workbook.getWorksheet('签到明细')!.rowCount, report.checkIns.length + 1);
  assert.equal(workbook.getWorksheet('服务明细')!.rowCount, report.services.length + 1);
  assert.equal(workbook.getWorksheet('差异清单')!.rowCount, report.differences.length + 1);
  const bookingSheet = workbook.getWorksheet('预约对账')!;
  assert.equal(bookingSheet.getCell('B2').value, "'=2+2");
  assert.equal(typeof bookingSheet.getCell('B2').value, 'string');
  assert.match(String(bookingSheet.getCell('J2').value), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(workbook.getWorksheet('导出说明')!.getCell('B5').value, 42);
});

test('5000 条预约可构建并逐行流式导出，回读首尾记录完整', async () => {
  const db = makeDb();
  const template = db.bookings![0];
  db.bookings = Array.from({ length: 5000 }, (_, index) => ({ ...template, id: `bulk-${index}`, purpose: `批量会议 ${index}` }));
  db.workOrders = [];
  db.checkInEvents = [];
  db.usageFacts = [];
  const report = buildReport(db);
  assert.equal(report.bookings.length, 5000);
  const buffer = await xlsxBuffer(report);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('预约对账')!;
  assert.equal(sheet.rowCount, 5001);
  assert.equal(sheet.getCell('A2').value, 'bulk-0');
  assert.equal(sheet.getCell('A5001').value, 'bulk-4999');
  assert.equal(sheet.getCell('B5001').value, '批量会议 4999');
});

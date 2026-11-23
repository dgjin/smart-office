import type { ServerResponse } from 'node:http';
import ExcelJS from 'exceljs';
import type {
  Booking,
  CheckInEvent,
  OperationsBookingReport,
  OperationsReport,
  OperationsReportRow,
  OperationsSupplyReport,
  Resource,
  User,
  WorkOrder
} from '../types.ts';
import { canReadBookingDetails, isConfidentialBooking } from './confidentiality.ts';
import { readSnapshot } from './db.ts';
import { DbError } from './errors.ts';
import type { OfficeDb } from './tools.ts';
import { getResourceBuilding, getResourceFloor } from '../utils/resourceDomain.ts';
import { SERVICE_TYPE_LABELS } from '../constants.ts';
import { BOOKING_DISPLAY_STATUS_LABELS, getBookingDisplayStatus } from '../utils/bookingRules.ts';
import {
  buildReportRow,
  generateReport,
  openingMinutesWithin,
  type ReportDimension,
  type ReportRow
} from '../utils/reports.ts';

const MINUTE_MS = 60000;
const SERVICE_LABELS = SERVICE_TYPE_LABELS;
const DIMENSION_LABELS: Record<OperationsReportRow['dimension'], string> = {
  OVERALL: '整体', RESOURCE: '资源', BUILDING_FLOOR: '楼栋楼层', RESOURCE_TYPE: '资源类型', ROOM_CATEGORY: '会议室类型',
  TIME_SLOT: '时段', DEPARTMENT: '部门', SERVICE: '服务', USAGE: '实际使用'
};
const STATUS_LABELS: Record<Booking['status'], string> = { PENDING: '待审批', APPROVED: '已核准', REJECTED: '已驳回', COMPLETED: '已完成', CANCELLED: '已取消' };
const round = (value: number) => Number(value.toFixed(1));
const timeValue = (value?: string) => value ? Date.parse(value) : Number.NaN;
const clippedMinutes = (startValue: string | undefined, endValue: string | undefined, rangeStart: number, rangeEnd: number) => {
  const start = Math.max(rangeStart, timeValue(startValue));
  const end = Math.min(rangeEnd, timeValue(endValue));
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) / MINUTE_MS : 0;
};
const fullMinutes = (startValue?: string, endValue?: string) => {
  const start = timeValue(startValue);
  const end = timeValue(endValue);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / MINUTE_MS)) : 0;
};
const localDateTime = (value?: string) => {
  if (!value || !Number.isFinite(timeValue(value))) return '';
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
const timeSlot = (value: string) => {
  const hour = new Date(value).getHours();
  if (hour >= 8 && hour < 12) return '08:00-12:00';
  if (hour >= 12 && hour < 18) return '12:00-18:00';
  if (hour >= 18) return '18:00-24:00';
  return '00:00-08:00';
};
const floorLabel = (resource: Resource) => `${getResourceBuilding(resource) === 'ANNEX' ? '2号楼' : '1号楼'} ${getResourceFloor(resource) ?? '未设置'}层`;
const roomCategoryLabel = (resource: Resource) => ({ SMALL: '小型会议室', MEDIUM: '中型会议室', LARGE: '大型会议室', AUDITORIUM: '礼堂' } as const)[resource.roomCategory || 'SMALL'];
const activeCheckIns = (events: CheckInEvent[]) => {
  const bySubject = new Map<string, CheckInEvent>();
  for (const event of [...events].sort((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt))) {
    if (event.action === 'REVOKE') bySubject.delete(event.subjectUserId);
    else bySubject.set(event.subjectUserId, event);
  }
  return [...bySubject.values()];
};
const usageCategory = (booking: OperationsBookingReport) => {
  if (booking.noShow) return '未签到释放';
  if (booking.earlyEndMinutes > 0) return '提前结束';
  if (booking.actualMinutes > 0) return '正常使用';
  if (booking.releaseType === 'UNUSED_CONFIRMED') return '确认未使用';
  if (booking.status === 'CANCELLED') return '已取消';
  if (booking.status === 'REJECTED') return '已驳回';
  if (booking.status === 'PENDING') return '待审批';
  return '待确认使用';
};
const ordersFor = (orders: WorkOrder[], bookings: Booking[]) => {
  const ids = new Set(bookings.map(booking => booking.id));
  return orders.filter(order => ids.has(order.bookingId));
};
const buildSupplyRows = (orders: WorkOrder[], bookingById: Map<string, Booking>): OperationsSupplyReport[] => {
  type SupplyGroup = Omit<OperationsSupplyReport, 'orderCount'> & { orderIds: Set<string> };
  const groups = new Map<string, SupplyGroup>();
  for (const order of orders) {
    const booking = bookingById.get(order.bookingId);
    const snapshot = order.requirementSnapshot;
    const catalog = snapshot?.catalogSnapshot;
    const fieldValues = snapshot?.fieldValues || {};
    if (!booking || !catalog) continue;
    for (const field of catalog.fields) {
      if (field.type !== 'NUMBER' || field.key === 'estimatedCost') continue;
      const raw = fieldValues[field.key]?.trim();
      const quantity = raw ? Number(raw) : Number.NaN;
      if (!Number.isFinite(quantity) || quantity < 0) continue;
      const unit = field.key === 'quantity' ? fieldValues.unit || '未设置单位' : field.key === 'servings' ? '份' : '未设置单位';
      const slot = timeSlot(booking.startTime);
      const key = [order.type, catalog.catalogItemId, catalog.catalogVersion, field.key, unit, slot].join(':');
      const current = groups.get(key) || {
        serviceType: order.type,
        serviceName: catalog.name,
        catalogItemId: catalog.catalogItemId,
        catalogVersion: catalog.catalogVersion,
        quantityField: field.key,
        quantityLabel: field.label,
        unit,
        timeSlot: slot,
        quantity: 0,
        orderIds: new Set<string>(),
        todoCount: 0,
        pendingInfoCount: 0,
        inProgressCount: 0,
        doneCount: 0,
        cancelledCount: 0,
        exceptionCount: 0
      };
      current.quantity += quantity;
      current.orderIds.add(order.id);
      if (order.status === 'TODO') current.todoCount += 1;
      else if (order.status === 'PENDING_INFO') current.pendingInfoCount += 1;
      else if (order.status === 'IN_PROGRESS') current.inProgressCount += 1;
      else if (order.status === 'DONE') current.doneCount += 1;
      else if (order.status === 'CANCELLED') current.cancelledCount += 1;
      else current.exceptionCount += 1;
      groups.set(key, current);
    }
  }
  return [...groups.values()].map(({ orderIds, ...group }) => ({
    ...group,
    quantity: Number(group.quantity.toFixed(2)),
    orderCount: orderIds.size
  })).sort((a, b) => a.serviceName.localeCompare(b.serviceName, 'zh-CN')
    || a.catalogVersion - b.catalogVersion || a.timeSlot.localeCompare(b.timeSlot) || a.unit.localeCompare(b.unit, 'zh-CN'));
};
const enrichRow = (base: ReportRow, bookings: OperationsBookingReport[], orders: WorkOrder[]): OperationsReportRow => ({
  ...base,
  scheduledHours: round(bookings.reduce((sum, booking) => sum + booking.scheduledMinutes, 0) / 60),
  actualHours: round(bookings.reduce((sum, booking) => sum + booking.actualMinutes, 0) / 60),
  checkedInCount: bookings.filter(booking => booking.checkInCount > 0).length,
  earlyEndCount: bookings.filter(booking => booking.earlyEndMinutes > 0).length,
  serviceOrderCount: orders.length,
  serviceCost: round(orders.reduce((sum, order) => sum + (order.costAmount || 0), 0))
});

export const spreadsheetText = (value: unknown) => {
  const text = String(value ?? '');
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
};
const csvCell = (value: unknown) => {
  const text = typeof value === 'string' ? spreadsheetText(value) : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
};

const supplyHeaders = ['服务类型', '目录名称', '目录ID', '目录版本', '数量字段', '数量名称', '单位', '时段', '需求量', '工单数', '待办', '待补充', '进行中', '已完成', '已取消', '异常'];
const supplyRow = (row: OperationsSupplyReport) => [
  SERVICE_LABELS[row.serviceType], row.serviceName, row.catalogItemId, row.catalogVersion, row.quantityField, row.quantityLabel,
  row.unit, row.timeSlot, row.quantity, row.orderCount, row.todoCount, row.pendingInfoCount, row.inProgressCount,
  row.doneCount, row.cancelledCount, row.exceptionCount
];

export const operationsReportCsv = (report: OperationsReport) => {
  const rows = [report.overall, ...report.rows];
  const output: unknown[][] = [
    ['维度', '名称', '预约数', '使用小时', '使用率(%)', '取消率(%)', 'No-show率(%)', '驳回率(%)', '平均审批时长(小时)', '计划小时', '实际小时', '签到预约数', '提前结束数', '服务工单数', '服务成本(元)'],
    ...rows.map(row => [DIMENSION_LABELS[row.dimension], row.name, row.bookingCount, row.usageHours, row.utilization, row.cancellationRate, row.noShowRate, row.rejectionRate, row.averageApprovalHours, row.scheduledHours, row.actualHours, row.checkedInCount, row.earlyEndCount, row.serviceOrderCount, row.serviceCost])
  ];
  if (report.supplies.length) output.push([], ['备料统计'], supplyHeaders, ...report.supplies.map(supplyRow));
  return '\uFEFF' + output.map(row => row.map(csvCell).join(',')).join('\r\n');
};

export const buildOperationsReport = (db: OfficeDb, actor: User, startValue: string, endValue: string, revision = 0): OperationsReport => {
  const generatedAt = new Date();
  const rangeStart = timeValue(startValue);
  const rangeEnd = timeValue(endValue);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) throw new DbError('INVALID_REPORT_RANGE', 400);
  const start = new Date(rangeStart).toISOString();
  const end = new Date(rangeEnd).toISOString();
  const resources = db.resources || [];
  const users = db.users || [];
  const resourceById = new Map(resources.map(resource => [resource.id, resource]));
  const userById = new Map(users.map(user => [user.id, user]));
  const scoped = (db.bookings || []).filter(booking => canReadBookingDetails(db, booking, actor));
  const relevant = scoped.filter(booking => timeValue(booking.startTime) < rangeEnd
    && timeValue(booking.actualEndTime || booking.endedEarlyAt || booking.endTime) > rangeStart);
  const relevantById = new Map(relevant.map(booking => [booking.id, booking]));
  const groupByBooking = <T extends { bookingId: string }>(items: T[]) => {
    const groups = new Map<string, T[]>();
    for (const item of items) {
      const group = groups.get(item.bookingId);
      if (group) group.push(item);
      else groups.set(item.bookingId, [item]);
    }
    return groups;
  };
  const allOrders = (db.workOrders || []).filter(order => relevantById.has(order.bookingId)
    && (order.scheduleVersion || 1) === (relevantById.get(order.bookingId)?.scheduleVersion || 1));
  const allEvents = (db.checkInEvents || []).filter(event => relevantById.has(event.bookingId));
  const ordersByBooking = groupByBooking(allOrders);
  const eventsByBooking = groupByBooking(allEvents);
  const factsBySchedule = new Map((db.usageFacts || []).map(fact => [`${fact.bookingId}:${fact.scheduleVersion}`, fact]));
  const details = relevant.map((booking): OperationsBookingReport => {
    const resource = resourceById.get(booking.resourceId);
    const requester = userById.get(booking.userId);
    const events = eventsByBooking.get(booking.id) || [];
    const active = activeCheckIns(events);
    const orders = ordersByBooking.get(booking.id) || [];
    const fact = factsBySchedule.get(`${booking.id}:${booking.scheduleVersion || 1}`);
    const actualStartTime = fact?.actualStartTime || booking.actualStartTime;
    const actualEndTime = fact?.actualEndTime || booking.actualEndTime || booking.endedEarlyAt;
    const actualMinutes = fact?.actualMinutes ?? fullMinutes(actualStartTime, actualEndTime);
    const scheduledMinutes = fullMinutes(booking.startTime, booking.endTime);
    const earlyEndMinutes = actualEndTime ? Math.max(0, scheduledMinutes - fullMinutes(booking.startTime, actualEndTime)) : 0;
    const checkInTimes = active.map(event => event.checkedInAt || event.createdAt).filter(value => Number.isFinite(timeValue(value))).sort();
    let reconciliationStatus = '一致';
    let reconciliationNote = '预约、签到、实际使用和服务记录相符。';
    if (booking.noShow) {
      reconciliationStatus = '未签到释放';
      reconciliationNote = booking.releaseReason || '预约已按未签到规则释放。';
    } else if (fact && ((fact.actualStartTime || '') !== (booking.actualStartTime || '') || (fact.actualEndTime || '') !== (booking.actualEndTime || booking.endedEarlyAt || ''))) {
      reconciliationStatus = '事实不一致';
      reconciliationNote = '独立使用事实与预约冗余字段不一致，以使用事实为准。';
    } else if (active.length && !fact) {
      reconciliationStatus = '使用事实缺口';
      reconciliationNote = '存在有效签到，但当前排期版本没有实际使用事实。';
    } else if (!active.length && fact?.source === 'CHECK_IN' && actualMinutes > 0) {
      reconciliationStatus = '签到事实缺口';
      reconciliationNote = '使用事实来源为签到，但未找到有效签到事件。';
    } else if (earlyEndMinutes > 0) {
      reconciliationStatus = '提前结束';
      reconciliationNote = `较计划提前 ${earlyEndMinutes} 分钟结束，实际时长已单独对账。`;
    } else if (['CANCELLED', 'REJECTED'].includes(booking.status)) {
      reconciliationStatus = '无需使用事实';
      reconciliationNote = STATUS_LABELS[booking.status];
    } else if (timeValue(booking.endTime) > generatedAt.getTime()) {
      reconciliationStatus = '未到使用结算';
      reconciliationNote = '会议尚未到实际使用结算时点。';
    } else if (!fact) {
      reconciliationStatus = '待确认实际使用';
      reconciliationNote = '会议已结束，等待签到或实际使用确认。';
    } else if (actualStartTime && !actualEndTime) {
      reconciliationStatus = booking.status === 'APPROVED' ? '待结算' : '事实异常';
      reconciliationNote = booking.status === 'APPROVED'
        ? '会议已到计划结束时间，等待正常结算任务写入实际结束事实。'
        : '预约已有实际开始事实但缺少实际结束时间，请核查状态与使用事实。';
    }
    return {
      id: booking.id,
      purpose: isConfidentialBooking(booking) ? '涉密会议' : booking.purpose,
      requester: requester?.name || booking.userId,
      department: requester?.department || booking.requesterDepartmentId || '未设置部门',
      resource: resource?.name || booking.resourceId,
      buildingFloor: resource ? floorLabel(resource) : '未关联资源',
      resourceType: resource?.type === 'DESK' ? '工位' : '会议室',
      timeSlot: timeSlot(booking.startTime),
      status: booking.status,
      displayStatus: getBookingDisplayStatus(booking, generatedAt),
      startTime: booking.startTime,
      endTime: booking.endTime,
      scheduledMinutes: Math.round(clippedMinutes(booking.startTime, booking.endTime, rangeStart, rangeEnd)),
      checkInCount: active.length,
      firstCheckInAt: checkInTimes[0],
      actualStartTime,
      actualEndTime,
      actualMinutes: Math.round(clippedMinutes(actualStartTime, actualEndTime, rangeStart, rangeEnd) || (fact && rangeStart <= timeValue(booking.startTime) && timeValue(booking.startTime) < rangeEnd ? actualMinutes : 0)),
      earlyEndMinutes,
      noShow: Boolean(booking.noShow),
      releaseType: booking.releaseType,
      serviceOrderCount: orders.length,
      serviceCost: round(orders.reduce((sum, order) => sum + (order.costAmount || 0), 0)),
      reconciliationStatus,
      reconciliationNote
    };
  });
  const detailById = new Map(details.map(detail => [detail.id, detail]));
  const detailsFor = (bookings: Booking[]) => bookings.map(booking => detailById.get(booking.id)).filter((item): item is OperationsBookingReport => Boolean(item));
  const legacy = generateReport(relevant, resources, users, { start, end });
  const capacityMinutes = openingMinutesWithin(rangeStart, rangeEnd, { start: '08:00', end: '20:00' });
  const dimensionRow = (dimension: ReportDimension, id: string, name: string, bookings: Booking[], resourceCount: number) => enrichRow(
    buildReportRow(dimension, id, name, bookings, resourceCount, rangeStart, rangeEnd, capacityMinutes, { start: '08:00', end: '20:00' }),
    detailsFor(bookings), ordersFor(allOrders, bookings)
  );
  const overall = enrichRow(legacy.overall, details, allOrders);
  const resourceRows = legacy.rows.filter(row => row.dimension === 'RESOURCE').map(row => {
    const bookings = relevant.filter(booking => booking.resourceId === row.id);
    return enrichRow(row, detailsFor(bookings), ordersFor(allOrders, bookings));
  });
  const departmentRows = legacy.rows.filter(row => row.dimension === 'DEPARTMENT').map(row => {
    const ids = new Set(users.filter(user => user.department === row.id).map(user => user.id));
    const bookings = relevant.filter(booking => ids.has(booking.userId));
    return enrichRow(row, detailsFor(bookings), ordersFor(allOrders, bookings));
  });
  const floorGroups = new Map<string, Resource[]>();
  for (const resource of resources) {
    const key = floorLabel(resource);
    floorGroups.set(key, [...(floorGroups.get(key) || []), resource]);
  }
  const floorRows = [...floorGroups].map(([name, group]) => {
    const ids = new Set(group.map(resource => resource.id));
    return dimensionRow('BUILDING_FLOOR', name, name, relevant.filter(booking => ids.has(booking.resourceId)), group.length);
  });
  const typeRows = (['ROOM', 'DESK'] as const).map(type => {
    const group = resources.filter(resource => resource.type === type);
    const ids = new Set(group.map(resource => resource.id));
    return dimensionRow('RESOURCE_TYPE', type, type === 'ROOM' ? '会议室' : '工位', relevant.filter(booking => ids.has(booking.resourceId)), group.length);
  });
  const categoryRows = (['SMALL', 'MEDIUM', 'LARGE', 'AUDITORIUM'] as const).map(category => {
    const group = resources.filter(resource => resource.type === 'ROOM' && (resource.roomCategory || 'SMALL') === category);
    const ids = new Set(group.map(resource => resource.id));
    return dimensionRow('ROOM_CATEGORY', category, roomCategoryLabel(group[0] || { roomCategory: category } as Resource), relevant.filter(booking => ids.has(booking.resourceId)), group.length);
  });
  const timeRows = ['08:00-12:00', '12:00-18:00', '18:00-24:00', '00:00-08:00'].map(slot => dimensionRow('TIME_SLOT', slot, slot, relevant.filter(booking => timeSlot(booking.startTime) === slot), resources.length));
  const serviceRows = (Object.keys(SERVICE_LABELS) as WorkOrder['type'][]).map(type => {
    const orders = allOrders.filter(order => order.type === type);
    const ids = new Set(orders.map(order => order.bookingId));
    const bookings = relevant.filter(booking => ids.has(booking.id));
    const row = dimensionRow('SERVICE', type, SERVICE_LABELS[type], bookings, resources.length);
    return { ...row, serviceOrderCount: orders.length, serviceCost: round(orders.reduce((sum, order) => sum + (order.costAmount || 0), 0)) };
  });
  const usageRows = [...new Set(details.map(usageCategory))].map(category => {
    const ids = new Set(details.filter(detail => usageCategory(detail) === category).map(detail => detail.id));
    return dimensionRow('USAGE', category, category, relevant.filter(booking => ids.has(booking.id)), resources.length);
  });
  const checkIns = allEvents.map(event => ({
    id: event.id, bookingId: event.bookingId,
    subject: userById.get(event.subjectUserId)?.name || event.subjectUserId,
    operator: userById.get(event.operatorId)?.name || event.operatorId,
    source: event.source, action: event.action, checkedInAt: event.checkedInAt, createdAt: event.createdAt, reason: event.reason
  }));
  const services = allOrders.map(order => {
    const booking = relevantById.get(order.bookingId)!;
    const confidential = isConfidentialBooking(booking);
    const snapshot = order.requirementSnapshot;
    const catalog = snapshot?.catalogSnapshot;
    const fieldValues = confidential ? {} : { ...(snapshot?.fieldValues || order.fieldValues || {}) };
    const fields = catalog?.fields || [];
    const requirementDetails = Object.entries(fieldValues).map(([key, value]) => `${fields.find(field => field.key === key)?.label || key}：${value}`).join('；');
    const estimatedCost = Number(fieldValues.estimatedCost);
    return {
      id: order.id, bookingId: order.bookingId, type: order.type,
      title: confidential ? '涉密会议会务服务' : order.title,
      status: order.status, assigneeRole: order.assigneeRole, createdAt: order.createdAt,
      responseDueAt: order.responseDueAt, respondedAt: order.respondedAt, completedAt: order.completedAt,
      catalogItemId: catalog?.catalogItemId, catalogVersion: catalog?.catalogVersion, catalogName: catalog?.name,
      fieldValues, requirementDetails,
      quantity: fieldValues.quantity, unit: fieldValues.unit, specification: fieldValues.specification,
      serviceTime: fieldValues.serviceTime, serviceLocation: fieldValues.serviceLocation,
      estimatedCost: fieldValues.estimatedCost !== undefined && Number.isFinite(estimatedCost) && estimatedCost >= 0 ? estimatedCost : undefined,
      executionResult: confidential ? undefined : order.executionResult,
      cancellationReason: order.cancellationReason,
      costAmount: order.costAmount || 0, costNote: order.costNote, exceptionReason: order.exceptionReason
    };
  });
  return {
    start, end, generatedAt: generatedAt.toISOString(), revision, overall,
    rows: [...resourceRows, ...floorRows, ...typeRows, ...categoryRows, ...timeRows, ...departmentRows, ...serviceRows, ...usageRows],
    bookings: details.sort((a, b) => timeValue(a.startTime) - timeValue(b.startTime)),
    checkIns: checkIns.sort((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt)),
    services: services.sort((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt)),
    supplies: buildSupplyRows(allOrders, relevantById),
    differences: details.filter(detail => detail.reconciliationStatus !== '一致')
  };
};

export const getOperationsReport = async (actor: User, start: string, end: string) => {
  const { db, revision } = await readSnapshot();
  return buildOperationsReport(db, actor, start, end, revision);
};

export const writeOperationsReportXlsx = async (report: OperationsReport, res: ServerResponse) => {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
  const addSheet = (name: string, headers: string[], rows: unknown[][]) => {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = headers.map((header, index) => ({ header, key: String(index), width: index < 2 ? 24 : 16 }));
    for (const row of rows) sheet.addRow(row.map(value => typeof value === 'string' ? spreadsheetText(value) : value ?? '')).commit();
    sheet.commit();
  };
  const summaryHeaders = ['维度', '名称', '预约数', '使用小时', '使用率(%)', '取消率(%)', 'No-show率(%)', '驳回率(%)', '平均审批时长(小时)', '计划小时', '实际小时', '签到预约数', '提前结束数', '服务工单数', '服务成本(元)'];
  const summaryRow = (row: OperationsReportRow) => [DIMENSION_LABELS[row.dimension], row.name, row.bookingCount, row.usageHours, row.utilization, row.cancellationRate, row.noShowRate, row.rejectionRate, row.averageApprovalHours, row.scheduledHours, row.actualHours, row.checkedInCount, row.earlyEndCount, row.serviceOrderCount, row.serviceCost];
  addSheet('多维汇总', summaryHeaders, [report.overall, ...report.rows].map(summaryRow));
  const bookingHeaders = ['预约ID', '会议主题', '申请人', '部门', '资源', '楼栋楼层', '资源类型', '时段', '展示状态', '主状态', '计划开始', '计划结束', '计划分钟', '有效签到人数', '首次签到', '实际开始', '实际结束', '实际分钟', '提前结束分钟', '未签到', '释放类型', '服务工单数', '服务成本(元)', '对账状态', '对账说明'];
  const bookingRow = (row: OperationsBookingReport) => [row.id, row.purpose, row.requester, row.department, row.resource, row.buildingFloor, row.resourceType, row.timeSlot, BOOKING_DISPLAY_STATUS_LABELS[row.displayStatus], STATUS_LABELS[row.status], localDateTime(row.startTime), localDateTime(row.endTime), row.scheduledMinutes, row.checkInCount, localDateTime(row.firstCheckInAt), localDateTime(row.actualStartTime), localDateTime(row.actualEndTime), row.actualMinutes, row.earlyEndMinutes, row.noShow ? '是' : '否', row.releaseType || '', row.serviceOrderCount, row.serviceCost, row.reconciliationStatus, row.reconciliationNote];
  addSheet('预约对账', bookingHeaders, report.bookings.map(bookingRow));
  addSheet('签到明细', ['事件ID', '预约ID', '签到成员', '操作人', '来源', '动作', '签到时间', '记录时间', '原因'], report.checkIns.map(row => [row.id, row.bookingId, row.subject, row.operator, row.source, row.action, localDateTime(row.checkedInAt), localDateTime(row.createdAt), row.reason || '']));
  addSheet('备料统计', supplyHeaders, report.supplies.map(supplyRow));
  addSheet('服务明细', ['工单ID', '预约ID', '服务类型', '目录ID', '目录版本', '标题', '状态', '责任角色', '数量', '单位', '规格', '服务时间', '服务地点', '预估成本(元)', '需求明细（目录快照）', '创建时间', '响应截止', '响应时间', '完成时间', '执行结果', '取消原因', '实际成本(元)', '成本说明', '异常原因'], report.services.map(row => [row.id, row.bookingId, row.catalogName || SERVICE_LABELS[row.type], row.catalogItemId || '', row.catalogVersion || '', row.title, row.status, row.assigneeRole, row.quantity || '', row.unit || '', row.specification || '', row.serviceTime || '', row.serviceLocation || '', row.estimatedCost ?? '', row.requirementDetails, localDateTime(row.createdAt), localDateTime(row.responseDueAt), localDateTime(row.respondedAt), localDateTime(row.completedAt), row.executionResult || '', row.cancellationReason || '', row.costAmount, row.costNote || '', row.exceptionReason || '']));
  addSheet('差异清单', bookingHeaders, report.differences.map(bookingRow));
  addSheet('导出说明', ['项目', '内容'], [
    ['统计开始', localDateTime(report.start)], ['统计结束', localDateTime(report.end)], ['生成时间', localDateTime(report.generatedAt)],
    ['快照版本', report.revision], ['预约行数', report.bookings.length], ['签到事件行数', report.checkIns.length], ['服务工单行数', report.services.length],
    ['备料统计行数', report.supplies.length],
    ['口径', '先按当前账号可读预约过滤，再聚合；实际分钟来自独立使用事实，计划分钟与实际分钟分别列示；备料量仅取工单冻结目录快照中的数值字段，按数量字段、单位和会议时段汇总。']
  ]);
  await workbook.commit();
};

import type { ApprovalDelegate, ApprovalRuleSetVersion, AuditoriumSetup, Booking, BookingServiceRequirement, BookingUsageFact, CheckInEvent, ConfidentialAccessGrant, ConfidentialityAuthorization, ConfidentialWhitelistEntry, DoorDevice, ExceptionActionRecord, OrganizationSyncBatch, Resource, ServiceArea, ServiceCatalogItem, ServiceInspection, ServiceShift, UsageAppeal, User, ApprovalNode, WorkOrder, RoleDefinition, Department, Notification, WorkflowVersion, RuleVersion, ResourceImportBatch, ExternalCallback, ExternalCompensation, AccessAuthorizationFact, IntegrationDelivery } from '../types.ts';
import { findBookingConflicts, isActiveBooking, findNextAvailableSlot, isResourceAcceptingBookings, isValidBookingPurpose, validateBookingResource } from '../utils/bookingRules.ts';
import { approveBooking, getApprovalGroups, getBookingWorkflow, rejectBooking } from '../utils/approval.ts';
import { SERVICE_TYPES, SERVICE_TYPE_LABELS, isServiceType } from '../constants.ts';
import { canUseHelpTopic, HELP_TOPICS, isSystemView, searchHelpTopics, SYSTEM_VIEWS, type SystemView } from '../helpCatalog.ts';
import type { Hq3dSnapshot } from './hq3d.ts';

export interface OfficeDb {
  roles?: RoleDefinition[];
  users?: User[];
  resources?: Resource[];
  bookings?: Booking[];
  departments?: Department[];
  workflow?: ApprovalNode[];
  workflowVersions?: WorkflowVersion[];
  approvalDelegates?: ApprovalDelegate[];
  workOrders?: WorkOrder[];
  notifications?: Notification[];
  ruleVersions?: RuleVersion[];
  resourceImportBatches?: ResourceImportBatch[];
  approvalRuleSetVersions?: ApprovalRuleSetVersion[];
  confidentialWhitelist?: ConfidentialWhitelistEntry[];
  confidentialityAuthorizations?: ConfidentialityAuthorization[];
  confidentialAccessGrants?: ConfidentialAccessGrant[];
  serviceCatalog?: ServiceCatalogItem[];
  serviceAreas?: ServiceArea[];
  serviceShifts?: ServiceShift[];
  serviceInspections?: ServiceInspection[];
  checkInEvents?: CheckInEvent[];
  usageFacts?: BookingUsageFact[];
  usageAppeals?: UsageAppeal[];
  devices?: DoorDevice[];
  exceptionActions?: ExceptionActionRecord[];
  organizationSyncBatches?: OrganizationSyncBatch[];
  externalCallbacks?: ExternalCallback[];
  externalCompensations?: ExternalCompensation[];
  accessAuthorizationFacts?: AccessAuthorizationFact[];
  integrationDeliveries?: IntegrationDelivery[];
}

export interface AgentContext {
  userId: string;
  now?: Date;
}

export type AgentAction =
  | { type: 'NAVIGATE'; view: SystemView; summary?: string; hq3d?: { buildingId: string; floorNo?: number; roomUid?: string } }
  | { type: 'OPEN_HELP'; topicId: string; summary: string }
  | { type: 'PROPOSE_BOOKING'; draft: Partial<Booking>; summary: string }
  | { type: 'PROPOSE_EDIT_BOOKING'; bookingId: string; draft: Partial<Booking>; summary: string }
  | { type: 'PROPOSE_RENEW_BOOKING'; bookingId: string; summary: string }
  | { type: 'PROPOSE_CANCEL'; bookingId: string; reason?: string; summary: string }
  | { type: 'PROPOSE_APPROVAL'; bookingId: string; bookingIds?: string[]; decision: 'APPROVE' | 'REJECT'; comment?: string; summary: string }
  | { type: 'PROPOSE_CHECK_IN'; bookingId: string; summary: string }
  | { type: 'PROPOSE_WORK_ORDER'; workOrderId: string; summary: string }
  | { type: 'REFRESH' };

export type TodoKind = 'APPROVAL' | 'REJECTED' | 'CHECK_IN' | 'UPCOMING' | 'WORK_ORDER';
export type TodoAction = AgentAction & { label: string };

export interface TodoItem {
  id: string;
  kind: TodoKind;
  bookingId?: string;
  workOrderId?: string;
  title: string;
  detail: string;
  urgency: 'high' | 'normal' | 'low';
  dueAt?: string;
  actions: TodoAction[];
}

export interface ToolResult {
  ok: boolean;
  data?: any;
  action?: AgentAction;
  error?: string;
  candidates?: any[];
  hint?: string;
  /** 工具执行后需要推送给其他用户的通知，由调用方落库。 */
  notifications?: Notification[];
}

export interface ExecutorOptions {
  loadHq3dSnapshot?: () => Promise<Hq3dSnapshot>;
}

const HQ3D_CATEGORY_LABELS: Record<string, string> = {
  office: '办公室', open: '开放办公', exec: '领导办公室', meeting: '会议室',
  front: '前台/大厅', dining: '餐厅/餐厨', guest: '客房', fitness: '康体/健身',
  welfare: '员工福利', party: '党群/纪检', archive: '档案室', support: '配套/机房',
  stair: '楼梯/安全通道', lift: '电梯', wc: '卫生间'
};

export const queryHq3dSnapshot = (snapshot: Hq3dSnapshot, args: any): ToolResult => {
  const buildingQuery = String(args?.building || '').trim();
  const keyword = String(args?.keyword || '').trim();
  if (buildingQuery.length > 100 || keyword.length > 100) return { ok: false, error: '楼栋和房间关键词请控制在 100 字以内。' };
  const hasFloor = args?.floorNo !== undefined && args?.floorNo !== null && args?.floorNo !== '';
  const floorNo = hasFloor ? Number(args.floorNo) : null;
  if (floorNo !== null && (!Number.isInteger(floorNo) || floorNo < 1 || floorNo > 200)) {
    return { ok: false, error: '楼层必须是 1 至 200 之间的整数。' };
  }
  const limit = args?.limit === undefined ? 12 : Number(args.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) return { ok: false, error: '返回数量必须是 1 至 20 之间的整数。' };

  const normalizedBuilding = norm(buildingQuery);
  const buildings = buildingQuery
    ? snapshot.buildings.filter(building => {
      const id = norm(building.id);
      const name = norm(building.name);
      return id === normalizedBuilding || name === normalizedBuilding || name.includes(normalizedBuilding) || id.includes(normalizedBuilding);
    })
    : snapshot.buildings;
  if (buildingQuery && !buildings.length) {
    return { ok: false, error: `未找到匹配楼栋。可选择：${snapshot.buildings.map(building => building.name).join('、')}。` };
  }

  const scoped = buildings.map(building => ({
    building,
    floors: floorNo === null ? building.floors : building.floors.filter(floor => floor.floorNo === floorNo)
  }));
  if (floorNo !== null && !scoped.some(item => item.floors.length)) {
    return { ok: false, error: `未找到匹配的 ${floorNo} 层，请核对楼栋和楼层。` };
  }

  const normalizedKeyword = norm(keyword);
  const matches = scoped.flatMap(({ building, floors }) => floors.flatMap(floor => floor.rooms.flatMap(room => {
    const profile = snapshot.profiles[room.uid];
    const current = {
      label: profile?.label ?? room.label,
      dept: profile?.dept ?? room.dept,
      person: profile?.person ?? room.person,
      notes: profile?.notes ?? room.notes,
      category: profile?.category ?? room.cat,
      areaSqm: profile?.areaSqm
    };
    const haystack = norm([room.uid, room.no, current.label, current.dept, current.person, current.notes].join(' '));
    if (normalizedKeyword && !haystack.includes(normalizedKeyword)) return [];
    const exact = Boolean(normalizedKeyword) && [room.uid, room.no, current.label].some(value => norm(value) === normalizedKeyword);
    return [{ building, floor, room, current, exact }];
  }))).sort((a, b) => Number(b.exact) - Number(a.exact));

  const hasRoomQuery = Boolean(buildingQuery || floorNo !== null || keyword);
  const rooms = (hasRoomQuery ? matches : []).slice(0, limit).map(({ building, floor, room, current }) => {
    const records = snapshot.maintenance[room.uid]?.records || [];
    const mapping = snapshot.resourceMappings[room.uid];
    const disposition = snapshot.dispositions[room.uid];
    return {
      uid: room.uid,
      no: room.no,
      label: current.label,
      category: current.category,
      categoryLabel: HQ3D_CATEGORY_LABELS[current.category] || current.category,
      buildingId: building.id,
      buildingName: building.name,
      floorNo: floor.floorNo,
      floorTag: floor.tag,
      dept: current.dept,
      person: current.person,
      notes: current.notes,
      areaSqm: current.areaSqm ?? null,
      maintenance: {
        open: records.filter(record => record.status === 'open').length,
        doing: records.filter(record => record.status === 'doing').length,
        done: records.filter(record => record.status === 'done').length,
        latest: records.slice(0, 3).map(record => ({
          id: record.id, type: record.type, title: record.title, note: record.note,
          reporter: record.reporter, status: record.status, updatedAt: record.updatedAt
        }))
      },
      resourceMapping: mapping ? {
        resourceId: mapping.resourceId, planId: mapping.planId, decisionRef: mapping.decisionRef,
        decisionBasis: mapping.decisionBasis, note: mapping.note
      } : null,
      disposition: disposition ? {
        disposition: disposition.disposition, reviewStatus: disposition.reviewStatus,
        planId: disposition.planId, decisionBasis: disposition.decisionBasis, note: disposition.note
      } : null
    };
  });

  const onlyMatch = keyword && matches.length === 1 ? matches[0] : null;
  const onlyBuilding = buildings.length === 1 ? buildings[0] : null;
  const target = keyword && !matches.length
    ? null
    : onlyMatch
      ? { buildingId: onlyMatch.building.id, floorNo: onlyMatch.floor.floorNo, roomUid: onlyMatch.room.uid }
      : onlyBuilding && floorNo !== null
        ? { buildingId: onlyBuilding.id, floorNo }
        : buildingQuery && onlyBuilding
          ? { buildingId: onlyBuilding.id }
          : null;
  const targetName = onlyMatch
    ? `${onlyMatch.building.name} ${onlyMatch.floor.tag} ${onlyMatch.current.label}`
    : onlyBuilding
      ? `${onlyBuilding.name}${floorNo !== null ? ` ${floorNo}F` : ''}`
      : '总部楼层3D';

  return {
    ok: true,
    data: {
      generatedAt: snapshot.generatedAt,
      total: matches.length,
      returned: rooms.length,
      buildings: scoped.map(({ building, floors }) => ({
        id: building.id,
        name: building.name,
        roomCount: floors.reduce((sum, floor) => sum + floor.rooms.length, 0),
        floors: floors.map(floor => ({
          floorNo: floor.floorNo, tag: floor.tag, sheet: floor.sheet,
          roomCount: floor.rooms.length, areaTotal: floor.areaTotal
        }))
      })),
      rooms
    },
    action: target ? { type: 'NAVIGATE', view: 'HQ_3D', hq3d: target, summary: `定位${targetName}` } : undefined,
    hint: !hasRoomQuery
      ? '已返回楼栋和楼层概览；可补充楼栋、楼层或房间关键词查看空间详情。'
      : matches.length > rooms.length
        ? `共匹配 ${matches.length} 间，仅返回前 ${rooms.length} 间；请补充楼栋、楼层、房号或部门关键词缩小范围。`
        : matches.length === 0
          ? '没有匹配的房间，可换用房号、房间名、部门或使用人关键词。'
          : undefined
  };
};

const DAY_MS = 86400000;
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 20;

const pad2 = (v: number) => String(v).padStart(2, '0');
const fmtDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtTime = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const fmtRange = (start: Date, end: Date) => `${fmtDate(start)} ${fmtTime(start)}–${fmtTime(end)}`;

/** 无时区的 ISO 串按服务器本地时区（Asia/Shanghai）解析，避免被当成 UTC。 */
export const parseTime = (value?: string | null): Date | null => {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const FEATURE_ALIASES: Array<[RegExp, RegExp]> = [
  [/视频|远程|会议系统|video/i, /视频|远程|会议系统|video/i],
  [/投屏|投影|屏幕|显示器|display|screen/i, /投屏|投影|屏幕|显示器|display|screen/i],
  [/白板|whiteboard/i, /白板|whiteboard/i],
  [/茶水|咖啡|饮水|tea|coffee/i, /茶水|咖啡|饮水|tea|coffee/i]
];

const matchFeature = (resource: Resource, want: string) => {
  const text = (resource.features || []).join(' ');
  const alias = FEATURE_ALIASES.find(([keyword]) => keyword.test(want));
  if (alias) return alias[1].test(text);
  return text.includes(want.trim());
};

const norm = (s: string) => String(s || '').toLowerCase().replace(/\s+/g, '');

/** 名称 → 资源。命中唯一结果时返回 resource，多个候选时返回 candidates，让模型反问。 */
const resolveResource = (resources: Resource[], nameOrId?: string): { resource?: Resource; candidates?: Resource[] } => {
  if (!nameOrId) return {};
  const key = String(nameOrId).trim();
  const byId = resources.find(r => r.id === key);
  if (byId) return { resource: byId };

  const k = norm(key);
  const exact = resources.filter(r => norm(r.name) === k);
  if (exact.length === 1) return { resource: exact[0] };

  const partial = resources.filter(r => norm(r.name).includes(k) || (k.length >= 2 && k.includes(norm(r.name))));
  if (partial.length === 1) return { resource: partial[0] };
  if (partial.length > 1) return { candidates: partial };

  const tokens = key.split(/[\s,，、·]+/).filter(t => t.length >= 2);
  if (tokens.length) {
    const byToken = resources.filter(r => tokens.some(t => norm(r.name).includes(norm(t))));
    if (byToken.length === 1) return { resource: byToken[0] };
    if (byToken.length > 1) return { candidates: byToken };
  }
  return { candidates: resources.filter(r => r.type === 'ROOM').slice(0, 5) };
};

/** 用关键词在预订列表里定位唯一一条，模糊命中多条时交给模型去追问。 */
const resolveBooking = (list: Booking[], resources: Resource[], users: User[], keyword?: string): { booking?: Booking; candidates?: Booking[] } => {
  const active = list.filter(isActiveBooking);
  if (!keyword) {
    if (active.length === 1) return { booking: active[0] };
    return { candidates: active.slice(0, 5) };
  }
  const k = norm(keyword);
  const scored = active.map(b => {
    const r = resources.find(x => x.id === b.resourceId);
    const u = users.find(x => x.id === b.userId);
    let score = 0;
    if (b.id === keyword) score += 100;
    if (norm(b.purpose || '') && norm(b.purpose).includes(k)) score += 10;
    if (r && norm(r.name).includes(k)) score += 10;
    if (u && norm(u.name).includes(k)) score += 10;
    if (fmtDate(new Date(b.startTime)).includes(k)) score += 8;
    if (fmtTime(new Date(b.startTime)).replace(':', '').includes(k.replace(':', ''))) score += 4;
    return { b, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

  if (scored.length === 1) return { booking: scored[0].b };
  if (scored.length > 1 && scored[0].score > scored[1].score) return { booking: scored[0].b };
  if (scored.length > 1) return { candidates: scored.map(x => x.b).slice(0, 5) };
  return { candidates: active.slice(0, 5) };
};

const bookingBrief = (b: Booking, resources: Resource[], users: User[]) => {
  const r = resources.find(x => x.id === b.resourceId);
  const u = users.find(x => x.id === b.userId);
  return {
    bookingId: b.id,
    resource: r?.name || b.resourceId,
    user: u?.name || b.userId,
    start: fmtRange(new Date(b.startTime), new Date(b.endTime)),
    status: b.status,
    purpose: b.purpose
  };
};

export const buildTodos = (db: OfficeDb, userId: string, now = new Date()): TodoItem[] => {
  const me = (db.users || []).find(u => u.id === userId);
  if (!me) return [];
  const resources = db.resources || [];
  const users = db.users || [];
  const workflow = db.workflow || [];
  const approvalContext = {
    users,
    resources,
    departments: db.departments || [],
    delegates: db.approvalDelegates || [],
    now
  };
  const todos: TodoItem[] = [];
  const resourceName = (id: string) => resources.find(r => r.id === id)?.name || id;

  for (const group of getApprovalGroups(db.bookings || [], workflow, me, approvalContext)) {
    const b = group.booking;
    const bookingWorkflow = getBookingWorkflow(b, workflow);
    const brief = `${resourceName(b.resourceId)} · ${fmtRange(new Date(b.startTime), new Date(b.endTime))}`;
    const seriesSuffix = group.seriesBookings.length > 1 ? ` · 共 ${group.seriesBookings.length} 个会议日` : '';
    todos.push({
      id: `approval-${b.id}`, kind: 'APPROVAL', bookingId: b.id, title: `审批「${b.purpose}」`,
      detail: `${users.find(u => u.id === b.userId)?.name || b.userId} · ${brief} · ${bookingWorkflow[b.currentNodeIndex]?.name || '待审批'}${seriesSuffix}`,
      urgency: +new Date(b.startTime) - now.getTime() < DAY_MS ? 'high' : 'normal', dueAt: b.startTime,
      actions: [{ type: 'PROPOSE_APPROVAL', bookingId: b.id, bookingIds: group.seriesBookings.map(item => item.id), decision: 'APPROVE', label: group.seriesBookings.length > 1 ? `通过 ${group.seriesBookings.length} 个会议日` : '通过审批', summary: `通过「${b.purpose}」的当前审批节点${seriesSuffix}` }]
    });
  }

  for (const b of db.bookings || []) {
    const brief = `${resourceName(b.resourceId)} · ${fmtRange(new Date(b.startTime), new Date(b.endTime))}`;
    if (b.userId === userId && b.status === 'REJECTED') {
      const last = b.approvalHistory?.[b.approvalHistory.length - 1];
      todos.push({
        id: `rejected-${b.id}`, kind: 'REJECTED', bookingId: b.id, title: `「${b.purpose}」被驳回`,
        detail: last?.comment ? `审批意见：${last.comment}` : brief, urgency: 'normal',
        actions: [{ type: 'NAVIGATE', view: 'BOOKINGS', label: '查看并重新预订' }]
      });
    }
    const participant = b.userId === userId || b.attendeeIds?.includes(userId);
    if (participant && b.status === 'APPROVED') {
      const start = +new Date(b.startTime);
      const end = +new Date(b.endTime);
      const current = now.getTime();
      if (!b.checkedInAt && current >= start - 15 * 60000 && current < end) {
        todos.push({
          id: `checkin-${b.id}`, kind: 'CHECK_IN', bookingId: b.id, title: `签到「${b.purpose}」`,
          detail: brief, urgency: 'high', dueAt: b.startTime,
          actions: [{ type: 'PROPOSE_CHECK_IN', bookingId: b.id, label: '立即签到', summary: `${b.purpose} · ${brief}` }]
        });
      } else if (start > current) {
        todos.push({
          id: `upcoming-${b.id}`, kind: 'UPCOMING', bookingId: b.id, title: `即将开始「${b.purpose}」`,
          detail: brief, urgency: start - current < DAY_MS ? 'normal' : 'low', dueAt: b.startTime,
          actions: [{ type: 'NAVIGATE', view: 'BOOKINGS', label: '查看安排' }]
        });
      }
    }
  }

  for (const order of db.workOrders || []) {
    if (order.status !== 'TODO' || (!me.role.includes('SYSTEM_ADMIN') && !me.role.includes(order.assigneeRole))) continue;
    const booking = (db.bookings || []).find(b => b.id === order.bookingId);
    todos.push({
      id: `workorder-${order.id}`, kind: 'WORK_ORDER', workOrderId: order.id, bookingId: order.bookingId,
      title: order.title, detail: booking ? `${resourceName(booking.resourceId)} · ${fmtRange(new Date(booking.startTime), new Date(booking.endTime))}` : '服务工单待处理',
      urgency: 'normal', dueAt: booking?.startTime,
      actions: [{ type: 'PROPOSE_WORK_ORDER', workOrderId: order.id, label: '完成工单', summary: `完成${order.title}` }]
    });
  }
  const weight = { high: 0, normal: 1, low: 2 };
  return todos.sort((a, b) => weight[a.urgency] - weight[b.urgency] || +(a.dueAt ? new Date(a.dueAt) : new Date(8640000000000000)) - +(b.dueAt ? new Date(b.dueAt) : new Date(8640000000000000))).slice(0, 30);
};

export const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_help',
      description: '检索当前角色可见的系统操作指南。用户询问“怎么用/在哪里/如何操作”时优先使用，并给出可打开的帮助卡片。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '功能或操作关键词，如 修改预约、长期续期、导出报表、涉密授权、楼层图导入、Excel楼层图、原生楼层图Excel、打印区域、图片OCR' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'navigate_system',
      description: '生成前往指定系统页面的导航卡片，仅允许固定视图和当前角色有权限的页面。高风险维护只导航，不直接执行。',
      parameters: {
        type: 'object',
        properties: { view: { type: 'string', enum: [...SYSTEM_VIEWS], description: '目标系统视图' } },
        required: ['view']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_hq3d_spaces',
      description: '查询总部楼层3D的真实楼栋、楼层、房间、部门/使用人、面积、维护记录、资源映射和处置状态，并生成可定位到楼栋、楼层或唯一房间的导航卡片。仅只读查询，不用于布局导入或资料维护。',
      parameters: {
        type: 'object',
        properties: {
          building: { type: 'string', description: '楼栋ID或名称关键词，如主楼、配楼；不传表示全部楼栋' },
          floorNo: { type: 'number', description: '楼层号，如 2 表示2F；不传表示全部楼层' },
          keyword: { type: 'string', description: '房号、稳定UID、房间名、部门、使用人或备注关键词' },
          limit: { type: 'number', description: '最多返回房间数，1至20，默认12' }
        }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_resources',
      description: '列出全部会议室/工位及其容量、位置、设备特性。用户问"有哪些会议室"时使用。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['ROOM', 'DESK'], description: 'ROOM=会议室，DESK=工位，不传表示全部' }
        }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'find_available_resources',
      description: '按时间段、人数、设备要求筛选当前可预订的空闲资源。这是给用户订会议室前必须调用的一步。',
      parameters: {
        type: 'object',
        properties: {
          startTime: { type: 'string', description: '开始时间，ISO 8601 本地时间，例如 2026-11-20T15:00' },
          endTime: { type: 'string', description: '结束时间，ISO 8601 本地时间，例如 2026-11-20T16:00' },
          participants: { type: 'number', description: '参会人数' },
          features: { type: 'array', items: { type: 'string' }, description: '需要的设备，如 视频、投屏、白板' },
          type: { type: 'string', enum: ['ROOM', 'DESK'] }
        },
        required: ['startTime', 'endTime']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_resource_calendar',
      description: '查询某个资源在某一天的已占用时段，用于回答"X 会议室明天还有空吗"。',
      parameters: {
        type: 'object',
        properties: {
          resourceName: { type: 'string', description: '资源名称关键词' },
          date: { type: 'string', description: '日期 YYYY-MM-DD，不传表示今天' },
          days: { type: 'number', description: '连续查看几天，默认 1' }
        },
        required: ['resourceName']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_my_bookings',
      description: '查询当前登录用户自己的预订申请列表。',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED'], description: '不传表示全部活跃申请' }
        }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_pending_approvals',
      description: '查询当前用户待审批的申请。只有审批负责人和系统管理员可用。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_usage_stats',
      description: '统计一段时间内的预订量、状态分布、热门资源、部门分布、高峰时段和使用率。',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: '统计天数，默认 30' } }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_work_orders',
      description: '查询茶水、视频会议等增值服务工单。',
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['TODO', 'DONE'] } }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_my_todos',
      description: '查询当前用户的审批、签到、驳回、即将开始会议和服务工单待办，并返回可执行动作。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_complete_work_order',
      description: '为当前用户负责的服务工单生成完成提案，需用户确认后执行。',
      parameters: {
        type: 'object',
        properties: { workOrderId: { type: 'string', description: '待办或工单查询结果中的工单 ID' } },
        required: ['workOrderId']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_booking',
      description: '生成一条预订提案（不会直接落库），返回冲突检测结果和待确认的草稿。用户确认后由前端提交。',
      parameters: {
        type: 'object',
        properties: {
          resourceName: { type: 'string', description: '资源名称，必须来自 find_available_resources 的结果' },
          startTime: { type: 'string', description: 'ISO 8601 本地时间' },
          endTime: { type: 'string', description: 'ISO 8601 本地时间' },
          purpose: { type: 'string', description: '明确会议用途，200 字以内，不能只填写“会议”或“开会”' },
          participants: { type: 'number', description: '参会人数，必填且为大于 0 的整数' },
          meetingType: { type: 'string', enum: ['NORMAL', 'IMPORTANT'], description: '仅普通或重要会议草案；涉密属性必须由用户在正式表单中选择' },
          needsTea: { type: 'boolean', description: '用户明确要求时需要茶水服务' },
          needsVideo: { type: 'boolean', description: '用户明确要求时需要视频会议支持' },
          serviceRequirements: {
            type: 'array',
            description: '仅记录用户明确提出的服务需求，不自行推断',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: SERVICE_TYPES },
                details: { type: 'string', description: '服务补充说明；OTHER 必填' },
                fieldValues: {
                  type: 'object',
                  description: '用户明确提供的目录字段值，如 quantity、unit、specification、serviceTime、serviceLocation、estimatedCost；最终仍由正式表单校验',
                  additionalProperties: { type: 'string' }
                }
              },
              required: ['type']
            }
          },
          exclusiveRequestReason: { type: 'string', description: '专属资源临时申请理由，仅用户明确说明时填写' },
          auditoriumSetup: {
            type: 'object',
            description: '礼堂布置，仅礼堂资源且用户明确说明时填写',
            properties: {
              seatingLayout: { type: 'string', enum: ['THEATER', 'CLASSROOM', 'ROUNDTABLE'] },
              stageRequired: { type: 'boolean' },
              rehearsalMinutes: { type: 'number', description: '彩排分钟数，0–1440 的整数' },
              notes: { type: 'string' }
            },
            required: ['seatingLayout', 'stageRequired']
          },
          attendeeNames: { type: 'array', items: { type: 'string' }, description: '参会人姓名' },
          hasLeader: { type: 'boolean', description: '是否有领导参会' },
          leaderDetails: { type: 'string', description: '参会领导姓名或职位' },
          repeatFrequency: { type: 'string', enum: ['NONE', 'WEEKLY', 'BIWEEKLY'], description: '重复频率，默认 NONE' },
          repeatCount: { type: 'number', description: '含首次在内的总次数，2、3、4、6、8 或 12' }
        },
        required: ['resourceName', 'startTime', 'endTime', 'purpose', 'participants']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_edit_booking',
      description: '为本人普通或重要会议生成修改预约的表单预填提案。只修改明确给出的时间、用途或人数，确认后打开正式表单，不直接落库。',
      parameters: {
        type: 'object',
        properties: {
          bookingKeyword: { type: 'string', description: '用于定位本人有效预约的资源名、用途或日期' },
          startTime: { type: 'string', description: '新的开始时间，ISO 8601 本地时间；不变则省略' },
          endTime: { type: 'string', description: '新的结束时间，ISO 8601 本地时间；不变则省略' },
          purpose: { type: 'string', description: '新的明确用途；不变则省略' },
          participants: { type: 'number', description: '新的人数；不变则省略' }
        },
        required: ['bookingKeyword']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_renew_booking',
      description: '为本人已核准的长期预约生成下一周期续期提案，确认后打开正式续期表单，不直接落库。',
      parameters: {
        type: 'object',
        properties: { bookingKeyword: { type: 'string', description: '长期系列用途、资源名或日期' } },
        required: ['bookingKeyword']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_cancel',
      description: '生成一条取消预订提案，需用户确认后执行。',
      parameters: {
        type: 'object',
        properties: {
          bookingKeyword: { type: 'string', description: '用于定位预订的关键词，如资源名、用途、日期' }
        },
        required: ['bookingKeyword']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_approval',
      description: '生成一条审批提案（通过或驳回），需用户确认后执行。仅审批人可用。',
      parameters: {
        type: 'object',
        properties: {
          bookingKeyword: { type: 'string', description: '用于定位申请的关键词，如申请人姓名、资源名、日期' },
          decision: { type: 'string', enum: ['APPROVE', 'REJECT'] },
          comment: { type: 'string', description: '审批意见' }
        },
        required: ['bookingKeyword', 'decision']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_check_in',
      description: '生成一条签到提案，用于用户到店后确认使用资源。',
      parameters: {
        type: 'object',
        properties: {
          bookingKeyword: { type: 'string', description: '用于定位预订的关键词' }
        },
        required: ['bookingKeyword']
      }
    }
  }
];

const APPROVER_TOOLS = new Set(['get_pending_approvals', 'propose_approval']);
const ADMIN_TOOLS = new Set(['get_usage_stats']);
const SERVICE_TOOLS = new Set(['get_work_orders', 'propose_complete_work_order']);
const SERVICE_ROLES = new Set(['SYSTEM_ADMIN', 'APPROVAL_ADMIN', 'SERVICE_COORDINATOR', 'FRONT_DESK']);

/** 按角色裁剪工具集：员工看不到审批类工具，服务端不依赖模型自觉。 */
export const toolsForRoles = (roles: string[] = [], workflow: ApprovalNode[] = [], workOrders: WorkOrder[] = []) => TOOLS.filter(tool => {
  const name = tool.function.name;
  if (APPROVER_TOOLS.has(name)) return roles.includes('APPROVAL_ADMIN') || roles.includes('SYSTEM_ADMIN') || workflow.some(node => roles.includes(node.approverRole));
  if (ADMIN_TOOLS.has(name)) return roles.includes('SYSTEM_ADMIN') || roles.includes('APPROVAL_ADMIN');
  if (SERVICE_TOOLS.has(name)) return roles.some(role => SERVICE_ROLES.has(role)) || workOrders.some(order => roles.includes(order.assigneeRole));
  return true;
});

export const createExecutor = (db: OfficeDb, ctx: AgentContext, options: ExecutorOptions = {}) => {
  const now = ctx.now ?? new Date();
  const resources = db.resources || [];
  const bookings = db.bookings || [];
  const users = db.users || [];
  const workflow = db.workflow || [];
  const workOrders = db.workOrders || [];
  const me = users.find(u => u.id === ctx.userId);
  const myRoles = me?.role || [];
  const approvalContext = {
    users,
    resources,
    departments: db.departments || [],
    delegates: db.approvalDelegates || [],
    now
  };
  const canAccessApproval = Boolean(me && (
    getApprovalGroups(bookings, workflow, me, approvalContext).length > 0
    || workflow.some(node => me.role.includes(node.approverRole))
    || (db.approvalDelegates || []).some(item => item.delegateId === me.id && Date.parse(item.startsAt) <= now.getTime() && now.getTime() < Date.parse(item.endsAt))
  ));
  const ownsWorkOrder = Boolean(me && workOrders.some(order => bookings.some(booking => booking.id === order.bookingId && booking.userId === me.id)));
  const canAccessWorkOrders = Boolean(me && (ownsWorkOrder || me.role.some(role => SERVICE_ROLES.has(role))));
  const canAccessExceptions = canAccessApproval || Boolean(me && (
    me.role.some(role => SERVICE_ROLES.has(role)) || workOrders.some(order => me.role.includes(order.assigneeRole))
  ));
  const allowedViews = new Set<SystemView>(['DASHBOARD', 'RESOURCES', 'BOOKINGS', 'HQ_3D', 'MONITORING']);
  if (canAccessApproval) allowedViews.add('APPROVAL_CENTER');
  if (canAccessWorkOrders) allowedViews.add('WORK_ORDERS');
  if (canAccessExceptions) allowedViews.add('EXCEPTIONS');
  if (me?.role.includes('SYSTEM_ADMIN')) {
    for (const view of ['WORKFLOW_CONFIG', 'DEPARTMENTS', 'ROLES', 'USERS', 'REPORTS', 'DEVICES', 'DATA_CENTER'] as const) allowedViews.add(view);
  }
  if (me?.role.some(role => ['SYSTEM_ADMIN', 'SECURITY_ADMIN'].includes(role))) allowedViews.add('CONFIDENTIALITY');
  const accessibleHelpTopics = HELP_TOPICS.filter(topic => canUseHelpTopic(topic, me?.role || [], allowedViews));

  const needUser = (): ToolResult | null =>
    me ? null : { ok: false, error: '无法识别当前用户身份，请重新登录后再试。' };
  const loadHq3dSnapshot = options.loadHq3dSnapshot || (async () => (await import('./hq3d.ts')).getHq3dSnapshot());

  const handlers: Record<string, (args: any) => any> = {
    search_help: (args) => {
      const deny = needUser();
      if (deny) return deny;
      const query = String(args?.query || '').trim();
      if (!query || query.length > 100) return { ok: false, error: '请提供 100 字以内的功能或操作关键词。' };
      const matches = searchHelpTopics(query, accessibleHelpTopics).slice(0, 5);
      if (!matches.length) return { ok: true, data: { total: 0, topics: [] }, hint: '没有匹配的指南，可换个关键词或描述具体操作。' };
      const top = matches[0];
      return {
        ok: true,
        data: {
          total: matches.length,
          topics: matches.map(topic => ({ id: topic.id, title: topic.title, summary: topic.summary, steps: topic.steps, note: topic.note, view: topic.view }))
        },
        action: { type: 'OPEN_HELP', topicId: top.id, summary: `查看「${top.title}」操作指南` }
      };
    },

    navigate_system: (args) => {
      const deny = needUser();
      if (deny) return deny;
      if (!isSystemView(args?.view) || !allowedViews.has(args.view)) return { ok: false, error: '目标页面不存在，或当前角色没有访问权限。' };
      const topic = HELP_TOPICS.find(item => item.view === args.view && canUseHelpTopic(item, me!.role, allowedViews));
      return {
        ok: true,
        data: { view: args.view, title: topic?.title || args.view },
        action: { type: 'NAVIGATE', view: args.view, summary: `前往${topic?.title || '目标页面'}` }
      };
    },

    query_hq3d_spaces: async (args) => {
      const deny = needUser();
      if (deny) return deny;
      try {
        return queryHq3dSnapshot(await loadHq3dSnapshot(), args);
      } catch {
        return { ok: false, error: '总部3D数据暂时不可用，请稍后重试或前往总部楼层3D页面查看。' };
      }
    },

    list_resources: (args) => {
      const list = args?.type ? resources.filter(r => r.type === args.type) : resources;
      return {
        ok: true,
        data: list.map(r => ({
          id: r.id, name: r.name, type: r.type, capacity: r.capacity,
          location: r.location, features: r.features, status: r.status
        }))
      };
    },

    find_available_resources: (args) => {
      const start = parseTime(args?.startTime);
      const end = parseTime(args?.endTime);
      if (!start || !end) return { ok: false, error: '时间格式无法解析，请给出 YYYY-MM-DDTHH:mm 格式的时间。' };
      if (end <= start) return { ok: false, error: '结束时间必须晚于开始时间。' };
      if ((end.getTime() - start.getTime()) > 8 * 3600 * 1000) return { ok: false, error: '单次预订不能超过 8 小时。' };

      const wants: string[] = Array.isArray(args?.features) ? args.features : [];
      const participants = Number(args?.participants) || 1;

      const eligible = resources.filter(r => {
        if (!isResourceAcceptingBookings(r)) return false;
        if (args?.type && r.type !== args.type) return false;
        if ((r.capacity || 1) < participants) return false;
        if (wants.some(w => !matchFeature(r, w))) return false;
        return findBookingConflicts(bookings, {
          resourceId: r.id, startTime: start.toISOString(), endTime: end.toISOString()
        }).length === 0;
      }).sort((a, b) => ((a.capacity || 1) - (b.capacity || 1)) || a.name.localeCompare(b.name, 'zh-CN'));

      if (eligible.length === 0) {
        const relaxed = resources
          .filter(r => isResourceAcceptingBookings(r) && (r.capacity || 1) >= participants)
          .map(r => {
            const slot = findNextAvailableSlot(r.id, bookings, Math.round((end.getTime() - start.getTime()) / 60000), start);
            return { name: r.name, capacity: r.capacity, nextFree: fmtRange(slot.start, slot.end) };
          })
          .slice(0, 3);
        return {
          ok: true,
          data: { total: 0, candidates: [], requested: fmtRange(start, end) },
          hint: relaxed.length
            ? `该时段没有完全匹配的资源。可参考这些资源的下一个空闲时段：${relaxed.map(r => `${r.name} ${r.nextFree}`).join('；')}`
            : '该时段没有可用资源，建议换个时间。'
        };
      }

      return {
        ok: true,
        data: {
          total: eligible.length,
          requested: fmtRange(start, end),
          candidates: eligible.slice(0, 5).map(r => ({
            name: r.name, capacity: r.capacity, location: r.location,
            features: r.features, type: r.type
          }))
        }
      };
    },

    get_resource_calendar: (args) => {
      const { resource, candidates } = resolveResource(resources, args?.resourceName);
      if (!resource) {
        return { ok: false, error: '没有唯一匹配到这个名称的资源。', candidates: (candidates || []).map(r => r.name) };
      }
      const base = parseTime(`${args?.date || fmtDate(now)}T00:00`) || now;
      const days = Math.min(Math.max(Number(args?.days) || 1, 1), 14);
      const result = Array.from({ length: days }, (_, i) => {
        const day = new Date(base.getTime() + i * DAY_MS);
        const dayKey = fmtDate(day);
        const slots = bookings
          .filter(b => b.resourceId === resource.id && isActiveBooking(b) && fmtDate(new Date(b.startTime)) === dayKey)
          .sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime))
          .map(b => ({
            start: fmtTime(new Date(b.startTime)),
            end: fmtTime(new Date(b.endTime)),
            user: users.find(u => u.id === b.userId)?.name || b.userId,
            status: b.status
          }));
        return { date: dayKey, occupied: slots };
      });
      return { ok: true, data: { resource: resource.name, capacity: resource.capacity, days: result } };
    },

    get_my_todos: () => {
      const deny = needUser();
      if (deny) return deny;
      const todos = buildTodos(db, ctx.userId, now);
      return { ok: true, data: { total: todos.length, todos } };
    },

    list_my_bookings: (args) => {
      const deny = needUser();
      if (deny) return deny;
      const status = args?.status;
      const list = bookings
        .filter(b => b.userId === ctx.userId && (status ? b.status === status : isActiveBooking(b)))
        .sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime))
        .slice(0, 10)
        .map(b => bookingBrief(b, resources, users));
      return { ok: true, data: { total: list.length, bookings: list } };
    },

    get_pending_approvals: () => {
      const deny = needUser();
      if (deny) return deny;
      const groups = getApprovalGroups(bookings, workflow, me!, approvalContext)
        .sort((a, b) => +new Date(a.booking.startTime) - +new Date(b.booking.startTime));
      const list = groups.slice(0, 20).map(({ booking: b, seriesBookings }) => ({
        ...bookingBrief(b, resources, users),
        bookingIds: seriesBookings.map(item => item.id),
        occurrenceCount: seriesBookings.length,
        seriesEndDate: b.seriesEndDate,
        node: getBookingWorkflow(b, workflow)[b.currentNodeIndex]?.name,
        participants: b.participants,
        needsTea: Boolean(b.needsTeaService),
        needsVideo: Boolean(b.isVideoConference)
      }));
      return { ok: true, data: { total: groups.length, pending: list } };
    },

    get_usage_stats: (args) => {
      const days = Math.min(Math.max(Number(args?.days) || 30, 1), 365);
      const from = now.getTime() - days * DAY_MS;
      const scope = bookings.filter(b => +new Date(b.startTime) >= from);
      const byStatus: Record<string, number> = {};
      const byHour = Array.from({ length: 24 }, () => 0);
      const byResource: Record<string, number> = {};
      const byDept: Record<string, number> = {};
      let totalMinutes = 0;

      scope.forEach(b => {
        byStatus[b.status] = (byStatus[b.status] || 0) + 1;
        byHour[new Date(b.startTime).getHours()] += 1;
        const rName = resources.find(r => r.id === b.resourceId)?.name || b.resourceId;
        byResource[rName] = (byResource[rName] || 0) + 1;
        const dept = users.find(u => u.id === b.userId)?.department || '未知';
        byDept[dept] = (byDept[dept] || 0) + 1;
        totalMinutes += Math.max(0, (+new Date(b.endTime) - +new Date(b.startTime)) / 60000);
      });

      const active = scope.filter(b => b.status === 'APPROVED' || b.status === 'COMPLETED');
      const capacityMinutes = resources.length * days * (WORK_END_HOUR - WORK_START_HOUR) * 60;
      const top = (record: Record<string, number>) => Object.entries(record)
        .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));

      return {
        ok: true,
        data: {
          range: `${fmtDate(new Date(from))} ~ ${fmtDate(now)}（${days} 天）`,
          totalBookings: scope.length,
          byStatus,
          topResources: top(byResource),
          byDepartment: top(byDept),
          busiestHours: byHour.map((count, hour) => ({ hour: `${pad2(hour)}:00`, count }))
            .filter(x => x.count > 0).sort((a, b) => b.count - a.count).slice(0, 4),
          avgDurationMinutes: scope.length ? Math.round(totalMinutes / scope.length) : 0,
          noShowCount: scope.filter(b => b.noShow).length,
          utilization: capacityMinutes ? `${Math.round(active.reduce((sum, b) =>
            sum + Math.max(0, (+new Date(b.endTime) - +new Date(b.startTime)) / 60000), 0) / capacityMinutes * 100)}%` : '0%'
        }
      };
    },

    get_work_orders: (args) => {
      const list = workOrders
        .filter(w => (myRoles.includes('SYSTEM_ADMIN') || myRoles.includes(w.assigneeRole)) && (!args?.status || w.status === args.status))
        .slice(0, 20)
        .map(w => ({
          id: w.id, type: SERVICE_TYPE_LABELS[w.type],
          title: w.title, status: w.status, assigneeRole: w.assigneeRole,
          createdAt: fmtRange(new Date(w.createdAt), new Date(w.createdAt))
        }));
      return { ok: true, data: { total: list.length, workOrders: list } };
    },

    propose_complete_work_order: (args) => {
      const deny = needUser();
      if (deny) return deny;
      const order = workOrders.find(o => o.id === args?.workOrderId && o.status === 'TODO'
        && (myRoles.includes('SYSTEM_ADMIN') || myRoles.includes(o.assigneeRole)));
      if (!order) return { ok: false, error: '没有找到你负责的待处理工单。' };
      return {
        ok: true,
        data: { id: order.id, title: order.title, status: order.status },
        action: { type: 'PROPOSE_WORK_ORDER', workOrderId: order.id, summary: `完成${order.title}` }
      };
    },

    propose_booking: (args) => {
      const deny = needUser();
      if (deny) return deny;
      const start = parseTime(args?.startTime);
      const end = parseTime(args?.endTime);
      if (!start || !end) return { ok: false, error: '时间格式无法解析，请给出 YYYY-MM-DDTHH:mm 格式的时间。' };
      if (end <= start) return { ok: false, error: '结束时间必须晚于开始时间。' };
      if ((end.getTime() - start.getTime()) > 8 * 3600 * 1000) return { ok: false, error: '单次预订不能超过 8 小时。' };
      if (start.getTime() < now.getTime()) return { ok: false, error: `开始时间 ${fmtTime(start)} 已经过去了，请确认日期。` };
      if (start.getHours() < WORK_START_HOUR || end.getHours() > WORK_END_HOUR) {
        return { ok: false, error: `可预订时段为每天 ${WORK_START_HOUR}:00–${WORK_END_HOUR}:00，请调整时间。` };
      }

      const { resource, candidates } = resolveResource(resources, args?.resourceName);
      if (!resource) {
        return {
          ok: false,
          error: '没能唯一确定要预订的资源，请让用户从候选中选择。',
          candidates: (candidates || []).map(r => ({ name: r.name, capacity: r.capacity, location: r.location }))
        };
      }
      const participants = args?.participants === undefined ? undefined : Number(args.participants);
      if (args?.meetingType !== undefined && !['NORMAL', 'IMPORTANT'].includes(args.meetingType)) {
        return { ok: false, error: '助手只能生成普通或重要会议草案；涉密属性请在正式表单中明确选择。' };
      }
      if (!isValidBookingPurpose(args?.purpose)) return { ok: false, error: '请提供 200 字以内且有明确主题的申请用途，不能只填写“会议”或“开会”。' };
      const rawServices = args?.serviceRequirements === undefined ? [] : args.serviceRequirements;
      if (!Array.isArray(rawServices) || rawServices.length > 20) return { ok: false, error: '服务需求格式无效，请修订后重试。' };
      const serviceRequirements: BookingServiceRequirement[] = [];
      for (const item of rawServices) {
        if (!item || !isServiceType(item.type)
          || serviceRequirements.some(service => service.type === item.type)
          || (item.details !== undefined && (typeof item.details !== 'string' || item.details.length > 500))
          || (item.fieldValues !== undefined && (!item.fieldValues || typeof item.fieldValues !== 'object' || Array.isArray(item.fieldValues)
            || Object.entries(item.fieldValues).length > 20
            || Object.entries(item.fieldValues).some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || key.length > 50 || typeof value !== 'string' || value.length > 500)))) {
          return { ok: false, error: '服务需求格式无效或存在重复项，请修订后重试。' };
        }
        const details = item.details?.trim() || undefined;
        if (item.type === 'OTHER' && !details) return { ok: false, error: '其他服务需要填写具体说明。' };
        const fieldValues = item.fieldValues === undefined ? undefined : Object.fromEntries(Object.entries(item.fieldValues).map(([key, value]) => [key, (value as string).trim()]));
        serviceRequirements.push({ type: item.type, ...(details ? { details } : {}), ...(fieldValues ? { fieldValues } : {}) });
      }
      if (args?.needsTea && !serviceRequirements.some(item => item.type === 'TEA')) serviceRequirements.push({ type: 'TEA' });
      if (args?.needsVideo && !serviceRequirements.some(item => item.type === 'VIDEO')) serviceRequirements.push({ type: 'VIDEO' });
      const needsTea = serviceRequirements.some(item => item.type === 'TEA');
      const needsVideo = serviceRequirements.some(item => item.type === 'VIDEO');
      let auditoriumSetup: AuditoriumSetup | undefined;
      if (args?.auditoriumSetup !== undefined) {
        const setup = args.auditoriumSetup;
        if (resource.roomCategory !== 'AUDITORIUM' || !setup || !['THEATER', 'CLASSROOM', 'ROUNDTABLE'].includes(setup.seatingLayout)
          || typeof setup.stageRequired !== 'boolean'
          || (setup.rehearsalMinutes !== undefined && (!Number.isInteger(setup.rehearsalMinutes) || setup.rehearsalMinutes < 0 || setup.rehearsalMinutes > 1440))
          || (setup.notes !== undefined && (typeof setup.notes !== 'string' || setup.notes.length > 500))) {
          return { ok: false, error: '礼堂布置参数无效，请确认座位布局、舞台和彩排时长。' };
        }
        auditoriumSetup = {
          seatingLayout: setup.seatingLayout,
          stageRequired: setup.stageRequired,
          rehearsalMinutes: setup.rehearsalMinutes,
          notes: setup.notes?.trim() || undefined
        };
      }
      if (args?.exclusiveRequestReason !== undefined
        && (typeof args.exclusiveRequestReason !== 'string' || args.exclusiveRequestReason.trim().length < 2 || args.exclusiveRequestReason.trim().length > 500)) {
        return { ok: false, error: '专属资源申请理由需为 2–500 个字符。' };
      }
      const requiredFeatures = needsVideo ? ['VIDEO' as const] : [];
      const resourceError = validateBookingResource(resource, {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        participants,
        requiredFeatures
      });
      if (resourceError === 'RESOURCE_MAINTENANCE' || resourceError === 'RESOURCE_UNAVAILABLE') {
        return { ok: false, error: `${resource.name} 当前状态为 ${resource.status}，不可预订。` };
      }
      if (resourceError === 'INVALID_PARTICIPANTS') return { ok: false, error: '参与人数必填，且必须为大于 0 的整数。' };
      if (resourceError === 'CAPACITY_EXCEEDED') {
        return { ok: false, error: `${resource.name} 只能容纳 ${resource.capacity || 1} 人，无法满足 ${participants} 人。` };
      }
      if (resourceError === 'REQUIRED_FEATURE_UNAVAILABLE') {
        return { ok: false, error: `${resource.name} 未配置视频会议系统，请选择支持视频会议的会议室。` };
      }
      if (resourceError) return { ok: false, error: '预约时间、人数或资源信息无效，请调整后重试。' };

      const conflicts = findBookingConflicts(bookings, {
        resourceId: resource.id, startTime: start.toISOString(), endTime: end.toISOString()
      });
      if (conflicts.length) {
        const slot = findNextAvailableSlot(resource.id, bookings, Math.round((end.getTime() - start.getTime()) / 60000), start);
        return {
          ok: false,
          error: `${resource.name} 在该时段已被占用，最近空档是 ${fmtRange(slot.start, slot.end)}。`,
          candidates: conflicts.map(c => ({
            ...bookingBrief(c, resources, users),
            nextFree: fmtRange(slot.start, slot.end)
          }))
        };
      }

      const attendeeIds: string[] = [];
      for (const rawName of Array.isArray(args?.attendeeNames) ? args.attendeeNames : []) {
        const name = String(rawName).trim();
        if (!name) return { ok: false, error: '参会人姓名不能为空。' };
        const matches = users.filter(user => norm(user.name) === norm(name) || norm(user.name).includes(norm(name)));
        if (matches.length !== 1) {
          return {
            ok: false,
            error: matches.length ? `参会人“${name}”匹配到多位成员，请提供更完整姓名。` : `没有找到参会人“${name}”，请核对姓名。`,
            candidates: matches.map(user => ({ id: user.id, name: user.name, department: user.department }))
          };
        }
        if (!attendeeIds.includes(matches[0].id)) attendeeIds.push(matches[0].id);
      }

      const draft: Partial<Booking> = {
        userId: ctx.userId,
        resourceId: resource.id,
        type: resource.type,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        purpose: String(args.purpose).trim(),
        participants,
        status: 'PENDING',
        currentNodeIndex: 0,
        approvalHistory: [],
        meetingType: args?.meetingType,
        needsTeaService: needsTea,
        isVideoConference: needsVideo,
        serviceRequirements,
        exclusiveRequestReason: resource.isExclusive ? args?.exclusiveRequestReason?.trim() : undefined,
        auditoriumSetup,
        requiredFeatures,
        attendeeIds: attendeeIds.length ? attendeeIds : undefined,
        hasLeader: Boolean(args?.hasLeader),
        leaderDetails: args?.hasLeader ? String(args?.leaderDetails || '') : undefined,
        recurrence: args?.repeatFrequency === 'WEEKLY' || args?.repeatFrequency === 'BIWEEKLY'
          ? { frequency: args.repeatFrequency, count: [2, 3, 4, 6, 8, 12].includes(Number(args?.repeatCount)) ? Number(args.repeatCount) : 4 }
          : undefined
      };

      const summary = [
        resource.name,
        fmtRange(start, end),
        `${participants} 人`,
        needsVideo ? '需视频' : '',
        needsTea ? '需茶水' : '',
        serviceRequirements.some(item => item.type === 'SIGNAGE') ? '需指引标识' : '',
        serviceRequirements.some(item => item.type === 'SECURITY') ? '需安保' : '',
        `用途：${draft.purpose}`
      ].filter(Boolean).join(' · ');

      return {
        ok: true,
        data: { draft, summary, firstApprovalNode: workflow[0]?.name || '无需审批' },
        action: { type: 'PROPOSE_BOOKING', draft, summary }
      };
    },

    propose_edit_booking: (args) => {
      const deny = needUser();
      if (deny) return deny;
      const editable = bookings.filter(booking => booking.userId === ctx.userId
        && ['PENDING', 'APPROVED'].includes(booking.status)
        && booking.meetingType !== 'CONFIDENTIAL'
        && booking.confidentialityChoice !== 'CONFIDENTIAL');
      const { booking, candidates } = resolveBooking(editable, resources, users, args?.bookingKeyword);
      if (!booking) {
        return {
          ok: false,
          error: candidates?.length ? '有多条可修改预约，请让用户确认。' : '没有找到可修改的本人预约；涉密变更请在正式表单按授权流程处理。',
          candidates: (candidates || []).map(item => bookingBrief(item, resources, users))
        };
      }
      const resource = resources.find(item => item.id === booking.resourceId);
      if (!resource) return { ok: false, error: '原预约资源已不存在，请取消后重新申请。' };
      const start = args?.startTime === undefined ? new Date(booking.startTime) : parseTime(args.startTime);
      const end = args?.endTime === undefined ? new Date(booking.endTime) : parseTime(args.endTime);
      if (!start || !end) return { ok: false, error: '新的时间格式无法解析，请使用 YYYY-MM-DDTHH:mm。' };
      if (end <= start) return { ok: false, error: '结束时间必须晚于开始时间。' };
      if ((end.getTime() - start.getTime()) > 8 * 3600 * 1000) return { ok: false, error: '单次预订不能超过 8 小时。' };
      if (start.getTime() < now.getTime()) return { ok: false, error: '新的开始时间已经过去，请重新选择。' };
      if (start.getHours() < WORK_START_HOUR || end.getHours() > WORK_END_HOUR) return { ok: false, error: `可预订时段为每天 ${WORK_START_HOUR}:00–${WORK_END_HOUR}:00。` };
      const purpose = args?.purpose === undefined ? booking.purpose : String(args.purpose).trim();
      if (!isValidBookingPurpose(purpose)) return { ok: false, error: '请提供明确且 200 字以内的申请用途。' };
      const participants = args?.participants === undefined ? booking.participants : Number(args.participants);
      const requiredFeatures = booking.requiredFeatures || [];
      const resourceError = validateBookingResource(resource, {
        startTime: start.toISOString(), endTime: end.toISOString(), participants, requiredFeatures
      });
      if (resourceError === 'INVALID_PARTICIPANTS') return { ok: false, error: '参与人数必须为大于 0 的整数。' };
      if (resourceError === 'CAPACITY_EXCEEDED') return { ok: false, error: `${resource.name} 只能容纳 ${resource.capacity || 1} 人。` };
      if (resourceError) return { ok: false, error: '新的时间、人数或资源状态不满足预约规则，请调整后重试。' };
      const conflicts = findBookingConflicts(bookings.filter(item => item.id !== booking.id), {
        resourceId: resource.id, startTime: start.toISOString(), endTime: end.toISOString()
      });
      if (conflicts.length) return { ok: false, error: `${resource.name} 在新时段已被占用，请选择其他时间。` };
      const draft: Partial<Booking> = {
        userId: booking.userId,
        resourceId: booking.resourceId,
        type: booking.type,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        purpose,
        participants,
        meetingType: booking.meetingType,
        serviceRequirements: booking.serviceRequirements || [],
        exclusiveRequestReason: booking.exclusiveRequestReason,
        auditoriumSetup: booking.auditoriumSetup,
        hasLeader: booking.hasLeader,
        leaderDetails: booking.leaderDetails,
        isVideoConference: booking.isVideoConference,
        needsTeaService: booking.needsTeaService,
        requiredFeatures,
        attendeeIds: booking.attendeeIds || []
      };
      return {
        ok: true,
        data: { bookingId: booking.id, draft },
        action: {
          type: 'PROPOSE_EDIT_BOOKING', bookingId: booking.id, draft,
          summary: `修改「${booking.purpose}」 · ${resource.name} · ${fmtRange(start, end)} · ${participants || 1} 人`
        }
      };
    },

    propose_renew_booking: (args) => {
      const deny = needUser();
      if (deny) return deny;
      const renewable = bookings.filter(booking => booking.userId === ctx.userId
        && booking.status === 'APPROVED'
        && booking.seriesKind === 'LONG_TERM'
        && booking.recurrenceIndex === 0
        && Boolean(booking.seriesId));
      const { booking, candidates } = resolveBooking(renewable, resources, users, args?.bookingKeyword);
      if (!booking) {
        return {
          ok: false,
          error: candidates?.length ? '有多个长期系列匹配，请让用户确认。' : '没有找到可续期的本人长期预约。',
          candidates: (candidates || []).map(item => bookingBrief(item, resources, users))
        };
      }
      const resource = resources.find(item => item.id === booking.resourceId);
      if (!resource || !isResourceAcceptingBookings(resource)) return { ok: false, error: '会议室当前维护或待开放，暂不能续期。' };
      if (bookings.some(item => item.renewalOfSeriesId === booking.seriesId && isActiveBooking(item))) return { ok: false, error: '本期已有审批中或已核准的续期，无需重复提交。' };
      if (bookings.some(item => item.seriesId === booking.seriesId && item.status === 'PENDING')) return { ok: false, error: '请等待当前长期预订完成审批后再续期。' };
      return {
        ok: true,
        data: { bookingId: booking.id, seriesId: booking.seriesId, seriesEndDate: booking.seriesEndDate },
        action: {
          type: 'PROPOSE_RENEW_BOOKING', bookingId: booking.id,
          summary: `续期「${booking.purpose}」 · 当前周期至 ${booking.seriesEndDate || '系列结束日'}`
        }
      };
    },

    propose_cancel: (args) => {
      const deny = needUser();
      if (deny) return deny;
      const mine = bookings.filter(b => b.userId === ctx.userId);
      const { booking, candidates } = resolveBooking(mine, resources, users, args?.bookingKeyword);
      if (!booking) {
        return {
          ok: false,
          error: candidates?.length
            ? '有多条可能匹配的预订，请让用户确认是哪一条。'
            : '没有找到匹配的预订。',
          candidates: (candidates || []).map(b => bookingBrief(b, resources, users))
        };
      }
      if (!isActiveBooking(booking)) {
        return { ok: false, error: `该预订当前状态是 ${booking.status}，无法取消。` };
      }
      const brief = bookingBrief(booking, resources, users);
      return {
        ok: true,
        data: brief,
        action: { type: 'PROPOSE_CANCEL', bookingId: booking.id, summary: `${brief.resource} · ${brief.start}` }
      };
    },

    propose_approval: (args) => {
      const deny = needUser();
      if (deny) return deny;
      if (!args?.bookingKeyword) return { ok: false, error: '需要告诉我要审批哪一条申请。' };
      const groups = getApprovalGroups(bookings, workflow, me!, approvalContext);
      const { booking, candidates } = resolveBooking(groups.map(group => group.booking), resources, users, args.bookingKeyword);
      if (!booking) {
        return {
          ok: false,
          error: candidates?.length ? '有多条待审批申请匹配，请让用户确认。' : '当前没有匹配的待审批申请。',
          candidates: (candidates || []).map(b => bookingBrief(b, resources, users))
        };
      }
      const decision = args?.decision === 'REJECT' ? 'REJECT' : 'APPROVE';
      if (decision === 'REJECT' && !String(args?.comment || '').trim()) {
        return { ok: false, error: '驳回必须填写审批意见。' };
      }
      const group = groups.find(item => item.booking.id === booking.id)!;
      const approverName = me!.name;
      const bookingWorkflow = getBookingWorkflow(booking, workflow);
      const next = decision === 'APPROVE'
        ? approveBooking(booking, workflow, approverName, args?.comment)
        : rejectBooking(booking, workflow, approverName, String(args.comment || ''));
      const brief = bookingBrief(booking, resources, users);
      const seriesSuffix = group.seriesBookings.length > 1 ? ` · 共 ${group.seriesBookings.length} 个会议日` : '';
      return {
        ok: true,
        data: {
          ...brief,
          bookingIds: group.seriesBookings.map(item => item.id),
          occurrenceCount: group.seriesBookings.length,
          decision: decision === 'APPROVE' ? '通过' : '驳回',
          resultStatus: next.status,
          nextNode: next.status === 'PENDING' ? bookingWorkflow[next.currentNodeIndex]?.name : null
        },
        action: {
          type: 'PROPOSE_APPROVAL',
          bookingId: booking.id,
          bookingIds: group.seriesBookings.map(item => item.id),
          decision,
          comment: args?.comment,
          summary: `${decision === 'APPROVE' ? '通过' : '驳回'} · ${brief.user} · ${brief.resource} · ${brief.start}${seriesSuffix}`
        }
      };
    },

    propose_check_in: (args) => {
      const deny = needUser();
      if (deny) return deny;
      const mine = bookings.filter(b => (b.userId === ctx.userId || b.attendeeIds?.includes(ctx.userId)) && b.status === 'APPROVED');
      const { booking, candidates } = resolveBooking(mine, resources, users, args?.bookingKeyword);
      if (!booking) {
        return {
          ok: false,
          error: candidates?.length ? '有多条可签到预订，请让用户确认。' : '没有找到已通过审批的预订。',
          candidates: (candidates || []).map(b => bookingBrief(b, resources, users))
        };
      }
      if (booking.checkedInAt) return { ok: false, error: '该预订已经签过到了。' };
      const start = new Date(booking.startTime);
      const end = new Date(booking.endTime);
      const diffMinutes = (now.getTime() - start.getTime()) / 60000;
      if (diffMinutes < -15) {
        return { ok: false, error: `还没到签到时间，预订 ${fmtRange(start, end)} 开始前 15 分钟才能签到。` };
      }
      if (now.getTime() >= end.getTime()) return { ok: false, error: '该会议已经结束，不能再签到。' };
      const brief = bookingBrief(booking, resources, users);
      return {
        ok: true,
        data: brief,
        action: { type: 'PROPOSE_CHECK_IN', bookingId: booking.id, summary: `${brief.resource} · ${brief.start}` }
      };
    }
  };

  return handlers;
};

/** 给 system prompt 用的实时上下文，让模型不需要猜测"今天几号""我是谁""有哪些资源"。 */
export const buildContextSummary = (db: OfficeDb, ctx: AgentContext) => {
  const now = ctx.now ?? new Date();
  const me = (db.users || []).find(u => u.id === ctx.userId);
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  const resources = (db.resources || []).map(r =>
    `${r.name}（${r.type === 'ROOM' ? '会议室' : '工位'}，${r.capacity || 1}人，${r.location}，${(r.features || []).join('/') || '无设备'}，${r.status}）`
  );
  const activeBookings = (db.bookings || []).filter(isActiveBooking).length;
  const workflow = (db.workflow || []).map(n => n.name).join(' → ') || '无';

  return [
    `当前时间：${fmtDate(now)} ${fmtTime(now)} ${weekday}（时区 Asia/Shanghai）`,
    `当前用户：${me?.name || '未知'}（${me?.department || '未知部门'}，角色 ${(me?.role || []).join('/') || '未知'}）`,
    `资源清单：${resources.join('；') || '无'}`,
    `审批流程：${workflow}`,
    `活跃预订：${activeBookings} 条`
  ].join('\n');
};

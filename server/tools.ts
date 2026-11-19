import type { Booking, Resource, User, ApprovalNode, WorkOrder, RoleDefinition, Department } from '../types.ts';
import { findBookingConflicts, isActiveBooking, findNextAvailableSlot } from '../utils/bookingRules.ts';
import { approveBooking, canApproveBooking, rejectBooking } from '../utils/approval.ts';

export interface OfficeDb {
  roles?: RoleDefinition[];
  users?: User[];
  resources?: Resource[];
  bookings?: Booking[];
  departments?: Department[];
  workflow?: ApprovalNode[];
  workOrders?: WorkOrder[];
}

export interface AgentContext {
  userId: string;
  now?: Date;
}

export type AgentAction =
  | { type: 'NAVIGATE'; view: string }
  | { type: 'PROPOSE_BOOKING'; draft: Partial<Booking> ; summary: string }
  | { type: 'PROPOSE_CANCEL'; bookingId: string; summary: string }
  | { type: 'PROPOSE_APPROVAL'; bookingId: string; decision: 'APPROVE' | 'REJECT'; comment?: string; summary: string }
  | { type: 'PROPOSE_CHECK_IN'; bookingId: string; summary: string }
  | { type: 'REFRESH' };

export interface ToolResult {
  ok: boolean;
  data?: any;
  action?: AgentAction;
  error?: string;
  candidates?: any[];
  hint?: string;
}

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

export const TOOLS = [
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
      name: 'propose_booking',
      description: '生成一条预订提案（不会直接落库），返回冲突检测结果和待确认的草稿。用户确认后由前端提交。',
      parameters: {
        type: 'object',
        properties: {
          resourceName: { type: 'string', description: '资源名称，必须来自 find_available_resources 的结果' },
          startTime: { type: 'string', description: 'ISO 8601 本地时间' },
          endTime: { type: 'string', description: 'ISO 8601 本地时间' },
          purpose: { type: 'string', description: '会议用途' },
          participants: { type: 'number' },
          needsTea: { type: 'boolean', description: '是否需要茶水服务' },
          needsVideo: { type: 'boolean', description: '是否需要视频会议支持' },
          attendeeNames: { type: 'array', items: { type: 'string' }, description: '参会人姓名' }
        },
        required: ['resourceName', 'startTime', 'endTime', 'purpose']
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

/** 按角色裁剪工具集：员工看不到审批类工具，服务端不依赖模型自觉。 */
export const toolsForRoles = (roles: string[] = []) => TOOLS.filter(tool => {
  const name = tool.function.name;
  if (APPROVER_TOOLS.has(name)) return roles.includes('APPROVAL_ADMIN') || roles.includes('SYSTEM_ADMIN');
  if (ADMIN_TOOLS.has(name)) return roles.includes('SYSTEM_ADMIN') || roles.includes('APPROVAL_ADMIN');
  return true;
});

export const createExecutor = (db: OfficeDb, ctx: AgentContext) => {
  const now = ctx.now ?? new Date();
  const resources = db.resources || [];
  const bookings = db.bookings || [];
  const users = db.users || [];
  const workflow = db.workflow || [];
  const workOrders = db.workOrders || [];
  const me = users.find(u => u.id === ctx.userId);
  const myRoles = me?.role || [];

  const needUser = (): ToolResult | null =>
    me ? null : { ok: false, error: '无法识别当前用户身份，请重新登录后再试。' };

  const handlers: Record<string, (args: any) => ToolResult> = {
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
        if (r.status !== 'AVAILABLE') return false;
        if (args?.type && r.type !== args.type) return false;
        if ((r.capacity || 1) < participants) return false;
        if (wants.some(w => !matchFeature(r, w))) return false;
        return findBookingConflicts(bookings, {
          resourceId: r.id, startTime: start.toISOString(), endTime: end.toISOString()
        }).length === 0;
      }).sort((a, b) => ((a.capacity || 1) - (b.capacity || 1)) || a.name.localeCompare(b.name, 'zh-CN'));

      if (eligible.length === 0) {
        const relaxed = resources
          .filter(r => r.status === 'AVAILABLE' && (r.capacity || 1) >= participants)
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
      const list = bookings
        .filter(b => canApproveBooking(b, workflow, myRoles))
        .sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime))
        .slice(0, 20)
        .map(b => ({
          ...bookingBrief(b, resources, users),
          node: workflow[b.currentNodeIndex]?.name,
          participants: b.participants,
          needsTea: Boolean(b.needsTeaService),
          needsVideo: Boolean(b.isVideoConference)
        }));
      return { ok: true, data: { total: list.length, pending: list } };
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
        .filter(w => !args?.status || w.status === args.status)
        .slice(0, 20)
        .map(w => ({
          id: w.id, type: w.type === 'TEA' ? '茶水服务' : '视频支持',
          title: w.title, status: w.status, assigneeRole: w.assigneeRole,
          createdAt: fmtRange(new Date(w.createdAt), new Date(w.createdAt))
        }));
      return { ok: true, data: { total: list.length, workOrders: list } };
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
      if (resource.status !== 'AVAILABLE') {
        return { ok: false, error: `${resource.name} 当前状态为 ${resource.status}，不可预订。` };
      }
      const participants = Number(args?.participants) || 1;
      if ((resource.capacity || 1) < participants) {
        return { ok: false, error: `${resource.name} 只能容纳 ${resource.capacity || 1} 人，无法满足 ${participants} 人。` };
      }

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

      const attendeeIds = (Array.isArray(args?.attendeeNames) ? args.attendeeNames : [])
        .map((n: string) => users.find(u => norm(u.name) === norm(n) || norm(u.name).includes(norm(n)))?.id)
        .filter(Boolean) as string[];

      const draft: Partial<Booking> = {
        userId: ctx.userId,
        resourceId: resource.id,
        type: resource.type,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        purpose: String(args?.purpose || '会议'),
        participants,
        status: 'PENDING',
        currentNodeIndex: 0,
        approvalHistory: [],
        needsTeaService: Boolean(args?.needsTea),
        isVideoConference: Boolean(args?.needsVideo),
        attendeeIds: attendeeIds.length ? attendeeIds : undefined
      };

      const summary = [
        resource.name,
        fmtRange(start, end),
        `${participants} 人`,
        args?.needsVideo ? '需视频' : '',
        args?.needsTea ? '需茶水' : '',
        `用途：${draft.purpose}`
      ].filter(Boolean).join(' · ');

      return {
        ok: true,
        data: { draft, summary, firstApprovalNode: workflow[0]?.name || '无需审批' },
        action: { type: 'PROPOSE_BOOKING', draft, summary }
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
      const pendingList = bookings.filter(b => canApproveBooking(b, workflow, myRoles));
      const { booking, candidates } = resolveBooking(pendingList, resources, users, args.bookingKeyword);
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
      const approverName = me!.name;
      const next = decision === 'APPROVE'
        ? approveBooking(booking, workflow, approverName, args?.comment)
        : rejectBooking(booking, workflow, approverName, String(args.comment || ''));
      const brief = bookingBrief(booking, resources, users);
      return {
        ok: true,
        data: {
          ...brief,
          decision: decision === 'APPROVE' ? '通过' : '驳回',
          resultStatus: next.status,
          nextNode: next.status === 'PENDING' ? workflow[next.currentNodeIndex]?.name : null
        },
        action: {
          type: 'PROPOSE_APPROVAL',
          bookingId: booking.id,
          decision,
          comment: args?.comment,
          summary: `${decision === 'APPROVE' ? '通过' : '驳回'} · ${brief.user} · ${brief.resource} · ${brief.start}`
        }
      };
    },

    propose_check_in: (args) => {
      const deny = needUser();
      if (deny) return deny;
      const mine = bookings.filter(b => b.userId === ctx.userId && b.status === 'APPROVED');
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
      const diffMinutes = (now.getTime() - start.getTime()) / 60000;
      if (diffMinutes < -30) {
        return { ok: false, error: `还没到签到时间，预订 ${fmtRange(start, new Date(booking.endTime))} 开始前 30 分钟才能签到。` };
      }
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

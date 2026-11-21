
import type { User, Resource, ApprovalNode, Department, RoleDefinition, BookingRuleSettings, ServiceCatalogItem } from './types.ts';

export const INITIAL_ROLES: RoleDefinition[] = [
  { id: 'SYSTEM_ADMIN', name: '系统管理员', description: '负责系统配置、运维和最终核准', color: 'indigo' },
  { id: 'APPROVAL_ADMIN', name: '审批负责人', description: '负责各类资源申请的业务审核', color: 'amber' },
  { id: 'EMPLOYEE', name: '正式员工', description: '可申请并使用公司公共资源', color: 'emerald' },
  { id: 'SECURITY_ADMIN', name: '保密管理员', description: '负责涉密白名单、授权和保密审批', color: 'red' },
  { id: 'SERVICE_COORDINATOR', name: '会务协调员', description: '负责会务服务执行与异常处理', color: 'blue' },
  { id: 'FRONT_DESK', name: '前台人员', description: '负责现场签到、巡查和人工释放', color: 'cyan' },
  { id: 'AUDITOR', name: '审计员', description: '按授权范围查询审计和运行证据', color: 'slate' },
];

export const INITIAL_DEPARTMENTS: Department[] = [
  { id: 'dpt-root', name: '集团总部' },
  { id: 'dpt1', name: '信息技术部', parentId: 'dpt-root' },
  { id: 'dpt1-1', name: '架构组', parentId: 'dpt1' },
  { id: 'dpt1-2', name: '运维组', parentId: 'dpt1' },
  { id: 'dpt2', name: '行政部', parentId: 'dpt-root' },
  { id: 'dpt3', name: '市场部', parentId: 'dpt-root' },
  { id: 'dpt4', name: '销售部', parentId: 'dpt-root' },
];

export const INITIAL_USERS: User[] = [
  { id: '1', name: '超级管理员', email: 'sysadmin@company.com', role: ['SYSTEM_ADMIN'], department: '架构组', landline: '010-88886666', mobile: '13800000001' },
  { id: '2', name: '审批负责人', email: 'approver@company.com', role: ['APPROVAL_ADMIN'], department: '行政部', landline: '010-88886667', mobile: '13800000002' },
  { id: '3', name: '李员工', email: 'li@company.com', role: ['EMPLOYEE'], department: '市场部', landline: '010-88886668', mobile: '13800000003' },
];

export const INITIAL_RESOURCES: Resource[] = [
  { id: 'r1', code: 'R1', name: 'Alpha 战略会议室', type: 'ROOM', capacity: 10, location: '1号楼 10层', building: 'MAIN', floor: 10, roomCategory: 'SMALL', features: ['投屏显示器', '视频会议系统'], status: 'AVAILABLE', isPublic: true, isExclusive: false },
  { id: 'r2', code: 'R2', name: 'Beta 灵感会议室', type: 'ROOM', capacity: 4, location: '1号楼 10层', building: 'MAIN', floor: 10, roomCategory: 'SMALL', features: ['白板', '多孔插座'], status: 'AVAILABLE', isPublic: true, isExclusive: false },
  { id: 'd1', code: 'D1', name: '工位 A-101', type: 'DESK', location: 'A办公区', features: ['双显示器'], status: 'AVAILABLE', isPublic: true, isExclusive: false },
];

export const DEFAULT_RULE_SETTINGS: BookingRuleSettings = {
  smallRoomMaxCapacity: 10,
  mediumRoomMaxCapacity: 30,
  departmentDailyNetMinutes: 240,
  exclusiveRequestOpenHours: 24,
  standardCancellationCutoffMinutes: 30,
  servicedCancellationCutoffMinutes: 120,
  approvalReminderAfterMinutes: 60,
  approvalEscalationAfterMinutes: 120,
  unapprovedCloseBeforeStartMinutes: 30,
  checkInReminderAfterStartMinutes: 10,
  noShowReleaseAfterStartMinutes: 20,
  longTermMaxCalendarMonths: 1,
  approvalWorkStartMinutes: 9 * 60,
  approvalWorkEndMinutes: 18 * 60,
  approvalHolidays: []
};

export const DEFAULT_SERVICE_CATALOG: ServiceCatalogItem[] = [
  {
    id: 'service-tea', type: 'TEA', name: '茶水服务', version: 1,
    fields: [
      { key: 'servings', label: '茶水份数', type: 'NUMBER', required: false },
      { key: 'notes', label: '茶水与送达要求', type: 'TEXTAREA', required: false }
    ],
    responsibleRole: 'SERVICE_COORDINATOR', slaResponseMinutes: 10, heavyService: false,
    cancellable: true, resourceTypes: ['ROOM'], updatedAt: '2026-11-21T00:00:00.000Z', updatedBy: 'system'
  },
  {
    id: 'service-video', type: 'VIDEO', name: '视频会议保障', version: 1,
    fields: [
      { key: 'platform', label: '会议平台', type: 'TEXT', required: false },
      { key: 'notes', label: '联调与保障要求', type: 'TEXTAREA', required: false }
    ],
    responsibleRole: 'SERVICE_COORDINATOR', slaResponseMinutes: 10, heavyService: true,
    cancellable: true, resourceTypes: ['ROOM'], updatedAt: '2026-11-21T00:00:00.000Z', updatedBy: 'system'
  },
  {
    id: 'service-signage', type: 'SIGNAGE', name: '引导与标识', version: 1,
    fields: [{ key: 'notes', label: '标识文案与摆放要求', type: 'TEXTAREA', required: true }],
    responsibleRole: 'FRONT_DESK', slaResponseMinutes: 10, heavyService: true,
    cancellable: true, resourceTypes: ['ROOM'], updatedAt: '2026-11-21T00:00:00.000Z', updatedBy: 'system'
  },
  {
    id: 'service-security', type: 'SECURITY', name: '现场安保', version: 1,
    fields: [{ key: 'notes', label: '安保范围与到场要求', type: 'TEXTAREA', required: true }],
    responsibleRole: 'SERVICE_COORDINATOR', slaResponseMinutes: 10, heavyService: true,
    cancellable: false, resourceTypes: ['ROOM'], updatedAt: '2026-11-21T00:00:00.000Z', updatedBy: 'system'
  },
  {
    id: 'service-other', type: 'OTHER', name: '其他会务服务', version: 1,
    fields: [{ key: 'notes', label: '服务内容、责任边界与成本说明', type: 'TEXTAREA', required: true }],
    responsibleRole: 'SERVICE_COORDINATOR', slaResponseMinutes: 10, heavyService: true,
    cancellable: true, resourceTypes: ['ROOM'], updatedAt: '2026-11-21T00:00:00.000Z', updatedBy: 'system'
  }
];

export const DEFAULT_WORKFLOW: ApprovalNode[] = [
  { id: 'n1', name: '行政预审', approverRole: 'APPROVAL_ADMIN' },
  { id: 'n2', name: '最终核准', approverRole: 'SYSTEM_ADMIN' }
];

export const INITIAL_BOOKINGS: any[] = [];
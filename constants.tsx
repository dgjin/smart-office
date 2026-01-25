
import { User, Resource, ApprovalNode, Department, RoleDefinition } from './types';

export const INITIAL_ROLES: RoleDefinition[] = [
  { id: 'SYSTEM_ADMIN', name: '系统管理员', description: '拥有全系统最高管理权限', color: 'indigo' },
  { id: 'APPROVAL_ADMIN', name: '审批负责人', description: '负责各类资源申请的业务审核', color: 'amber' },
  { id: 'EMPLOYEE', name: '正式员工', description: '可申请并使用公司公共资源', color: 'emerald' },
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
  { id: '1', name: '超级管理员', email: 'sysadmin@company.com', password: '123456', role: ['SYSTEM_ADMIN'], department: '架构组', landline: '010-88886666', mobile: '13800000001', needsPasswordChange: true },
  { id: '2', name: '审批负责人', email: 'approver@company.com', password: '123456', role: ['APPROVAL_ADMIN'], department: '行政部', landline: '010-88886667', mobile: '13800000002', needsPasswordChange: true },
  { id: '3', name: '李员工', email: 'li@company.com', password: '123456', role: ['EMPLOYEE'], department: '市场部', landline: '010-88886668', mobile: '13800000003', needsPasswordChange: true },
];

export const INITIAL_RESOURCES: Resource[] = [
  { id: 'r1', name: 'Alpha 战略会议室', type: 'ROOM', capacity: 10, location: '1号楼 10层', features: ['投屏显示器', '视频会议系统'], status: 'AVAILABLE' },
  { id: 'r2', name: 'Beta 灵感会议室', type: 'ROOM', capacity: 4, location: '1号楼 10层', features: ['白板', '多孔插座'], status: 'AVAILABLE' },
  { id: 'd1', name: '工位 A-101', type: 'DESK', location: 'A办公区', features: ['双显示器'], status: 'AVAILABLE' },
];

export const DEFAULT_WORKFLOW: ApprovalNode[] = [
  { id: 'n1', name: '行政预审', approverRole: 'APPROVAL_ADMIN' },
  { id: 'n2', name: '最终核准', approverRole: 'SYSTEM_ADMIN' }
];

export const INITIAL_BOOKINGS: any[] = [];

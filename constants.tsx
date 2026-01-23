
import { User, Resource, ApprovalNode } from './types';

export const INITIAL_USERS: User[] = [
  { id: '1', name: '超级管理员', email: 'sysadmin@company.com', role: ['SYSTEM_ADMIN', 'APPROVAL_ADMIN'], department: '信息技术部' },
  { id: '2', name: '审批负责人', email: 'approver@company.com', role: ['APPROVAL_ADMIN'], department: '行政部' },
  { id: '3', name: '李员工', email: 'li@company.com', role: ['EMPLOYEE'], department: '市场部' },
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


import { User, Resource } from './types';

export const INITIAL_USERS: User[] = [
  { id: '1', name: '系统管理员', email: 'admin@company.com', role: 'ADMIN', department: '行政部' },
  { id: '2', name: '张三', email: 'zhang@company.com', role: 'EMPLOYEE', department: '研发部' },
  { id: '3', name: '李四', email: 'li@company.com', role: 'EMPLOYEE', department: '市场部' },
];

export const INITIAL_RESOURCES: Resource[] = [
  { id: 'r1', name: 'Alpha 战略会议室', type: 'ROOM', capacity: 10, location: '1号楼 10层', features: ['投屏显示器', '视频会议系统'], status: 'AVAILABLE' },
  { id: 'r2', name: 'Beta 灵感会议室', type: 'ROOM', capacity: 4, location: '1号楼 10层', features: ['白板', '多孔插座'], status: 'AVAILABLE' },
  { id: 'r3', name: '多功能路演大厅', type: 'ROOM', capacity: 50, location: '2号楼 1层', features: ['投影仪', '专业音响', '麦克风'], status: 'AVAILABLE' },
  { id: 'd1', name: '工位 A-101', type: 'DESK', location: 'A办公区', features: ['双显示器'], status: 'AVAILABLE' },
  { id: 'd2', name: '工位 A-102', type: 'DESK', location: 'A办公区', features: ['升降桌'], status: 'AVAILABLE' },
  { id: 'd3', name: '工位 B-201', type: 'DESK', location: 'B办公区', features: ['靠窗位'], status: 'AVAILABLE' },
];

export const INITIAL_BOOKINGS: any[] = [];

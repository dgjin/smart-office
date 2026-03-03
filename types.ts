
export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  color: string;
}

export type Role = string; // IDs of RoleDefinition

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: Role[]; 
  department: string;
  landline?: string;
  mobile?: string;
  avatar?: string;
}

export interface Department {
  id: string;
  name: string;
  parentId?: string;
}

export type ResourceType = 'ROOM' | 'DESK';
export type ResourceStatus = 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'PENDING';

export interface Resource {
  id: string;
  name: string;
  type: ResourceType;
  capacity?: number;
  location: string;
  features: string[];
  status: ResourceStatus;
}

export type BookingStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED';

export interface ApprovalNode {
  id: string;
  name: string;
  approverRole: Role;
}

export interface ApprovalRecord {
  nodeName: string;
  approverName: string;
  status: 'APPROVED' | 'REJECTED';
  timestamp: string;
  comment?: string;
}

export interface Booking {
  id: string;
  userId: string;
  resourceId: string;
  type: ResourceType;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  purpose: string;
  participants?: number;
  createdAt: string;
  currentNodeIndex: number;
  approvalHistory: ApprovalRecord[];
  // New optional fields
  hasLeader?: boolean;
  leaderDetails?: string;
  isVideoConference?: boolean;
  needsTeaService?: boolean;
  needsNameCard?: boolean;
  nameCardDetails?: string;
  // 长期预订相关字段
  isLongTerm?: boolean;
  longTermGroupId?: string;
  longTermStartDate?: string;
  longTermEndDate?: string;
  dailyStartTime?: string;
  dailyEndTime?: string;
  // 按周预订相关字段
  longTermType?: 'daily' | 'weekly';  // 长期预订类型：每天/每周
  selectedWeekDays?: number[];  // 选择的星期几 (0=周日, 1=周一, ..., 6=周六)
  weekCount?: number;  // 预订周数 (最长4周)
  // 主从记录字段（用于长期预订整合审批）
  isMaster?: boolean;  // 是否为主记录
  masterId?: string;   // 主记录ID（从记录使用）
}

// 系统配置接口
export interface SystemConfig {
  id: string;
  maxBookingDays: number;
  updatedAt: string;
  updatedBy: string;
}

export interface Notification {
  id: string;
  userId: string; 
  title: string;
  content: string;
  timestamp: string;
  isRead: boolean;
  type: 'INFO' | 'SUCCESS' | 'WARNING';
  linkView?: 'BOOKINGS' | 'RESOURCES' | 'USERS' | 'ROLES';
}
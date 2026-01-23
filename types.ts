
export type Role = 'SYSTEM_ADMIN' | 'APPROVAL_ADMIN' | 'EMPLOYEE';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role[];
  department: string;
}

export interface Department {
  id: string;
  name: string;
  parentId?: string; // 父部门ID，空则为根部门
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
  createdAt: string;
  currentNodeIndex: number; 
  approvalHistory: ApprovalRecord[];
}

export interface Notification {
  id: string;
  userId: string; 
  title: string;
  content: string;
  timestamp: string;
  isRead: boolean;
  type: 'INFO' | 'SUCCESS' | 'WARNING';
  linkView?: 'BOOKINGS' | 'RESOURCES' | 'USERS';
}

export interface AppState {
  currentUser: User | null;
  users: User[];
  departments: Department[];
  resources: Resource[];
  bookings: Booking[];
  workflow: ApprovalNode[];
  notifications: Notification[];
}


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
  role: Role[]; 
  department: string;
  landline?: string;
  mobile?: string;
}

export interface Department {
  id: string;
  name: string;
  parentId?: string;
}

export type ResourceType = 'ROOM' | 'DESK';
export type ResourceStatus = 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'PENDING';
export type RoomFeature = 'VIDEO' | 'DISPLAY' | 'WHITEBOARD';

export interface Resource {
  id: string;
  name: string;
  type: ResourceType;
  capacity?: number;
  location: string;
  campus?: string;
  features: string[];
  status: ResourceStatus;
}

export type BookingStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED';

export interface ApprovalNode {
  id: string;
  name: string;
  approverRole: Role;
  departmentIds?: string[];
  campuses?: string[];
}

export interface WorkflowVersion {
  version: number;
  nodes: ApprovalNode[];
  createdAt: string;
  createdBy: string;
}

export interface ApprovalDelegate {
  id: string;
  delegatorId: string;
  delegateId: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  createdBy: string;
}

export interface AuditEvent {
  id: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ApprovalRecord {
  nodeName: string;
  approverName: string;
  approverId?: string;
  delegatorName?: string;
  delegatorId?: string;
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
  workflowVersion?: number;
  approvalWorkflow?: ApprovalNode[];
  requesterDepartmentId?: string;
  resourceCampus?: string;
  hasLeader?: boolean;
  leaderDetails?: string;
  isVideoConference?: boolean;
  needsTeaService?: boolean;
  requiredFeatures?: RoomFeature[];
  attendeeIds?: string[];
  seriesId?: string;
  recurrenceIndex?: number;
  recurrence?: { frequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY'; count: number };
  seriesKind?: 'LONG_TERM';
  seriesEndDate?: string;
  renewalOfSeriesId?: string;
  rootSeriesId?: string;
  checkedInAt?: string;
  endedEarlyAt?: string;
  noShow?: boolean;
}

export interface WorkOrder {
  id: string;
  bookingId: string;
  type: 'TEA' | 'VIDEO';
  title: string;
  assigneeRole: Role;
  status: 'TODO' | 'DONE';
  createdAt: string;
  completedAt?: string;
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

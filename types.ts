
export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  color: string;
}

export type Role = string; // IDs of RoleDefinition

export type UserStatus = 'ACTIVE' | 'DISABLED';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role[];
  department: string;
  landline?: string;
  mobile?: string;
  status?: UserStatus;
  externalId?: string;
  directorySource?: string;
  directorySyncedAt?: string;
  disabledAt?: string;
  disabledReason?: string;
}

export interface Department {
  id: string;
  name: string;
  parentId?: string;
  externalId?: string;
  directorySource?: string;
}

export interface OrganizationDepartmentInput {
  externalId: string;
  id?: string;
  name: string;
  parentExternalId?: string;
}

export interface OrganizationUserInput {
  externalId: string;
  id?: string;
  name: string;
  email: string;
  role: Role[];
  departmentExternalId: string;
  landline?: string;
  mobile?: string;
  status?: UserStatus;
}

export interface OrganizationSyncChange {
  entityType: 'USER' | 'DEPARTMENT';
  entityId: string;
  externalId: string;
  action: 'CREATE' | 'UPDATE' | 'DISABLE' | 'UNCHANGED';
  changedFields: string[];
}

export interface OrganizationSyncBatch {
  id: string;
  source: string;
  mode: 'FULL' | 'DELTA';
  status: 'PREVIEWED' | 'APPLIED';
  revision: number;
  createdAt: string;
  createdBy: string;
  appliedAt?: string;
  departments: OrganizationDepartmentInput[];
  users: OrganizationUserInput[];
  changes: OrganizationSyncChange[];
}

export interface ExternalCallback {
  id: string;
  source: 'OA';
  eventId: string;
  nonce: string;
  payloadHash: string;
  bookingId: string;
  externalApprovalId: string;
  decision: 'APPROVE' | 'REJECT';
  approverExternalId: string;
  occurredAt: string;
  receivedAt: string;
  status: 'APPLIED' | 'REJECTED';
  errorCode?: string;
}

export interface ExternalCompensation {
  id: string;
  eventKey: string;
  note: string;
  createdAt: string;
  createdBy: string;
}

export interface IntegrationDelivery {
  id: string;
  eventKey: string;
  eventType: 'CALENDAR_SYNC' | 'ACCESS_CONTROL';
  outcome: 'DELIVERED' | 'SKIPPED' | 'STALE' | 'FAILED';
  reason?: string;
  httpStatus?: number;
  processedAt: string;
}

export interface AccessAuthorizationFact {
  id: string;
  bookingId: string;
  scheduleVersion: number;
  userId: string;
  resourceId: string;
  status: 'PENDING' | 'AUTHORIZED' | 'REVOKED';
  validFrom: string;
  validTo: string;
  grantRequestedAt: string;
  grantAcknowledgedAt?: string;
  revokedAt?: string;
  revocationAcknowledgedAt?: string;
  revocationReason?: string;
}

export type ResourceType = 'ROOM' | 'DESK';
export type ResourceStatus = 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'PENDING';
export type ResourceBuilding = 'MAIN' | 'ANNEX';
export type RoomCategory = 'SMALL' | 'MEDIUM' | 'LARGE' | 'AUDITORIUM';
export type RoomFeature = 'VIDEO' | 'DISPLAY' | 'WHITEBOARD';

export interface Resource {
  id: string;
  code?: string;
  name: string;
  type: ResourceType;
  capacity?: number;
  location: string;
  building?: ResourceBuilding;
  floor?: number;
  roomNumber?: string;
  roomCategory?: RoomCategory;
  campus?: string;
  features: string[];
  status: ResourceStatus;
  isExclusive?: boolean;
  exclusiveLeaderLevel?: string;
  openStart?: string;
  openEnd?: string;
  isPublic?: boolean;
  notes?: string;
}

export interface BookingRuleSettings {
  smallRoomMaxCapacity: number;
  mediumRoomMaxCapacity: number;
  departmentDailyNetMinutes: number;
  exclusiveRequestOpenHours: number;
  standardCancellationCutoffMinutes: number;
  servicedCancellationCutoffMinutes: number;
  approvalReminderAfterMinutes: number;
  approvalEscalationAfterMinutes: number;
  unapprovedCloseBeforeStartMinutes: number;
  checkInReminderAfterStartMinutes: number;
  noShowReleaseAfterStartMinutes: number;
  longTermMaxCalendarMonths: number;
  approvalWorkStartMinutes: number;
  approvalWorkEndMinutes: number;
  approvalHolidays: string[];
}

export interface RuleVersion {
  version: number;
  settings: BookingRuleSettings;
  createdAt: string;
  createdBy: string;
}

export interface ResourceImportIssue {
  row: number;
  code: string;
  field?: string;
  resourceCode?: string;
}

export interface ResourceImportItemReport {
  row: number;
  action: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'ERROR';
  resourceCode?: string;
  resource?: Resource;
  changedFields: string[];
  issues: ResourceImportIssue[];
}

export interface ResourceImportReport {
  revision?: number;
  total: number;
  valid: number;
  invalid: number;
  creates: number;
  updates: number;
  unchanged: number;
  items: ResourceImportItemReport[];
}

export interface ResourceImportBatch {
  id: string;
  actorId: string;
  createdAt: string;
  report: ResourceImportReport;
}

export type BookingStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED';
export type BookingDisplayStatus = 'PENDING' | 'UPCOMING' | 'IN_PROGRESS' | 'NO_SHOW' | 'RELEASED' | 'ENDED_EARLY' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';

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

export interface ApprovalRuleConditions {
  meetingTypes?: MeetingType[];
  exclusive?: boolean;
  heavyService?: boolean;
  continuousOverDays?: number;
}

export interface ApprovalRule {
  id: string;
  name: string;
  priority: number;
  conditions: ApprovalRuleConditions;
  workflowVersion: number;
}

export interface ApprovalRuleSetVersion {
  version: number;
  defaultWorkflowVersion: number;
  rules: ApprovalRule[];
  createdAt: string;
  createdBy: string;
}

export interface ConfidentialWhitelistEntry {
  id: string;
  userId: string;
  reason: string;
  createdAt: string;
  createdBy: string;
}

export interface ConfidentialityAuthorization {
  id: string;
  bookingId: string;
  action: 'DECLASSIFY' | 'ATTENDEE_CHANGE';
  reason: string;
  authorizedBy: string;
  createdAt: string;
  usedAt?: string;
}

export type ConfidentialAuthorizationTarget = Pick<Booking,
  'id' | 'userId' | 'startTime' | 'status' | 'meetingType' | 'confidentialityChoice'
>;

export interface ConfidentialAccessGrant {
  id: string;
  bookingId: string;
  userId: string;
  access: 'REQUESTER' | 'ATTENDEE' | 'APPROVER' | 'SECURITY';
  grantedBy: string;
  grantedAt: string;
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

export type MeetingType = 'NORMAL' | 'IMPORTANT' | 'CONFIDENTIAL';
export type ConfidentialityChoice = 'NON_CONFIDENTIAL' | 'CONFIDENTIAL';

export interface BookingContactSnapshot {
  userId: string;
  name: string;
  landline: string;
  mobile: string;
}

export type ServiceType = 'TEA' | 'VIDEO' | 'SIGNAGE' | 'SECURITY' | 'OTHER'
  | 'VEHICLE' | 'NAMEPLATE' | 'FURNITURE' | 'WATER' | 'STATIONERY' | 'RECEPTION' | 'ON_DUTY' | 'AUDITORIUM';

export interface ServiceFieldTemplate {
  key: string;
  label: string;
  type: 'TEXT' | 'TEXTAREA' | 'NUMBER' | 'SELECT';
  required: boolean;
  options?: string[];
}

export interface ServiceCatalogItem {
  id: string;
  type: ServiceType;
  name: string;
  version: number;
  fields: ServiceFieldTemplate[];
  responsibleRole: Role;
  slaResponseMinutes: number;
  heavyService: boolean;
  cancellable: boolean;
  resourceTypes: ResourceType[];
  roomCategories?: RoomCategory[];
  updatedAt: string;
  updatedBy: string;
}

export interface ServiceCatalogSnapshot {
  catalogItemId: string;
  catalogVersion: number;
  name: string;
  fields: ServiceFieldTemplate[];
  responsibleRole: Role;
  slaResponseMinutes: number;
  heavyService: boolean;
  cancellable: boolean;
}

export interface BookingServiceRequirement {
  type: ServiceType;
  details?: string;
  fieldValues?: Record<string, string>;
  catalogSnapshot?: ServiceCatalogSnapshot;
}

export interface AuditoriumSetup {
  seatingLayout: 'THEATER' | 'CLASSROOM' | 'ROUNDTABLE';
  stageRequired: boolean;
  rehearsalMinutes?: number;
  notes?: string;
}

export interface BookingQuotaDetail {
  resourceId: string;
  date: string;
  limitMinutes: number;
  usedBeforeMinutes: number;
  requestedMinutes: number;
  remainingMinutes: number;
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
  approvalRuleSetVersion?: number;
  approvalRuleId?: string;
  approvalRuleExplanation?: string[];
  approvalSubmittedAt?: string;
  ruleVersion?: number;
  ruleSettingsSnapshot?: BookingRuleSettings;
  meetingType?: MeetingType;
  confidentialityChoice?: ConfidentialityChoice;
  contactSnapshot?: BookingContactSnapshot;
  serviceRequirements?: BookingServiceRequirement[];
  auditoriumSetup?: AuditoriumSetup;
  quotaDetails?: BookingQuotaDetail[];
  exclusiveRequestReason?: string;
  exclusiveAccessType?: 'TEMPORARY';
  attendeeWarnings?: string[];
  overlapParticipantIds?: string[];
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
  checkInEventId?: string;
  checkInSource?: 'QR' | 'MANUAL' | 'CORRECTION';
  checkInOperatorId?: string;
  endedEarlyAt?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  noShow?: boolean;
  scheduleVersion?: number;
  noShowReleaseNotBefore?: string;
  releasedAt?: string;
  releaseReason?: string;
  releaseType?: 'NO_SHOW' | 'MANUAL_EXCEPTION' | 'UNUSED_CONFIRMED' | 'CANCELLED';
  accessRevokedAt?: string;
  cancellationReason?: string;
  cancelledBy?: string;
  approvalClosedAt?: string;
  approvalCloseReason?: string;
  securityAuthorizationIds?: string[];
}

export type WorkOrderStatus = 'TODO' | 'PENDING_INFO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' | 'EXCEPTION';

export interface WorkOrderStatusRecord {
  from?: WorkOrderStatus;
  to: WorkOrderStatus;
  actorId?: string;
  at: string;
  reason?: string;
}

export interface WorkOrder {
  id: string;
  bookingId: string;
  type: ServiceType;
  title: string;
  assigneeRole: Role;
  status: WorkOrderStatus;
  createdAt: string;
  scheduleVersion?: number;
  requirementSnapshot?: BookingServiceRequirement;
  fieldValues?: Record<string, string>;
  areaId?: string;
  responseDueAt?: string;
  respondedAt?: string;
  assigneeId?: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  exceptionReason?: string;
  executionResult?: string;
  costAmount?: number;
  costNote?: string;
  statusHistory?: WorkOrderStatusRecord[];
}

export interface ServiceArea {
  id: string;
  name: string;
  campus?: string;
  building?: ResourceBuilding;
  resourceIds: string[];
}

export interface ServiceShift {
  id: string;
  areaId: string;
  assigneeId: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  createdBy: string;
}

export interface ServiceInspection {
  id: string;
  areaId: string;
  bookingId?: string;
  kind: 'PRE_OPEN' | 'IMPORTANT_PRE_30' | 'ROUTINE_2H' | 'EXCEPTION';
  dueAt: string;
  status: 'PENDING' | 'DONE' | 'EXCEPTION';
  completedAt?: string;
  completedBy?: string;
  note?: string;
}

export interface CheckInEvent {
  id: string;
  bookingId: string;
  subjectUserId: string;
  operatorId: string;
  source: 'QR' | 'MANUAL' | 'CORRECTION';
  action: 'CHECK_IN' | 'CORRECT' | 'REVOKE';
  checkedInAt?: string;
  createdAt: string;
  reason?: string;
  supersedesId?: string;
}

export interface BookingUsageFact {
  bookingId: string;
  scheduleVersion: number;
  scheduledStartTime: string;
  scheduledEndTime: string;
  scheduledMinutes: number;
  actualStartTime?: string;
  actualEndTime?: string;
  actualMinutes: number;
  source: 'CHECK_IN' | 'MANUAL' | 'SYSTEM';
  revision: number;
  releasedAt?: string;
  releaseReason?: string;
  unusedConfirmation?: {
    status: 'PENDING' | 'IN_USE' | 'UNUSED';
    requestedAt: string;
    confirmedAt?: string;
    confirmedBy?: string;
    note?: string;
  };
}

export interface UsageAppeal {
  id: string;
  bookingId: string;
  requesterId: string;
  reason: string;
  status: 'PENDING' | 'RESTORED' | 'REJECTED';
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
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

export type DoorDeviceStatus = 'ACTIVE' | 'REVOKED';

export interface DoorDevice {
  id: string;
  name: string;
  resourceId: string;
  status: DoorDeviceStatus;
  tokenHash: string;
  tokenPrefix: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  lastHeartbeatAt?: string;
  lastSnapshotRevision?: number;
  restartRequestedAt?: string;
  revokedAt?: string;
}

export type OperationalExceptionKind = 'APPROVAL_OVERDUE' | 'NO_SHOW' | 'SERVICE_EXCEPTION' | 'DEVICE_OFFLINE';
export type OperationalExceptionStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface ExceptionActionRecord {
  id: string;
  kind: OperationalExceptionKind;
  title: string;
  entityId: string;
  ownerRole: Role;
  status: Exclude<OperationalExceptionStatus, 'OPEN'>;
  ownerId: string;
  note: string;
  updatedAt: string;
  history: Array<{
    status: Exclude<OperationalExceptionStatus, 'OPEN'>;
    actorId: string;
    note: string;
    at: string;
  }>;
}

export interface OperationalException {
  id: string;
  kind: OperationalExceptionKind;
  severity: 'WARNING' | 'CRITICAL';
  title: string;
  entityId: string;
  bookingId?: string;
  workOrderId?: string;
  deviceId?: string;
  resourceId?: string;
  ownerRole: Role;
  ownerId?: string;
  status: OperationalExceptionStatus;
  occurredAt: string;
  dueAt?: string;
  closeCondition: string;
  resolutionNote?: string;
  updatedAt: string;
  history: ExceptionActionRecord['history'];
}

export interface ExecutiveDashboardSnapshot {
  roomCount: number;
  currentInUse: number;
  currentIdle: number;
  todayBookingCount: number;
  todayUtilization: number;
  weekAverageUtilization: number;
  todayNoShowCount: number;
  overdueReleaseCount: number;
  week: Array<{
    date: string;
    utilization: number;
    importantBookingCount: number;
  }>;
}

export interface DashboardSnapshot {
  generatedAt: string;
  revision: number;
  scope: 'ENTERPRISE' | 'OPERATIONS' | 'PERSONAL';
  executive?: ExecutiveDashboardSnapshot;
  stats: {
    totalResources: number;
    availableRooms: number;
    availableDesks: number;
    activeBookings: number;
    pendingBookings: number;
    openWorkOrders: number;
    openExceptions: number;
  };
  today: {
    bookingCount: number;
    scheduledMinutes: number;
    actualMinutes: number;
  };
  nextBooking?: {
    id: string;
    resourceId: string;
    startTime: string;
    endTime: string;
    purpose: string;
  };
}

export type OperationsReportDimension = 'OVERALL' | 'RESOURCE' | 'BUILDING_FLOOR' | 'RESOURCE_TYPE' | 'ROOM_CATEGORY' | 'TIME_SLOT' | 'DEPARTMENT' | 'SERVICE' | 'USAGE';

export interface OperationsReportRow {
  dimension: OperationsReportDimension;
  id: string;
  name: string;
  bookingCount: number;
  scheduledHours: number;
  actualHours: number;
  usageHours: number;
  utilization: number;
  cancellationRate: number;
  noShowRate: number;
  rejectionRate: number;
  averageApprovalHours: number;
  checkedInCount: number;
  earlyEndCount: number;
  serviceOrderCount: number;
  serviceCost: number;
}

export interface OperationsBookingReport {
  id: string;
  purpose: string;
  requester: string;
  department: string;
  resource: string;
  buildingFloor: string;
  resourceType: string;
  timeSlot: string;
  status: BookingStatus;
  displayStatus: BookingDisplayStatus;
  startTime: string;
  endTime: string;
  scheduledMinutes: number;
  checkInCount: number;
  firstCheckInAt?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  actualMinutes: number;
  earlyEndMinutes: number;
  noShow: boolean;
  releaseType?: Booking['releaseType'];
  serviceOrderCount: number;
  serviceCost: number;
  reconciliationStatus: string;
  reconciliationNote: string;
}

export interface OperationsCheckInReport {
  id: string;
  bookingId: string;
  subject: string;
  operator: string;
  source: CheckInEvent['source'];
  action: CheckInEvent['action'];
  checkedInAt?: string;
  createdAt: string;
  reason?: string;
}

export interface OperationsServiceReport {
  id: string;
  bookingId: string;
  type: ServiceType;
  title: string;
  status: WorkOrderStatus;
  assigneeRole: Role;
  createdAt: string;
  responseDueAt?: string;
  respondedAt?: string;
  completedAt?: string;
  catalogItemId?: string;
  catalogVersion?: number;
  catalogName?: string;
  fieldValues: Record<string, string>;
  requirementDetails: string;
  quantity?: string;
  unit?: string;
  specification?: string;
  serviceTime?: string;
  serviceLocation?: string;
  estimatedCost?: number;
  executionResult?: string;
  cancellationReason?: string;
  costAmount: number;
  costNote?: string;
  exceptionReason?: string;
}

export interface OperationsSupplyReport {
  serviceType: ServiceType;
  serviceName: string;
  catalogItemId: string;
  catalogVersion: number;
  quantityField: string;
  quantityLabel: string;
  unit: string;
  timeSlot: string;
  quantity: number;
  orderCount: number;
  todoCount: number;
  pendingInfoCount: number;
  inProgressCount: number;
  doneCount: number;
  cancelledCount: number;
  exceptionCount: number;
}

export interface OperationsReport {
  start: string;
  end: string;
  generatedAt: string;
  revision: number;
  overall: OperationsReportRow;
  rows: OperationsReportRow[];
  bookings: OperationsBookingReport[];
  checkIns: OperationsCheckInReport[];
  services: OperationsServiceReport[];
  supplies: OperationsSupplyReport[];
  differences: OperationsBookingReport[];
}

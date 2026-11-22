import crypto from 'node:crypto';
import { DbError, mutateDb, normalizeResource, readSnapshot } from './db.ts';
import { isActiveBooking } from '../utils/bookingRules.ts';
import { getCurrentRuleSettings, getLatestRuleVersion } from '../utils/resourceDomain.ts';
import { ensureApprovalPolicy } from '../utils/approvalPolicy.ts';
import { isConfidentialBooking } from './confidentiality.ts';
import { DEFAULT_RULE_SETTINGS, isServiceType } from '../constants.ts';
import { ensureServiceDomain } from './serviceDomain.ts';
import type { ApprovalDelegate, ApprovalNode, ApprovalRuleSetVersion, Booking, BookingRuleSettings, ConfidentialAccessGrant, ConfidentialityAuthorization, ConfidentialWhitelistEntry, Department, ExceptionActionRecord, Resource, ResourceImportBatch, RoleDefinition, RuleVersion, User, WorkOrder, WorkflowVersion } from '../types.ts';
import { validateDeviceBackup } from './devices.ts';

const stringValue = (value: unknown, field: string, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new DbError(`INVALID_${field}`, 400);
  return value.trim();
};
const idValue = (value: unknown) => stringValue(value, 'ID', 128);
const optionalString = (value: unknown, field: string) => value === undefined || value === null || value === ''
  ? undefined : stringValue(value, field, 100);
const unique = (items: Array<{ id: string }>, label: string) => {
  if (new Set(items.map(item => item.id)).size !== items.length) throw new DbError(`DUPLICATE_${label}_ID`, 409);
};
const changeDetails = (before: unknown, after: unknown) => ({ before: before || null, after: after || null });
const maskEmail = (value: string) => {
  const [local, domain] = value.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};
const maskPhone = (value?: string) => value
  ? value.length <= 5 ? '*'.repeat(value.length) : `${value.slice(0, 3)}****${value.slice(-2)}`
  : undefined;
const userAuditView = (user?: User) => user ? {
  id: user.id, name: user.name, email: maskEmail(user.email), role: [...user.role], department: user.department,
  landline: maskPhone(user.landline), mobile: maskPhone(user.mobile), status: user.status,
  directorySource: user.directorySource, directorySyncedAt: user.directorySyncedAt, disabledAt: user.disabledAt
} : null;
const roleAuditView = (role?: RoleDefinition) => role ? {
  id: role.id, name: role.name, description: role.description, color: role.color
} : null;
const departmentAuditView = (department?: Department) => department ? {
  id: department.id, name: department.name, parentId: department.parentId
} : null;

const normalizeRole = (input: any, id?: string): RoleDefinition => ({
  id: id || idValue(input?.id),
  name: stringValue(input?.name, 'ROLE_NAME', 80),
  description: stringValue(input?.description, 'ROLE_DESCRIPTION', 500),
  color: ['indigo', 'emerald', 'amber', 'rose', 'purple'].includes(input?.color) ? input.color : 'indigo'
});

export const normalizeUser = (input: any, roles: RoleDefinition[], departments: Department[], id?: string): User => {
  const role: string[] = Array.isArray(input?.role) ? [...new Set(input.role as string[])] : [];
  if (!role.length || role.some((item: any) => typeof item !== 'string' || !roles.some(candidate => candidate.id === item))) {
    throw new DbError('INVALID_USER_ROLE', 400);
  }
  const department = stringValue(input?.department, 'DEPARTMENT', 100);
  if (!departments.some(item => item.name === department)) throw new DbError('DEPARTMENT_NOT_FOUND', 400);
  const email = stringValue(input?.email, 'EMAIL', 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DbError('INVALID_EMAIL', 400);
  if (input?.status !== undefined && !['ACTIVE', 'DISABLED'].includes(input.status)) throw new DbError('INVALID_USER_STATUS', 400);
  return {
    id: id || idValue(input?.id), name: stringValue(input?.name, 'USER_NAME', 100), email, role, department,
    landline: optionalString(input?.landline, 'LANDLINE'), mobile: optionalString(input?.mobile, 'MOBILE'),
    status: input?.status || 'ACTIVE',
    externalId: input?.externalId ? stringValue(input.externalId, 'USER_EXTERNAL_ID', 255) : undefined,
    directorySource: input?.directorySource ? stringValue(input.directorySource, 'DIRECTORY_SOURCE', 100) : undefined,
    directorySyncedAt: input?.directorySyncedAt,
    disabledAt: input?.disabledAt,
    disabledReason: input?.disabledReason ? stringValue(input.disabledReason, 'DISABLED_REASON', 500) : undefined
  };
};

export const normalizeDepartment = (input: any, id?: string): Department => ({
  id: id || idValue(input?.id), name: stringValue(input?.name, 'DEPARTMENT_NAME', 100),
  parentId: input?.parentId ? idValue(input.parentId) : undefined,
  externalId: input?.externalId ? stringValue(input.externalId, 'DEPARTMENT_EXTERNAL_ID', 255) : undefined,
  directorySource: input?.directorySource ? stringValue(input.directorySource, 'DIRECTORY_SOURCE', 100) : undefined
});

const normalizeWorkflow = (input: any, roles: RoleDefinition[], departments: Department[]): ApprovalNode[] => {
  if (!Array.isArray(input) || input.length > 20) throw new DbError('INVALID_WORKFLOW', 400);
  const workflow = input.map(node => {
    const departmentIds = node?.departmentIds === undefined ? [] : node.departmentIds;
    const campuses = node?.campuses === undefined ? [] : node.campuses;
    if (!Array.isArray(departmentIds) || !Array.isArray(campuses)) throw new DbError('INVALID_APPROVAL_SCOPE', 400);
    const normalizedDepartments = [...new Set(departmentIds.map((id: unknown) => idValue(id)))];
    const normalizedCampuses = [...new Set(campuses.map((campus: unknown) => stringValue(campus, 'CAMPUS', 100)))];
    if (normalizedDepartments.some(id => !departments.some(department => department.id === id))) {
      throw new DbError('DEPARTMENT_NOT_FOUND', 400);
    }
    return {
      id: idValue(node?.id), name: stringValue(node?.name, 'NODE_NAME', 100),
      approverRole: stringValue(node?.approverRole, 'APPROVER_ROLE', 128),
      departmentIds: normalizedDepartments,
      campuses: normalizedCampuses
    };
  });
  unique(workflow, 'WORKFLOW_NODE');
  if (workflow.some(node => !roles.some(role => role.id === node.approverRole))) throw new DbError('ROLE_NOT_FOUND', 400);
  return workflow;
};

const latestWorkflowVersion = (versions: WorkflowVersion[] | undefined, workflow: ApprovalNode[]): WorkflowVersion =>
  [...(versions || [])].sort((a, b) => b.version - a.version)[0] || {
    version: 1, nodes: structuredClone(workflow), createdAt: new Date().toISOString(), createdBy: 'system'
  };

const RULE_FIELDS: Array<keyof BookingRuleSettings> = [
  'smallRoomMaxCapacity', 'mediumRoomMaxCapacity', 'departmentDailyNetMinutes', 'exclusiveRequestOpenHours',
  'standardCancellationCutoffMinutes', 'servicedCancellationCutoffMinutes', 'approvalReminderAfterMinutes',
  'approvalEscalationAfterMinutes', 'unapprovedCloseBeforeStartMinutes', 'checkInReminderAfterStartMinutes',
  'noShowReleaseAfterStartMinutes', 'longTermMaxCalendarMonths', 'approvalWorkStartMinutes', 'approvalWorkEndMinutes'
];

const normalizeRuleSettings = (input: any, base: BookingRuleSettings = DEFAULT_RULE_SETTINGS): BookingRuleSettings => {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) throw new DbError('INVALID_RULE_SETTINGS', 400);
  const merged = { ...base, ...(input || {}) };
  for (const field of RULE_FIELDS) {
    if (!Number.isSafeInteger(merged[field]) || merged[field] <= 0 || merged[field] > 525600) throw new DbError(`INVALID_RULE_${field}`, 400);
  }
  if (merged.smallRoomMaxCapacity >= merged.mediumRoomMaxCapacity) throw new DbError('INVALID_ROOM_CAPACITY_THRESHOLDS', 400);
  if (merged.approvalReminderAfterMinutes >= merged.approvalEscalationAfterMinutes) throw new DbError('INVALID_APPROVAL_TIMING', 400);
  if (merged.checkInReminderAfterStartMinutes >= merged.noShowReleaseAfterStartMinutes) throw new DbError('INVALID_CHECK_IN_TIMING', 400);
  if (merged.longTermMaxCalendarMonths > 12) throw new DbError('INVALID_LONG_TERM_LIMIT', 400);
  if (merged.approvalWorkStartMinutes >= 1440 || merged.approvalWorkEndMinutes > 1440
    || merged.approvalWorkStartMinutes >= merged.approvalWorkEndMinutes) throw new DbError('INVALID_APPROVAL_WORK_HOURS', 400);
  if (!Array.isArray(merged.approvalHolidays) || merged.approvalHolidays.length > 100
    || merged.approvalHolidays.some((date: unknown) => typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)))) {
    throw new DbError('INVALID_APPROVAL_HOLIDAYS', 400);
  }
  return {
    ...Object.fromEntries(RULE_FIELDS.map(field => [field, merged[field]])),
    approvalHolidays: [...new Set(merged.approvalHolidays)]
  } as unknown as BookingRuleSettings;
};

export const getRuleConfiguration = async () => {
  const { db } = await readSnapshot();
  return {
    current: getCurrentRuleSettings(db.ruleVersions),
    versions: [...(db.ruleVersions || [])].sort((a, b) => b.version - a.version)
  };
};

export const saveRuleSettings = async (input: any, actorId: string) => mutateDb(async (db, { audit }) => {
  const currentVersion = getLatestRuleVersion(db.ruleVersions);
  const currentSettings = getCurrentRuleSettings(db.ruleVersions);
  const settings = normalizeRuleSettings(input, currentSettings);
  const version: RuleVersion = {
    version: (currentVersion?.version || 0) + 1,
    settings,
    createdAt: new Date().toISOString(),
    createdBy: actorId
  };
  db.ruleVersions = [...(db.ruleVersions || []), version];
  await audit({ actorId, action: 'RULE_VERSION_PUBLISH', entityType: 'RULE_SETTINGS', entityId: String(version.version), details: changeDetails(currentSettings, settings) });
  return version;
});

export const saveUser = async (input: any, actorId: string, editingId?: string) => mutateDb(async (db, { audit, revokeUserSessions }) => {
  const roles = db.roles || [];
  const departments = db.departments || [];
  const users = db.users || [];
  const current = editingId ? users.find(user => user.id === editingId) : undefined;
  if (editingId && !current) throw new DbError('USER_NOT_FOUND', 404);
  const merged = editingId ? { ...current, ...input, id: editingId } : input;
  const user = normalizeUser(merged, roles, departments, editingId);
  if (!editingId && users.some(item => item.id === user.id)) throw new DbError('DUPLICATE_USER_ID', 409);
  if (users.some(item => item.id !== user.id && item.email.toLowerCase() === user.email)) throw new DbError('DUPLICATE_EMAIL', 409);
  if (user.status === 'DISABLED') {
    if (user.id === actorId) throw new DbError('CANNOT_DISABLE_SELF', 409);
    const activeAdmins = users.filter(item => item.id !== user.id && item.status !== 'DISABLED' && item.role.includes('SYSTEM_ADMIN'));
    if (!activeAdmins.length) throw new DbError('LAST_ACTIVE_ADMIN_REQUIRED', 409);
  }
  db.users = editingId ? users.map(item => item.id === editingId ? user : item) : [...users, user];
  if (user.status === 'DISABLED' && current?.status !== 'DISABLED') await revokeUserSessions([user.id]);
  await audit({ actorId, action: editingId ? 'USER_UPDATE' : 'USER_CREATE', entityType: 'USER', entityId: user.id, details: changeDetails(userAuditView(current), userAuditView(user)) });
  return user;
});

export const deleteUser = async (id: string, actorId: string) => mutateDb(async (db, { audit, revokeUserSessions }) => {
  if (id === actorId) throw new DbError('CANNOT_DELETE_SELF', 409);
  const current = (db.users || []).find(user => user.id === id);
  if (!current) throw new DbError('USER_NOT_FOUND', 404);
  if ((db.bookings || []).some(booking => booking.userId === id && isActiveBooking(booking))) {
    throw new DbError('USER_HAS_ACTIVE_BOOKINGS', 409);
  }
  if ((db.approvalDelegates || []).some(item => item.delegatorId === id || item.delegateId === id)) {
    throw new DbError('USER_HAS_DELEGATIONS', 409);
  }
  db.users = (db.users || []).filter(user => user.id !== id);
  await revokeUserSessions([id]);
  await audit({ actorId, action: 'USER_DELETE', entityType: 'USER', entityId: id, details: changeDetails(userAuditView(current), null) });
  return { ok: true };
});

export const saveRole = async (input: any, actorId: string, editingId?: string) => mutateDb(async (db, { audit }) => {
  const roles = db.roles || [];
  const current = editingId ? roles.find(role => role.id === editingId) : undefined;
  if (editingId && !current) throw new DbError('ROLE_NOT_FOUND', 404);
  const role = normalizeRole({ ...current, ...input }, editingId);
  if (!editingId && roles.some(item => item.id === role.id)) throw new DbError('DUPLICATE_ROLE_ID', 409);
  if (roles.some(item => item.id !== role.id && item.name === role.name)) throw new DbError('DUPLICATE_ROLE_NAME', 409);
  db.roles = editingId ? roles.map(item => item.id === editingId ? role : item) : [...roles, role];
  await audit({ actorId, action: editingId ? 'ROLE_UPDATE' : 'ROLE_CREATE', entityType: 'ROLE', entityId: role.id, details: changeDetails(roleAuditView(current), roleAuditView(role)) });
  return role;
});

export const saveDepartment = async (input: any, actorId: string, editingId?: string) => mutateDb(async (db, { audit }) => {
  const departments = db.departments || [];
  const current = editingId ? departments.find(department => department.id === editingId) : undefined;
  if (editingId && !current) throw new DbError('DEPARTMENT_NOT_FOUND', 404);
  const department = normalizeDepartment({ ...current, ...input }, editingId);
  if (!editingId && departments.some(item => item.id === department.id)) throw new DbError('DUPLICATE_DEPARTMENT_ID', 409);
  if (departments.some(item => item.id !== department.id && item.name === department.name)) throw new DbError('DUPLICATE_DEPARTMENT_NAME', 409);
  if (department.parentId && !departments.some(item => item.id === department.parentId)) throw new DbError('PARENT_DEPARTMENT_NOT_FOUND', 400);
  if (editingId && department.parentId) {
    let parentId: string | undefined = department.parentId;
    while (parentId) {
      if (parentId === editingId) throw new DbError('DEPARTMENT_CYCLE', 409);
      parentId = departments.find(item => item.id === parentId)?.parentId;
    }
  }
  db.departments = editingId ? departments.map(item => item.id === editingId ? department : item) : [...departments, department];
  if (current && current.name !== department.name) {
    db.users = (db.users || []).map(user => user.department === current.name ? { ...user, department: department.name } : user);
  }
  await audit({ actorId, action: editingId ? 'DEPARTMENT_UPDATE' : 'DEPARTMENT_CREATE', entityType: 'DEPARTMENT', entityId: department.id, details: changeDetails(departmentAuditView(current), departmentAuditView(department)) });
  return department;
});

export const deleteDepartment = async (id: string, actorId: string) => mutateDb(async (db, { audit }) => {
  const department = (db.departments || []).find(item => item.id === id);
  if (!department) throw new DbError('DEPARTMENT_NOT_FOUND', 404);
  if ((db.departments || []).some(item => item.parentId === id)) throw new DbError('DEPARTMENT_HAS_CHILDREN', 409);
  if ((db.users || []).some(user => user.department === department.name)) throw new DbError('DEPARTMENT_HAS_USERS', 409);
  if ((db.workflowVersions || []).some(version => version.nodes.some(node => node.departmentIds?.includes(id)))
    || (db.workflow || []).some(node => node.departmentIds?.includes(id))) {
    throw new DbError('DEPARTMENT_USED_BY_WORKFLOW', 409);
  }
  db.departments = (db.departments || []).filter(item => item.id !== id);
  await audit({ actorId, action: 'DEPARTMENT_DELETE', entityType: 'DEPARTMENT', entityId: id, details: changeDetails(departmentAuditView(department), null) });
  return { ok: true };
});

export const saveWorkflow = async (input: any, actorId: string) => mutateDb(async (db, { audit }) => {
  const workflow = normalizeWorkflow(input, db.roles || [], db.departments || []);
  if (!workflow.length) throw new DbError('INVALID_WORKFLOW', 400);
  ensureApprovalPolicy(db);
  const currentRuleSet = [...(db.approvalRuleSetVersions || [])].sort((a, b) => b.version - a.version)[0]!;
  const current = (db.workflowVersions || []).find(item => item.version === currentRuleSet.defaultWorkflowVersion)
    || latestWorkflowVersion(db.workflowVersions, db.workflow || []);
  db.bookings = (db.bookings || []).map(booking => booking.status === 'PENDING' && !booking.approvalWorkflow
    ? { ...booking, workflowVersion: current.version, approvalWorkflow: structuredClone(current.nodes) }
    : booking);
  const version: WorkflowVersion = {
    version: Math.max(0, ...(db.workflowVersions || []).map(item => item.version)) + 1,
    nodes: structuredClone(workflow),
    createdAt: new Date().toISOString(),
    createdBy: actorId
  };
  const ruleSetVersion: ApprovalRuleSetVersion = {
    version: currentRuleSet.version + 1,
    defaultWorkflowVersion: version.version,
    rules: structuredClone(currentRuleSet.rules).map(rule => ['important', 'exclusive', 'heavy-service'].includes(rule.id)
      ? { ...rule, workflowVersion: version.version }
      : rule),
    createdAt: version.createdAt,
    createdBy: actorId
  };
  db.workflowVersions = [...(db.workflowVersions || []), version].sort((a, b) => a.version - b.version);
  db.approvalRuleSetVersions = [...(db.approvalRuleSetVersions || []), ruleSetVersion];
  db.workflow = workflow;
  await audit({ actorId, action: 'WORKFLOW_PUBLISH', entityType: 'WORKFLOW', entityId: String(version.version), details: {
    nodeCount: workflow.length,
    approvalRuleSetVersion: ruleSetVersion.version,
    before: { version: current.version, nodes: current.nodes },
    after: { version: version.version, nodes: workflow }
  } });
  return workflow;
});

const normalizeDelegate = (input: any, users: User[], actorId: string, id?: string): ApprovalDelegate => {
  const delegatorId = idValue(input?.delegatorId);
  const delegateId = idValue(input?.delegateId);
  if (delegatorId === delegateId) throw new DbError('INVALID_DELEGATION', 400);
  if (!users.some(user => user.id === delegatorId) || !users.some(user => user.id === delegateId)) {
    throw new DbError('DELEGATION_USER_NOT_FOUND', 400);
  }
  const startsAt = new Date(input?.startsAt);
  const endsAt = new Date(input?.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
    throw new DbError('INVALID_DELEGATION_PERIOD', 400);
  }
  return {
    id: id || idValue(input?.id), delegatorId, delegateId,
    startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
    createdAt: input?.createdAt || new Date().toISOString(), createdBy: input?.createdBy || actorId
  };
};

export const saveApprovalDelegate = async (input: any, actorId: string) => mutateDb(async (db, { audit }) => {
  const delegate = normalizeDelegate({ ...input, id: input?.id || crypto.randomUUID(), createdBy: actorId }, db.users || [], actorId);
  if (Date.parse(delegate.endsAt) <= Date.now()) throw new DbError('DELEGATION_EXPIRED', 400);
  if ((db.approvalDelegates || []).some(item => item.delegatorId === delegate.delegatorId
    && Date.parse(delegate.startsAt) < Date.parse(item.endsAt) && Date.parse(delegate.endsAt) > Date.parse(item.startsAt))) {
    throw new DbError('DELEGATION_OVERLAP', 409);
  }
  db.approvalDelegates = [delegate, ...(db.approvalDelegates || [])];
  await audit({ actorId, action: 'DELEGATION_CREATE', entityType: 'DELEGATION', entityId: delegate.id, details: changeDetails(null, delegate) });
  return delegate;
});

export const deleteApprovalDelegate = async (id: string, actorId: string) => mutateDb(async (db, { audit }) => {
  const current = (db.approvalDelegates || []).find(item => item.id === id);
  if (!current) throw new DbError('DELEGATION_NOT_FOUND', 404);
  db.approvalDelegates = (db.approvalDelegates || []).filter(item => item.id !== id);
  await audit({ actorId, action: 'DELEGATION_REVOKE', entityType: 'DELEGATION', entityId: id, details: changeDetails(current, null) });
  return { ok: true };
});

export const importRecords = async (type: string, input: any, actorId: string) => mutateDb(async (db, { audit }) => {
  if (!['USERS', 'RESOURCES', 'DEPARTMENTS'].includes(type) || !Array.isArray(input) || !input.length || input.length > 500) {
    throw new DbError('INVALID_IMPORT', 400);
  }
  let items: Array<{ id: string }>;
  if (type === 'USERS') {
    const users = input.map(item => normalizeUser(item, db.roles || [], db.departments || []));
    unique([...(db.users || []), ...users], 'USER');
    const emails = new Set((db.users || []).map(user => user.email.toLowerCase()));
    if (users.some(user => emails.has(user.email) || users.filter(candidate => candidate.email === user.email).length > 1)) throw new DbError('DUPLICATE_EMAIL', 409);
    db.users = [...(db.users || []), ...users];
    items = users;
  } else if (type === 'RESOURCES') {
    const settings = getCurrentRuleSettings(db.ruleVersions);
    const resources: Resource[] = input.map(item => normalizeResource({ ...item, id: idValue(item?.id) }, undefined, settings));
    unique([...(db.resources || []), ...resources], 'RESOURCE');
    const existingCodes = new Set((db.resources || []).map(resource => resource.code || resource.id.toUpperCase()));
    const hasDuplicateImportCode = resources.some((resource, index) => resources.findIndex(candidate => candidate.code === resource.code) !== index);
    if (hasDuplicateImportCode || resources.some(resource => existingCodes.has(resource.code!))) throw new DbError('DUPLICATE_RESOURCE_CODE', 409);
    const existingNames = new Set((db.resources || []).map(resource => resource.name));
    if (resources.some(resource => existingNames.has(resource.name) || resources.filter(candidate => candidate.name === resource.name).length > 1)) throw new DbError('DUPLICATE_RESOURCE_NAME', 409);
    db.resources = [...(db.resources || []), ...resources];
    items = resources;
  } else {
    const departments = input.map(item => normalizeDepartment(item));
    const allDepartments = [...(db.departments || []), ...departments];
    unique(allDepartments, 'DEPARTMENT');
    if (new Set(allDepartments.map(item => item.name)).size !== allDepartments.length) throw new DbError('DUPLICATE_DEPARTMENT_NAME', 409);
    if (departments.some(item => item.parentId && !allDepartments.some(parent => parent.id === item.parentId))) throw new DbError('PARENT_DEPARTMENT_NOT_FOUND', 400);
    db.departments = allDepartments;
    items = departments;
  }
  await audit({ actorId, action: 'DATA_IMPORT', entityType: 'IMPORT', entityId: type, details: { count: items.length } });
  return items;
});

const assertConfidentialityManager = (users: User[], actorId: string) => {
  const actor = users.find(user => user.id === actorId);
  if (!actor || (!actor.role.includes('SECURITY_ADMIN') && !actor.role.includes('SYSTEM_ADMIN'))) {
    throw new DbError('FORBIDDEN', 403);
  }
};

export const saveConfidentialWhitelistEntry = async (input: any, actorId: string) => mutateDb(async (db, { audit }) => {
  assertConfidentialityManager(db.users || [], actorId);
  const userId = idValue(input?.userId);
  if (!(db.users || []).some(user => user.id === userId)) throw new DbError('USER_NOT_FOUND', 404);
  if ((db.confidentialWhitelist || []).some(item => item.userId === userId)) throw new DbError('DUPLICATE_CONFIDENTIAL_WHITELIST_USER', 409);
  const entry: ConfidentialWhitelistEntry = {
    id: `cw-${crypto.randomUUID()}`,
    userId,
    reason: stringValue(input?.reason, 'CONFIDENTIAL_WHITELIST_REASON', 500),
    createdAt: new Date().toISOString(),
    createdBy: actorId
  };
  db.confidentialWhitelist = [entry, ...(db.confidentialWhitelist || [])];
  await audit({ actorId, action: 'CONFIDENTIAL_WHITELIST_ADD', entityType: 'USER', entityId: userId, details: { before: null, after: { whitelistId: entry.id, userId } } });
  return entry;
});

export const deleteConfidentialWhitelistEntry = async (id: string, actorId: string) => mutateDb(async (db, { audit }) => {
  assertConfidentialityManager(db.users || [], actorId);
  const entry = (db.confidentialWhitelist || []).find(item => item.id === id);
  if (!entry) throw new DbError('CONFIDENTIAL_WHITELIST_NOT_FOUND', 404);
  db.confidentialWhitelist = (db.confidentialWhitelist || []).filter(item => item.id !== id);
  await audit({ actorId, action: 'CONFIDENTIAL_WHITELIST_REMOVE', entityType: 'USER', entityId: entry.userId, details: { before: { whitelistId: id, userId: entry.userId }, after: null } });
  return { ok: true };
});

export const createConfidentialityAuthorization = async (bookingId: string, input: any, actorId: string) => mutateDb(async (db, { audit }) => {
  assertConfidentialityManager(db.users || [], actorId);
  const booking = (db.bookings || []).find(item => item.id === bookingId);
  if (!booking) throw new DbError('BOOKING_NOT_FOUND', 404);
  if (!isConfidentialBooking(booking) || booking.status !== 'PENDING') throw new DbError('CONFIDENTIAL_BOOKING_NOT_EDITABLE', 409);
  if (booking.userId === actorId) throw new DbError('CONFIDENTIAL_SELF_AUTHORIZATION', 403);
  if (!['DECLASSIFY', 'ATTENDEE_CHANGE'].includes(input?.action)) throw new DbError('INVALID_CONFIDENTIALITY_ACTION', 400);
  const authorization: ConfidentialityAuthorization = {
    id: `ca-${crypto.randomUUID()}`,
    bookingId,
    action: input.action,
    reason: stringValue(input?.reason, 'CONFIDENTIALITY_AUTHORIZATION_REASON', 500),
    authorizedBy: actorId,
    createdAt: new Date().toISOString()
  };
  db.confidentialityAuthorizations = [authorization, ...(db.confidentialityAuthorizations || [])];
  await audit({ actorId, action: 'CONFIDENTIALITY_AUTHORIZATION_CREATE', entityType: 'BOOKING', entityId: bookingId, details: { before: null, after: { authorizationId: authorization.id, changeAction: authorization.action } } });
  return authorization;
});

const normalizeApprovalRuleSets = (input: any, workflowVersions: WorkflowVersion[]): ApprovalRuleSetVersion[] => {
  if (!Array.isArray(input)) throw new DbError('INVALID_APPROVAL_RULE_SET', 400);
  const versions = input.map((version: any): ApprovalRuleSetVersion => {
    if (!Number.isInteger(version?.version) || version.version < 1 || !Number.isFinite(Date.parse(version.createdAt))
      || !workflowVersions.some(item => item.version === version.defaultWorkflowVersion) || !Array.isArray(version.rules)) {
      throw new DbError('INVALID_APPROVAL_RULE_SET', 400);
    }
    const rules = version.rules.map((rule: any) => {
      const conditions = rule?.conditions;
      if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)
        || (conditions.meetingTypes !== undefined && (!Array.isArray(conditions.meetingTypes) || conditions.meetingTypes.some((type: any) => !['NORMAL', 'IMPORTANT', 'CONFIDENTIAL'].includes(type))))
        || (conditions.exclusive !== undefined && typeof conditions.exclusive !== 'boolean')
        || (conditions.heavyService !== undefined && typeof conditions.heavyService !== 'boolean')
        || (conditions.continuousOverDays !== undefined && (typeof conditions.continuousOverDays !== 'number' || !Number.isFinite(conditions.continuousOverDays) || conditions.continuousOverDays <= 0))
        || !Number.isSafeInteger(rule?.priority) || !workflowVersions.some(item => item.version === rule?.workflowVersion)) {
        throw new DbError('INVALID_APPROVAL_RULE', 400);
      }
      return {
        id: idValue(rule.id), name: stringValue(rule.name, 'APPROVAL_RULE_NAME', 100), priority: rule.priority,
        conditions: structuredClone(conditions), workflowVersion: rule.workflowVersion
      };
    });
    unique(rules, 'APPROVAL_RULE');
    return {
      version: version.version,
      defaultWorkflowVersion: version.defaultWorkflowVersion,
      rules,
      createdAt: new Date(version.createdAt).toISOString(),
      createdBy: idValue(version.createdBy)
    };
  });
  if (new Set(versions.map(version => version.version)).size !== versions.length) throw new DbError('INVALID_APPROVAL_RULE_SET', 400);
  return versions;
};

export const createBackup = async () => {
  const { db, revision } = await readSnapshot();
  return {
    schemaVersion: 7,
    exportedAt: new Date().toISOString(),
    revision,
    collections: {
      roles: db.roles || [], users: db.users || [], resources: db.resources || [], bookings: db.bookings || [],
      departments: db.departments || [], workflow: db.workflow || [], workflowVersions: db.workflowVersions || [],
      approvalDelegates: db.approvalDelegates || [], workOrders: db.workOrders || [],
      ruleVersions: db.ruleVersions || [{ version: 1, settings: DEFAULT_RULE_SETTINGS, createdAt: new Date().toISOString(), createdBy: 'system' }],
      resourceImportBatches: db.resourceImportBatches || [],
      approvalRuleSetVersions: db.approvalRuleSetVersions || [],
      confidentialWhitelist: db.confidentialWhitelist || [],
      confidentialityAuthorizations: db.confidentialityAuthorizations || [],
      confidentialAccessGrants: db.confidentialAccessGrants || [],
      serviceCatalog: db.serviceCatalog || [], serviceAreas: db.serviceAreas || [], serviceShifts: db.serviceShifts || [],
      serviceInspections: db.serviceInspections || [], checkInEvents: db.checkInEvents || [], usageFacts: db.usageFacts || [], usageAppeals: db.usageAppeals || [],
      devices: db.devices || [], exceptionActions: db.exceptionActions || [],
      organizationSyncBatches: db.organizationSyncBatches || [], externalCallbacks: db.externalCallbacks || [],
      externalCompensations: db.externalCompensations || [], accessAuthorizationFacts: db.accessAuthorizationFacts || [],
      integrationDeliveries: db.integrationDeliveries || []
    }
  };
};

const validateBackupBooking = (input: any, users: User[], resources: Resource[], roles: RoleDefinition[], departments: Department[]): Booking => {
  if (!input || !['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'].includes(input.status)
    || !Number.isFinite(Date.parse(input.startTime)) || !Number.isFinite(Date.parse(input.endTime))
    || Date.parse(input.endTime) <= Date.parse(input.startTime) || !Array.isArray(input.approvalHistory)) {
    throw new DbError('INVALID_BACKUP_BOOKING', 400);
  }
  if (!users.some(user => user.id === input.userId) || !resources.some(resource => resource.id === input.resourceId)) {
    throw new DbError('INVALID_BACKUP_REFERENCE', 400);
  }
  return {
    ...input, id: idValue(input.id), userId: idValue(input.userId), resourceId: idValue(input.resourceId),
    purpose: stringValue(input.purpose, 'PURPOSE', 500), createdAt: input.createdAt || new Date().toISOString(),
    currentNodeIndex: Number.isInteger(input.currentNodeIndex) && input.currentNodeIndex >= 0 ? input.currentNodeIndex : 0,
    workflowVersion: Number.isInteger(input.workflowVersion) && input.workflowVersion > 0 ? input.workflowVersion : undefined,
    approvalWorkflow: input.approvalWorkflow === undefined ? undefined : normalizeWorkflow(input.approvalWorkflow, roles, departments)
  };
};

const validateExceptionActions = (input: any, users: User[], roles: RoleDefinition[]): ExceptionActionRecord[] => {
  if (!Array.isArray(input)) throw new DbError('INVALID_BACKUP_EXCEPTION_ACTION', 400);
  const records = input.map((item: any): ExceptionActionRecord => {
    if (!item || !['APPROVAL_OVERDUE', 'NO_SHOW', 'SERVICE_EXCEPTION', 'DEVICE_OFFLINE'].includes(item.kind)
      || !['ACKNOWLEDGED', 'RESOLVED'].includes(item.status) || !Array.isArray(item.history) || !item.history.length
      || !roles.some(role => role.id === item.ownerRole)
      || !users.some(user => user.id === item.ownerId) || !Number.isFinite(Date.parse(item.updatedAt))
      || item.history.some((entry: any) => !['ACKNOWLEDGED', 'RESOLVED'].includes(entry?.status)
        || !users.some(user => user.id === entry.actorId) || !Number.isFinite(Date.parse(entry.at)))) {
      throw new DbError('INVALID_BACKUP_EXCEPTION_ACTION', 400);
    }
    return {
      id: idValue(item.id), kind: item.kind, title: stringValue(item.title, 'EXCEPTION_TITLE', 500),
      entityId: idValue(item.entityId), ownerRole: idValue(item.ownerRole), status: item.status, ownerId: idValue(item.ownerId),
      note: stringValue(item.note, 'EXCEPTION_NOTE', 500), updatedAt: new Date(item.updatedAt).toISOString(),
      history: item.history.map((entry: any) => ({
        status: entry.status, actorId: idValue(entry.actorId), note: stringValue(entry.note, 'EXCEPTION_NOTE', 500),
        at: new Date(entry.at).toISOString()
      }))
    };
  });
  unique(records, 'EXCEPTION_ACTION');
  return records;
};

const integrationBackupKeys = ['organizationSyncBatches', 'externalCallbacks', 'externalCompensations', 'accessAuthorizationFacts', 'integrationDeliveries'] as const;
const validateIntegrationBackup = (data: any, bookings: Booking[], users: User[], resources: Resource[]) => {
  const collections = Object.fromEntries(integrationBackupKeys.map(key => [key, structuredClone(data[key] || [])])) as Record<typeof integrationBackupKeys[number], any[]>;
  for (const key of integrationBackupKeys) {
    for (const item of collections[key]) idValue(item?.id);
    unique(collections[key], key.toUpperCase());
  }
  if (collections.organizationSyncBatches.some(item => !['FULL', 'DELTA'].includes(item.mode)
    || !['PREVIEWED', 'APPLIED'].includes(item.status) || !Array.isArray(item.departments) || !Array.isArray(item.users) || !Array.isArray(item.changes)
    || !Number.isFinite(Date.parse(item.createdAt)))) throw new DbError('INVALID_BACKUP_ORGANIZATION_SYNC', 400);
  if (collections.externalCallbacks.some(item => !bookings.some(booking => booking.id === item.bookingId)
    || !['APPLIED', 'REJECTED'].includes(item.status) || !/^[a-f0-9]{64}$/.test(item.payloadHash || '')
    || !Number.isFinite(Date.parse(item.receivedAt)))) throw new DbError('INVALID_BACKUP_EXTERNAL_CALLBACK', 400);
  if (new Set(collections.externalCallbacks.map(item => item.eventId)).size !== collections.externalCallbacks.length) throw new DbError('DUPLICATE_EXTERNAL_CALLBACK_EVENT', 409);
  if (collections.externalCompensations.some(item => !users.some(user => user.id === item.createdBy)
    || !Number.isFinite(Date.parse(item.createdAt)))) throw new DbError('INVALID_BACKUP_EXTERNAL_COMPENSATION', 400);
  if (collections.accessAuthorizationFacts.some(item => !bookings.some(booking => booking.id === item.bookingId)
    || !users.some(user => user.id === item.userId) || !resources.some(resource => resource.id === item.resourceId)
    || !['PENDING', 'AUTHORIZED', 'REVOKED'].includes(item.status) || !Number.isSafeInteger(item.scheduleVersion) || item.scheduleVersion < 1
    || !Number.isFinite(Date.parse(item.validFrom)) || !Number.isFinite(Date.parse(item.validTo)))) throw new DbError('INVALID_BACKUP_ACCESS_FACT', 400);
  if (collections.integrationDeliveries.some(item => !['CALENDAR_SYNC', 'ACCESS_CONTROL'].includes(item.eventType)
    || !['DELIVERED', 'SKIPPED', 'STALE', 'FAILED'].includes(item.outcome) || !Number.isFinite(Date.parse(item.processedAt)))) {
    throw new DbError('INVALID_BACKUP_INTEGRATION_DELIVERY', 400);
  }
  return collections;
};

export const restoreBackup = async (body: any, actorId: string) => {
  if (![2, 3, 4, 5, 6, 7].includes(body?.schemaVersion) || !body.collections) throw new DbError('INVALID_BACKUP_FORMAT', 400);
  const data = body.collections;
  if (!['roles', 'users', 'resources', 'bookings', 'departments', 'workflow', 'workflowVersions', 'approvalDelegates', 'workOrders'].every(key => Array.isArray(data[key]))) {
    throw new DbError('INVALID_BACKUP_FORMAT', 400);
  }
  if (body.schemaVersion >= 3 && (!Array.isArray(data.ruleVersions) || !Array.isArray(data.resourceImportBatches))) throw new DbError('INVALID_BACKUP_FORMAT', 400);
  if (body.schemaVersion >= 4 && !['approvalRuleSetVersions', 'confidentialWhitelist', 'confidentialityAuthorizations', 'confidentialAccessGrants'].every(key => Array.isArray(data[key]))) {
    throw new DbError('INVALID_BACKUP_FORMAT', 400);
  }
  if (body.schemaVersion >= 5 && !['serviceCatalog', 'serviceAreas', 'serviceShifts', 'serviceInspections', 'checkInEvents', 'usageFacts', 'usageAppeals'].every(key => Array.isArray(data[key]))) {
    throw new DbError('INVALID_BACKUP_FORMAT', 400);
  }
  if (body.schemaVersion >= 6 && !['devices', 'exceptionActions'].every(key => Array.isArray(data[key]))) {
    throw new DbError('INVALID_BACKUP_FORMAT', 400);
  }
  if (body.schemaVersion >= 7 && !integrationBackupKeys.every(key => Array.isArray(data[key]))) throw new DbError('INVALID_BACKUP_FORMAT', 400);
  const roles: RoleDefinition[] = data.roles.map((role: any) => normalizeRole(role));
  unique(roles, 'ROLE');
  const departments: Department[] = data.departments.map((department: any) => normalizeDepartment(department));
  unique(departments, 'DEPARTMENT');
  if (departments.some(department => department.parentId && !departments.some(parent => parent.id === department.parentId))) throw new DbError('INVALID_BACKUP_REFERENCE', 400);
  const users = data.users.map((user: any) => normalizeUser(user, roles, departments));
  unique(users, 'USER');
  const ruleVersions: RuleVersion[] = (data.ruleVersions || []).map((version: any) => {
    if (!Number.isInteger(version?.version) || version.version < 1 || !Number.isFinite(Date.parse(version.createdAt))) throw new DbError('INVALID_RULE_VERSION', 400);
    return {
      version: version.version,
      settings: normalizeRuleSettings(version.settings),
      createdAt: new Date(version.createdAt).toISOString(),
      createdBy: idValue(version.createdBy)
    };
  });
  if (!ruleVersions.length) ruleVersions.push({ version: 1, settings: DEFAULT_RULE_SETTINGS, createdAt: new Date().toISOString(), createdBy: 'system' });
  if (new Set(ruleVersions.map(version => version.version)).size !== ruleVersions.length) throw new DbError('INVALID_RULE_VERSION', 400);
  const ruleSettings = getCurrentRuleSettings(ruleVersions);
  const resources: Resource[] = data.resources.map((resource: any) => normalizeResource({ ...resource, id: idValue(resource?.id) }, undefined, ruleSettings));
  unique(resources, 'RESOURCE');
  if (new Set(resources.map(resource => resource.code)).size !== resources.length || new Set(resources.map(resource => resource.name)).size !== resources.length) {
    throw new DbError('DUPLICATE_RESOURCE', 409);
  }
  const workflow = normalizeWorkflow(data.workflow, roles, departments);
  const workflowVersions: WorkflowVersion[] = data.workflowVersions.map((version: any) => {
    if (!Number.isInteger(version?.version) || version.version < 1 || !Number.isFinite(Date.parse(version.createdAt))) {
      throw new DbError('INVALID_WORKFLOW_VERSION', 400);
    }
    return {
      version: version.version, nodes: normalizeWorkflow(version.nodes, roles, departments),
      createdAt: new Date(version.createdAt).toISOString(), createdBy: idValue(version.createdBy)
    };
  });
  if (new Set(workflowVersions.map(version => version.version)).size !== workflowVersions.length) throw new DbError('INVALID_WORKFLOW_VERSION', 400);
  if (!workflowVersions.length) workflowVersions.push(latestWorkflowVersion([], workflow));
  const approvalRuleSetVersions = normalizeApprovalRuleSets(data.approvalRuleSetVersions || [], workflowVersions);
  const bookings: Booking[] = data.bookings.map((booking: any) => validateBackupBooking(booking, users, resources, roles, departments));
  unique(bookings, 'BOOKING');
  const confidentialWhitelist: ConfidentialWhitelistEntry[] = (data.confidentialWhitelist || []).map((entry: any) => {
    if (!users.some(user => user.id === entry?.userId) || !Number.isFinite(Date.parse(entry?.createdAt))) throw new DbError('INVALID_CONFIDENTIAL_WHITELIST', 400);
    return { id: idValue(entry.id), userId: idValue(entry.userId), reason: stringValue(entry.reason, 'CONFIDENTIAL_WHITELIST_REASON', 500), createdAt: new Date(entry.createdAt).toISOString(), createdBy: idValue(entry.createdBy) };
  });
  unique(confidentialWhitelist, 'CONFIDENTIAL_WHITELIST');
  if (new Set(confidentialWhitelist.map(entry => entry.userId)).size !== confidentialWhitelist.length) throw new DbError('INVALID_CONFIDENTIAL_WHITELIST', 400);
  const confidentialityAuthorizations: ConfidentialityAuthorization[] = (data.confidentialityAuthorizations || []).map((item: any) => {
    if (!bookings.some(booking => booking.id === item?.bookingId) || !users.some(user => user.id === item?.authorizedBy)
      || !['DECLASSIFY', 'ATTENDEE_CHANGE'].includes(item?.action) || !Number.isFinite(Date.parse(item?.createdAt))
      || (item.usedAt !== undefined && !Number.isFinite(Date.parse(item.usedAt)))) throw new DbError('INVALID_CONFIDENTIALITY_AUTHORIZATION', 400);
    return { id: idValue(item.id), bookingId: idValue(item.bookingId), action: item.action, reason: stringValue(item.reason, 'CONFIDENTIALITY_AUTHORIZATION_REASON', 500), authorizedBy: idValue(item.authorizedBy), createdAt: new Date(item.createdAt).toISOString(), usedAt: item.usedAt ? new Date(item.usedAt).toISOString() : undefined };
  });
  unique(confidentialityAuthorizations, 'CONFIDENTIALITY_AUTHORIZATION');
  const confidentialAccessGrants: ConfidentialAccessGrant[] = (data.confidentialAccessGrants || []).map((item: any) => {
    if (!bookings.some(booking => booking.id === item?.bookingId) || !users.some(user => user.id === item?.userId)
      || !['REQUESTER', 'ATTENDEE', 'APPROVER', 'SECURITY'].includes(item?.access) || !Number.isFinite(Date.parse(item?.grantedAt))) {
      throw new DbError('INVALID_CONFIDENTIAL_ACCESS_GRANT', 400);
    }
    return { id: idValue(item.id), bookingId: idValue(item.bookingId), userId: idValue(item.userId), access: item.access, grantedBy: idValue(item.grantedBy), grantedAt: new Date(item.grantedAt).toISOString() };
  });
  unique(confidentialAccessGrants, 'CONFIDENTIAL_ACCESS_GRANT');
  const policyState = { workflow, workflowVersions, approvalRuleSetVersions };
  ensureApprovalPolicy(policyState);
  const currentRuleSet = [...policyState.approvalRuleSetVersions].sort((a, b) => b.version - a.version)[0];
  const currentVersion = policyState.workflowVersions.find(item => item.version === currentRuleSet.defaultWorkflowVersion)!;
  const frozenBookings = bookings.map(booking => booking.status === 'PENDING' && !booking.approvalWorkflow
    ? { ...booking, workflowVersion: currentVersion.version, approvalWorkflow: structuredClone(currentVersion.nodes) }
    : booking);
  const delegates: ApprovalDelegate[] = data.approvalDelegates.map((delegate: any) => normalizeDelegate(delegate, users, actorId));
  unique(delegates, 'DELEGATION');
  const workOrders: WorkOrder[] = data.workOrders.map((order: any) => {
    if (!order || !isServiceType(order.type) || !['TODO', 'PENDING_INFO', 'IN_PROGRESS', 'DONE', 'CANCELLED', 'EXCEPTION'].includes(order.status)
      || !frozenBookings.some((booking: Booking) => booking.id === order.bookingId) || !roles.some(role => role.id === order.assigneeRole)) {
      throw new DbError('INVALID_BACKUP_WORK_ORDER', 400);
    }
    return { ...order, id: idValue(order.id), bookingId: idValue(order.bookingId), title: stringValue(order.title, 'WORK_ORDER_TITLE', 500) };
  });
  unique(workOrders, 'WORK_ORDER');
  const resourceImportBatches: ResourceImportBatch[] = (data.resourceImportBatches || []).map((batch: any) => {
    if (!batch?.report || !Array.isArray(batch.report.items) || batch.report.items.length > 500 || !Number.isFinite(Date.parse(batch.createdAt))) {
      throw new DbError('INVALID_BACKUP_RESOURCE_IMPORT', 400);
    }
    return {
      id: idValue(batch.id),
      actorId: idValue(batch.actorId),
      createdAt: new Date(batch.createdAt).toISOString(),
      report: structuredClone(batch.report)
    };
  });
  unique(resourceImportBatches, 'RESOURCE_IMPORT');
  const serviceCollections = {
    serviceCatalog: structuredClone(data.serviceCatalog || []),
    serviceAreas: structuredClone(data.serviceAreas || []),
    serviceShifts: structuredClone(data.serviceShifts || []),
    serviceInspections: structuredClone(data.serviceInspections || []),
    checkInEvents: structuredClone(data.checkInEvents || []),
    usageFacts: structuredClone(data.usageFacts || []),
    usageAppeals: structuredClone(data.usageAppeals || [])
  };
  ['serviceCatalog', 'serviceAreas', 'serviceShifts', 'serviceInspections', 'checkInEvents', 'usageAppeals'].forEach(key => unique((serviceCollections as any)[key], key.toUpperCase()));
  if (serviceCollections.checkInEvents.some((item: any) => !frozenBookings.some(booking => booking.id === item?.bookingId))
    || serviceCollections.usageFacts.some((item: any) => !frozenBookings.some(booking => booking.id === item?.bookingId))
    || serviceCollections.usageAppeals.some((item: any) => !frozenBookings.some(booking => booking.id === item?.bookingId) || !users.some(user => user.id === item?.requesterId))) {
    throw new DbError('INVALID_BACKUP_SERVICE_REFERENCE', 400);
  }
  const devices = validateDeviceBackup(data.devices || [], { resources, users });
  const exceptionActions = validateExceptionActions(data.exceptionActions || [], users, roles);
  const integrationCollections = validateIntegrationBackup(data, frozenBookings, users, resources);
  return mutateDb(async (db, { audit }) => {
    db.roles = roles;
    db.departments = departments;
    db.users = users;
    db.resources = resources;
    db.workflow = workflow;
    db.workflowVersions = policyState.workflowVersions;
    db.approvalRuleSetVersions = policyState.approvalRuleSetVersions;
    db.approvalDelegates = delegates;
    db.bookings = frozenBookings;
    db.workOrders = workOrders;
    db.ruleVersions = ruleVersions;
    db.resourceImportBatches = resourceImportBatches;
    db.confidentialWhitelist = confidentialWhitelist;
    db.confidentialityAuthorizations = confidentialityAuthorizations;
    db.confidentialAccessGrants = confidentialAccessGrants;
    db.serviceCatalog = serviceCollections.serviceCatalog;
    db.serviceAreas = serviceCollections.serviceAreas;
    db.serviceShifts = serviceCollections.serviceShifts;
    db.serviceInspections = serviceCollections.serviceInspections;
    db.checkInEvents = serviceCollections.checkInEvents;
    db.usageFacts = serviceCollections.usageFacts;
    db.usageAppeals = serviceCollections.usageAppeals;
    db.devices = devices;
    db.exceptionActions = exceptionActions;
    for (const key of integrationBackupKeys) (db as any)[key] = integrationCollections[key];
    ensureServiceDomain(db);
    await audit({ actorId, action: 'BACKUP_RESTORE', entityType: 'BACKUP', entityId: String(body.revision || 0), details: { bookings: frozenBookings.length, users: users.length, resources: resources.length } });
    return { ok: true, counts: { users: users.length, resources: resources.length, bookings: frozenBookings.length } };
  }, { replaceBookings: true });
};

import crypto from 'node:crypto';
import { DbError, mutateDb, readSnapshot, validateResource } from './db.ts';
import { isActiveBooking } from '../utils/bookingRules.ts';
import type { ApprovalDelegate, ApprovalNode, Booking, Department, Resource, RoleDefinition, User, WorkOrder, WorkflowVersion } from '../types.ts';

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

const normalizeRole = (input: any, id?: string): RoleDefinition => ({
  id: id || idValue(input?.id),
  name: stringValue(input?.name, 'ROLE_NAME', 80),
  description: stringValue(input?.description, 'ROLE_DESCRIPTION', 500),
  color: ['indigo', 'emerald', 'amber', 'rose', 'purple'].includes(input?.color) ? input.color : 'indigo'
});

const normalizeUser = (input: any, roles: RoleDefinition[], departments: Department[], id?: string): User => {
  const role: string[] = Array.isArray(input?.role) ? [...new Set(input.role as string[])] : [];
  if (!role.length || role.some((item: any) => typeof item !== 'string' || !roles.some(candidate => candidate.id === item))) {
    throw new DbError('INVALID_USER_ROLE', 400);
  }
  const department = stringValue(input?.department, 'DEPARTMENT', 100);
  if (!departments.some(item => item.name === department)) throw new DbError('DEPARTMENT_NOT_FOUND', 400);
  const email = stringValue(input?.email, 'EMAIL', 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DbError('INVALID_EMAIL', 400);
  return {
    id: id || idValue(input?.id), name: stringValue(input?.name, 'USER_NAME', 100), email, role, department,
    landline: optionalString(input?.landline, 'LANDLINE'), mobile: optionalString(input?.mobile, 'MOBILE')
  };
};

const normalizeDepartment = (input: any, id?: string): Department => ({
  id: id || idValue(input?.id), name: stringValue(input?.name, 'DEPARTMENT_NAME', 100),
  parentId: input?.parentId ? idValue(input.parentId) : undefined
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

export const saveUser = async (input: any, actorId: string, editingId?: string) => mutateDb(async (db, { audit }) => {
  const roles = db.roles || [];
  const departments = db.departments || [];
  const users = db.users || [];
  const current = editingId ? users.find(user => user.id === editingId) : undefined;
  if (editingId && !current) throw new DbError('USER_NOT_FOUND', 404);
  const merged = editingId ? { ...current, ...input, id: editingId } : input;
  const user = normalizeUser(merged, roles, departments, editingId);
  if (!editingId && users.some(item => item.id === user.id)) throw new DbError('DUPLICATE_USER_ID', 409);
  if (users.some(item => item.id !== user.id && item.email.toLowerCase() === user.email)) throw new DbError('DUPLICATE_EMAIL', 409);
  db.users = editingId ? users.map(item => item.id === editingId ? user : item) : [...users, user];
  await audit({ actorId, action: editingId ? 'USER_UPDATE' : 'USER_CREATE', entityType: 'USER', entityId: user.id });
  return user;
});

export const deleteUser = async (id: string, actorId: string) => mutateDb(async (db, { audit }) => {
  if (id === actorId) throw new DbError('CANNOT_DELETE_SELF', 409);
  if (!(db.users || []).some(user => user.id === id)) throw new DbError('USER_NOT_FOUND', 404);
  if ((db.bookings || []).some(booking => booking.userId === id && isActiveBooking(booking))) {
    throw new DbError('USER_HAS_ACTIVE_BOOKINGS', 409);
  }
  if ((db.approvalDelegates || []).some(item => item.delegatorId === id || item.delegateId === id)) {
    throw new DbError('USER_HAS_DELEGATIONS', 409);
  }
  db.users = (db.users || []).filter(user => user.id !== id);
  await audit({ actorId, action: 'USER_DELETE', entityType: 'USER', entityId: id });
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
  await audit({ actorId, action: editingId ? 'ROLE_UPDATE' : 'ROLE_CREATE', entityType: 'ROLE', entityId: role.id });
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
  await audit({ actorId, action: editingId ? 'DEPARTMENT_UPDATE' : 'DEPARTMENT_CREATE', entityType: 'DEPARTMENT', entityId: department.id });
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
  await audit({ actorId, action: 'DEPARTMENT_DELETE', entityType: 'DEPARTMENT', entityId: id });
  return { ok: true };
});

export const saveWorkflow = async (input: any, actorId: string) => mutateDb(async (db, { audit }) => {
  const workflow = normalizeWorkflow(input, db.roles || [], db.departments || []);
  const current = latestWorkflowVersion(db.workflowVersions, db.workflow || []);
  db.bookings = (db.bookings || []).map(booking => booking.status === 'PENDING' && !booking.approvalWorkflow
    ? { ...booking, workflowVersion: current.version, approvalWorkflow: structuredClone(current.nodes) }
    : booking);
  const version: WorkflowVersion = {
    version: current.version + 1,
    nodes: structuredClone(workflow),
    createdAt: new Date().toISOString(),
    createdBy: actorId
  };
  db.workflowVersions = [...(db.workflowVersions || []).filter(item => item.version !== current.version), current, version]
    .sort((a, b) => a.version - b.version);
  db.workflow = workflow;
  await audit({ actorId, action: 'WORKFLOW_PUBLISH', entityType: 'WORKFLOW', entityId: String(version.version), details: { nodeCount: workflow.length } });
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
  await audit({ actorId, action: 'DELEGATION_CREATE', entityType: 'DELEGATION', entityId: delegate.id, details: { delegatorId: delegate.delegatorId, delegateId: delegate.delegateId, startsAt: delegate.startsAt, endsAt: delegate.endsAt } });
  return delegate;
});

export const deleteApprovalDelegate = async (id: string, actorId: string) => mutateDb(async (db, { audit }) => {
  const current = (db.approvalDelegates || []).find(item => item.id === id);
  if (!current) throw new DbError('DELEGATION_NOT_FOUND', 404);
  db.approvalDelegates = (db.approvalDelegates || []).filter(item => item.id !== id);
  await audit({ actorId, action: 'DELEGATION_REVOKE', entityType: 'DELEGATION', entityId: id });
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
    const resources: Resource[] = input.map(item => ({ ...item, id: idValue(item?.id) }));
    resources.forEach(validateResource);
    unique([...(db.resources || []), ...resources], 'RESOURCE');
    if (resources.some(resource => (db.resources || []).some(existing => existing.name === resource.name))) throw new DbError('DUPLICATE_RESOURCE_NAME', 409);
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

export const createBackup = async () => {
  const { db, revision } = await readSnapshot();
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    revision,
    collections: {
      roles: db.roles || [], users: db.users || [], resources: db.resources || [], bookings: db.bookings || [],
      departments: db.departments || [], workflow: db.workflow || [], workflowVersions: db.workflowVersions || [],
      approvalDelegates: db.approvalDelegates || [], workOrders: db.workOrders || []
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

export const restoreBackup = async (body: any, actorId: string) => {
  if (body?.schemaVersion !== 2 || !body.collections) throw new DbError('INVALID_BACKUP_FORMAT', 400);
  const data = body.collections;
  if (!['roles', 'users', 'resources', 'bookings', 'departments', 'workflow', 'workflowVersions', 'approvalDelegates', 'workOrders'].every(key => Array.isArray(data[key]))) {
    throw new DbError('INVALID_BACKUP_FORMAT', 400);
  }
  const roles: RoleDefinition[] = data.roles.map((role: any) => normalizeRole(role));
  unique(roles, 'ROLE');
  const departments: Department[] = data.departments.map((department: any) => normalizeDepartment(department));
  unique(departments, 'DEPARTMENT');
  if (departments.some(department => department.parentId && !departments.some(parent => parent.id === department.parentId))) throw new DbError('INVALID_BACKUP_REFERENCE', 400);
  const users = data.users.map((user: any) => normalizeUser(user, roles, departments));
  unique(users, 'USER');
  const resources: Resource[] = data.resources.map((resource: any) => ({ ...resource, id: idValue(resource?.id) }));
  resources.forEach(validateResource);
  unique(resources, 'RESOURCE');
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
  const bookings: Booking[] = data.bookings.map((booking: any) => validateBackupBooking(booking, users, resources, roles, departments));
  unique(bookings, 'BOOKING');
  const currentVersion = latestWorkflowVersion(workflowVersions, workflow);
  const frozenBookings = bookings.map(booking => booking.status === 'PENDING' && !booking.approvalWorkflow
    ? { ...booking, workflowVersion: currentVersion.version, approvalWorkflow: structuredClone(currentVersion.nodes) }
    : booking);
  const delegates: ApprovalDelegate[] = data.approvalDelegates.map((delegate: any) => normalizeDelegate(delegate, users, actorId));
  unique(delegates, 'DELEGATION');
  const workOrders: WorkOrder[] = data.workOrders.map((order: any) => {
    if (!order || !['TEA', 'VIDEO'].includes(order.type) || !['TODO', 'DONE'].includes(order.status)
      || !frozenBookings.some((booking: Booking) => booking.id === order.bookingId) || !roles.some(role => role.id === order.assigneeRole)) {
      throw new DbError('INVALID_BACKUP_WORK_ORDER', 400);
    }
    return { ...order, id: idValue(order.id), bookingId: idValue(order.bookingId), title: stringValue(order.title, 'WORK_ORDER_TITLE', 500) };
  });
  unique(workOrders, 'WORK_ORDER');
  return mutateDb(async (db, { audit }) => {
    db.roles = roles;
    db.departments = departments;
    db.users = users;
    db.resources = resources;
    db.workflow = workflow;
    db.workflowVersions = workflowVersions;
    db.approvalDelegates = delegates;
    db.bookings = frozenBookings;
    db.workOrders = workOrders;
    await audit({ actorId, action: 'BACKUP_RESTORE', entityType: 'BACKUP', entityId: String(body.revision || 0), details: { bookings: frozenBookings.length, users: users.length, resources: resources.length } });
    return { ok: true, counts: { users: users.length, resources: resources.length, bookings: frozenBookings.length } };
  }, { replaceBookings: true });
};

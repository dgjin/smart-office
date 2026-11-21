import crypto from 'node:crypto';
import type { Department, OrganizationDepartmentInput, OrganizationSyncBatch, OrganizationSyncChange, OrganizationUserInput, User } from '../types.ts';
import { normalizeDepartment, normalizeUser } from './admin.ts';
import { DbError, mutateDb, readDb, readSnapshot } from './db.ts';
import type { OfficeDb } from './tools.ts';

type OrganizationSyncInput = {
  source: string;
  mode: 'FULL' | 'DELTA';
  departments: OrganizationDepartmentInput[];
  users: OrganizationUserInput[];
};

type OrganizationPlan = {
  departments: Department[];
  users: User[];
  changes: OrganizationSyncChange[];
  disabledUserIds: string[];
};

const text = (value: unknown, field: string, max = 255) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new DbError(`INVALID_${field}`, 400);
  return value.trim();
};

const normalizeInput = (input: any): OrganizationSyncInput => {
  const source = text(input?.source, 'ORGANIZATION_SOURCE', 100);
  if (!['FULL', 'DELTA'].includes(input?.mode)) throw new DbError('INVALID_ORGANIZATION_SYNC_MODE', 400);
  if (!Array.isArray(input?.departments) || !Array.isArray(input?.users)
    || input.departments.length > 2000 || input.users.length > 10000) {
    throw new DbError('INVALID_ORGANIZATION_SYNC_INPUT', 400);
  }
  const departments = input.departments.map((item: any): OrganizationDepartmentInput => ({
    externalId: text(item?.externalId, 'DEPARTMENT_EXTERNAL_ID'),
    id: item?.id === undefined ? undefined : text(item.id, 'DEPARTMENT_ID', 128),
    name: text(item?.name, 'DEPARTMENT_NAME', 100),
    parentExternalId: item?.parentExternalId === undefined ? undefined : text(item.parentExternalId, 'PARENT_DEPARTMENT_EXTERNAL_ID')
  }));
  const users = input.users.map((item: any): OrganizationUserInput => ({
    externalId: text(item?.externalId, 'USER_EXTERNAL_ID'),
    id: item?.id === undefined ? undefined : text(item.id, 'USER_ID', 128),
    name: text(item?.name, 'USER_NAME', 100),
    email: text(item?.email, 'EMAIL', 200).toLowerCase(),
    role: Array.isArray(item?.role) ? [...new Set<string>(item.role.map((role: unknown) => text(role, 'USER_ROLE', 128)))].sort() : [],
    departmentExternalId: text(item?.departmentExternalId, 'DEPARTMENT_EXTERNAL_ID'),
    landline: item?.landline === undefined ? undefined : text(item.landline, 'LANDLINE', 100),
    mobile: item?.mobile === undefined ? undefined : text(item.mobile, 'MOBILE', 100),
    status: item?.status || 'ACTIVE'
  }));
  if (users.some(user => !['ACTIVE', 'DISABLED'].includes(user.status || 'ACTIVE'))) throw new DbError('INVALID_USER_STATUS', 400);
  const unique = (values: string[], code: string) => {
    if (new Set(values).size !== values.length) throw new DbError(code, 409);
  };
  unique(departments.map(item => item.externalId), 'DUPLICATE_DEPARTMENT_EXTERNAL_ID');
  unique(users.map(item => item.externalId), 'DUPLICATE_USER_EXTERNAL_ID');
  unique(departments.filter(item => item.id).map(item => item.id!), 'DUPLICATE_DEPARTMENT_ID');
  unique(users.filter(item => item.id).map(item => item.id!), 'DUPLICATE_USER_ID');
  return { source, mode: input.mode, departments, users };
};

const generatedId = (prefix: string, source: string, externalId: string) =>
  `${prefix}-${crypto.createHash('sha256').update(`${source}:${externalId}`).digest('hex').slice(0, 24)}`;

const canonical = (value: any): any => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const same = (left: unknown, right: unknown) => JSON.stringify(canonical(left ?? null)) === JSON.stringify(canonical(right ?? null));

const findMapped = <T extends { externalId?: string; directorySource?: string }>(items: T[], source: string, externalId: string) => {
  const matches = items.filter(item => item.directorySource === source && item.externalId === externalId);
  if (matches.length > 1) throw new DbError('ORGANIZATION_MAPPING_AMBIGUOUS', 409);
  return matches[0];
};

const resolveCurrent = <T extends { id: string; externalId?: string; directorySource?: string }>(
  items: T[], source: string, input: { id?: string; externalId: string }
) => {
  const mapped = findMapped(items, source, input.externalId);
  const identified = input.id ? items.find(item => item.id === input.id) : undefined;
  if (mapped && identified && mapped.id !== identified.id) throw new DbError('ORGANIZATION_BINDING_CONFLICT', 409);
  const current = identified || mapped;
  if (identified?.externalId && (identified.externalId !== input.externalId || identified.directorySource !== source)) {
    throw new DbError('ORGANIZATION_BINDING_CONFLICT', 409);
  }
  return current;
};

const validateDepartments = (departments: Department[]) => {
  if (new Set(departments.map(item => item.id)).size !== departments.length
    || new Set(departments.map(item => item.name)).size !== departments.length) {
    throw new DbError('DUPLICATE_DEPARTMENT', 409);
  }
  for (const department of departments) {
    if (department.parentId && !departments.some(item => item.id === department.parentId)) {
      throw new DbError('PARENT_DEPARTMENT_NOT_FOUND', 400);
    }
    const visited = new Set<string>();
    let current: Department | undefined = department;
    while (current?.parentId) {
      if (visited.has(current.id)) throw new DbError('DEPARTMENT_CYCLE', 409);
      visited.add(current.id);
      current = departments.find(item => item.id === current!.parentId);
    }
  }
};

const buildPlan = (db: OfficeDb, input: OrganizationSyncInput, actorId: string, now: string): OrganizationPlan => {
  const roles = db.roles || [];
  const currentDepartments = db.departments || [];
  const departmentChanges: OrganizationSyncChange[] = [];
  const departmentUpdates = new Map<string, Department>();
  const departmentIds = new Map<string, string>();

  for (const item of input.departments) {
    const current = resolveCurrent(currentDepartments, input.source, item);
    const id = current?.id || item.id || generatedId('dpt', input.source, item.externalId);
    if (!current && currentDepartments.some(department => department.id === id)) throw new DbError('ORGANIZATION_ID_COLLISION', 409);
    departmentIds.set(item.externalId, id);
    departmentUpdates.set(item.externalId, normalizeDepartment({
      ...current, id, name: item.name, externalId: item.externalId, directorySource: input.source
    }, id));
  }
  for (const department of currentDepartments) {
    if (department.directorySource === input.source && department.externalId && !departmentIds.has(department.externalId)) {
      departmentIds.set(department.externalId, department.id);
    }
  }
  for (const item of input.departments) {
    const current = resolveCurrent(currentDepartments, input.source, item);
    const base = departmentUpdates.get(item.externalId)!;
    const parentId = item.parentExternalId ? departmentIds.get(item.parentExternalId) : current?.parentId;
    if (item.parentExternalId && !parentId) throw new DbError('PARENT_DEPARTMENT_NOT_FOUND', 400);
    const next = normalizeDepartment({ ...base, parentId }, base.id);
    departmentUpdates.set(item.externalId, next);
    const changedFields = (['name', 'parentId', 'externalId', 'directorySource'] as const)
      .filter(field => !same(current?.[field], next[field]));
    departmentChanges.push({
      entityType: 'DEPARTMENT', entityId: next.id, externalId: item.externalId,
      action: !current ? 'CREATE' : changedFields.length ? 'UPDATE' : 'UNCHANGED', changedFields
    });
  }
  const departments = currentDepartments.map(current => {
    const incoming = input.departments.find(item => departmentIds.get(item.externalId) === current.id);
    return incoming ? departmentUpdates.get(incoming.externalId)! : current;
  });
  for (const item of input.departments) {
    const next = departmentUpdates.get(item.externalId)!;
    if (!departments.some(department => department.id === next.id)) departments.push(next);
  }
  validateDepartments(departments);

  const renamedDepartments = new Map<string, string>();
  for (const current of currentDepartments) {
    const next = departments.find(department => department.id === current.id);
    if (next && next.name !== current.name) renamedDepartments.set(current.name, next.name);
  }
  const baseUsers = (db.users || []).map(user => ({ ...user, department: renamedDepartments.get(user.department) || user.department }));
  const usersById = new Map(baseUsers.map(user => [user.id, user]));
  const userChanges: OrganizationSyncChange[] = [];
  const disabledUserIds: string[] = [];
  const incomingExternalIds = new Set(input.users.map(item => item.externalId));
  const fields = ['name', 'email', 'role', 'department', 'landline', 'mobile', 'status', 'externalId', 'directorySource', 'disabledAt', 'disabledReason'] as const;

  const applyUser = (item: OrganizationUserInput, current: User | undefined, absent = false) => {
    const id = current?.id || item.id || generatedId('u', input.source, item.externalId);
    if (!current && baseUsers.some(user => user.id === id)) throw new DbError('ORGANIZATION_ID_COLLISION', 409);
    const departmentId = departmentIds.get(item.departmentExternalId);
    const department = departments.find(item => item.id === departmentId);
    if (!department) throw new DbError('DEPARTMENT_NOT_FOUND', 400);
    const status = absent ? 'DISABLED' : item.status || 'ACTIVE';
    const disabled = status === 'DISABLED';
    const next = normalizeUser({
      ...current, ...item, id, department: department.name, role: item.role,
      landline: item.landline ?? current?.landline, mobile: item.mobile ?? current?.mobile,
      externalId: item.externalId, directorySource: input.source, directorySyncedAt: absent ? current?.directorySyncedAt : now,
      status, disabledAt: disabled ? current?.disabledAt || now : undefined,
      disabledReason: disabled ? absent ? '权威组织全量快照中已移除' : '权威组织源已停用' : undefined
    }, roles, departments, id);
    const changedFields = absent ? ['status'] : fields.filter(field => {
      const left = field === 'status' ? current?.status || 'ACTIVE' : current?.[field];
      return !same(left, next[field]);
    });
    const action = absent || (current && current.status !== 'DISABLED' && disabled) ? 'DISABLE'
      : !current ? 'CREATE' : changedFields.length ? 'UPDATE' : 'UNCHANGED';
    userChanges.push({ entityType: 'USER', entityId: id, externalId: item.externalId, action, changedFields });
    if (disabled && current?.status !== 'DISABLED') disabledUserIds.push(id);
    usersById.set(id, action === 'UNCHANGED' ? current! : next);
  };

  for (const item of input.users) applyUser(item, resolveCurrent(baseUsers, input.source, item));
  if (input.mode === 'FULL') {
    const absent = baseUsers.filter(user => user.directorySource === input.source && user.externalId
      && !incomingExternalIds.has(user.externalId) && user.status !== 'DISABLED');
    for (const current of absent) {
      applyUser({
        externalId: current.externalId!, id: current.id, name: current.name, email: current.email,
        role: current.role, departmentExternalId: departments.find(department => department.name === current.department)?.externalId || '',
        landline: current.landline, mobile: current.mobile, status: 'DISABLED'
      }, current, true);
    }
  }

  const users = [...usersById.values()];
  if (new Set(users.map(user => user.email.toLowerCase())).size !== users.length) throw new DbError('DUPLICATE_EMAIL', 409);
  const actor = users.find(user => user.id === actorId);
  if (!actor || actor.status === 'DISABLED') throw new DbError('CANNOT_DISABLE_SELF', 409);
  if (!users.some(user => user.status !== 'DISABLED' && user.role.includes('SYSTEM_ADMIN'))) {
    throw new DbError('LAST_ACTIVE_ADMIN_REQUIRED', 409);
  }
  return { departments, users, changes: [...departmentChanges, ...userChanges], disabledUserIds };
};

const counts = (changes: OrganizationSyncChange[]) => Object.fromEntries(['CREATE', 'UPDATE', 'DISABLE', 'UNCHANGED']
  .map(action => [action.toLowerCase(), changes.filter(change => change.action === action).length]));

export const previewOrganizationSync = async (body: any, actorId: string) => {
  const input = normalizeInput(body);
  const { revision } = await readSnapshot();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  return mutateDb(async (db, { audit }) => {
    const plan = buildPlan(db, input, actorId, createdAt);
    const batch: OrganizationSyncBatch = {
      id, ...input, status: 'PREVIEWED', revision: revision + 1, createdAt, createdBy: actorId, changes: plan.changes
    };
    db.organizationSyncBatches = [batch, ...(db.organizationSyncBatches || [])];
    await audit({ actorId, action: 'ORGANIZATION_SYNC_PREVIEW', entityType: 'ORGANIZATION_SYNC', entityId: id, details: { source: input.source, mode: input.mode, ...counts(plan.changes) } });
    return batch;
  }, { expectedRevision: revision });
};

export const applyOrganizationSync = async (batchId: string, actorId: string) => mutateDb(async (db, { audit, revision, revokeUserSessions }) => {
  const current = (db.organizationSyncBatches || []).find(batch => batch.id === batchId);
  if (!current) throw new DbError('ORGANIZATION_SYNC_BATCH_NOT_FOUND', 404);
  if (current.status === 'APPLIED') return { batch: current, idempotent: true };
  if (current.revision !== revision) throw new DbError('STALE_SNAPSHOT', 412, { currentRevision: revision });
  const appliedAt = new Date().toISOString();
  const input = normalizeInput(current);
  const plan = buildPlan(db, input, actorId, appliedAt);
  if (!same(current.changes, plan.changes)) throw new DbError('ORGANIZATION_SYNC_DIFF_CHANGED', 409, { expected: current.changes, actual: plan.changes });
  db.departments = plan.departments;
  db.users = plan.users;
  await revokeUserSessions(plan.disabledUserIds);
  const batch: OrganizationSyncBatch = { ...current, status: 'APPLIED', appliedAt, changes: plan.changes };
  db.organizationSyncBatches = (db.organizationSyncBatches || []).map(item => item.id === batchId ? batch : item);
  await audit({ actorId, action: 'ORGANIZATION_SYNC_APPLY', entityType: 'ORGANIZATION_SYNC', entityId: batchId, details: { source: input.source, mode: input.mode, ...counts(plan.changes), revokedUserIds: plan.disabledUserIds } });
  return { batch, idempotent: false };
}, { snapshot: result => !result.idempotent });

export const listOrganizationSyncBatches = async () =>
  [...(await readDb()).organizationSyncBatches || []].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

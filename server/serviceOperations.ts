import crypto from 'node:crypto';
import type { ServiceArea, ServiceCatalogItem, ServiceInspection, ServiceShift, User, WorkOrder, WorkOrderStatus } from '../types.ts';
import { mutateDb } from './db.ts';
import { DbError } from './errors.ts';
import type { OfficeDb } from './tools.ts';
import { bookingNoticePurpose } from './confidentiality.ts';
import { canManageServiceOperations, canManageWorkOrder, ensureServiceDomain } from './serviceDomain.ts';

const text = (value: unknown, code: string, max = 500, required = true) => {
  if (value === undefined || value === null || value === '') {
    if (!required) return undefined;
    throw new DbError(code, 400);
  }
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new DbError(code, 400);
  return value.trim();
};

export const saveServiceCatalogItem = async (input: any, actor: User, editingId?: string) => mutateDb(async (db, { audit }) => {
  ensureServiceDomain(db);
  const current = editingId ? (db.serviceCatalog || []).find(item => item.id === editingId) : undefined;
  if (editingId && !current) throw new DbError('SERVICE_CATALOG_ITEM_NOT_FOUND', 404);
  if (!current && !actor.role.includes('SYSTEM_ADMIN')) throw new DbError('FORBIDDEN', 403);
  if (current && !actor.role.includes('SYSTEM_ADMIN')) throw new DbError('FORBIDDEN', 403);
  const type = current?.type || input?.type;
  if (!['TEA', 'VIDEO', 'SIGNAGE', 'SECURITY', 'OTHER'].includes(type)) throw new DbError('INVALID_SERVICE_TYPE', 400);
  if (input?.type && current && input.type !== current.type) throw new DbError('SERVICE_TYPE_IMMUTABLE', 409);
  if (!Array.isArray(input?.fields) || input.fields.length > 20) throw new DbError('INVALID_SERVICE_FIELDS', 400);
  const fields = input.fields.map((field: any) => {
    if (!field || !['TEXT', 'TEXTAREA', 'NUMBER', 'SELECT'].includes(field.type) || typeof field.required !== 'boolean') {
      throw new DbError('INVALID_SERVICE_FIELDS', 400);
    }
    const key = text(field.key, 'INVALID_SERVICE_FIELDS', 50);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key!)) throw new DbError('INVALID_SERVICE_FIELDS', 400);
    const options = field.type === 'SELECT'
      ? Array.isArray(field.options) ? field.options.map((option: any) => text(option, 'INVALID_SERVICE_FIELDS', 100)) : []
      : undefined;
    if (field.type === 'SELECT' && !options?.length) throw new DbError('INVALID_SERVICE_FIELDS', 400);
    return { key, label: text(field.label, 'INVALID_SERVICE_FIELDS', 100), type: field.type, required: field.required, options };
  });
  if (new Set(fields.map((field: any) => field.key)).size !== fields.length) throw new DbError('DUPLICATE_SERVICE_FIELD', 400);
  if (!Array.isArray(input?.resourceTypes) || !input.resourceTypes.length || input.resourceTypes.some((type: any) => !['ROOM', 'DESK'].includes(type))) {
    throw new DbError('INVALID_SERVICE_RESOURCE_TYPES', 400);
  }
  if (input.roomCategories !== undefined && (!Array.isArray(input.roomCategories)
    || input.roomCategories.some((category: any) => !['SMALL', 'MEDIUM', 'LARGE', 'AUDITORIUM'].includes(category)))) {
    throw new DbError('INVALID_SERVICE_ROOM_CATEGORIES', 400);
  }
  if (!Number.isInteger(input?.slaResponseMinutes) || input.slaResponseMinutes < 1 || input.slaResponseMinutes > 1440) {
    throw new DbError('INVALID_SERVICE_SLA', 400);
  }
  if (typeof input?.heavyService !== 'boolean' || typeof input?.cancellable !== 'boolean') throw new DbError('INVALID_SERVICE_CATALOG_ITEM', 400);
  if (!(db.roles || []).some(role => role.id === input?.responsibleRole)) throw new DbError('SERVICE_RESPONSIBLE_ROLE_NOT_FOUND', 400);
  const now = new Date().toISOString();
  const item: ServiceCatalogItem = {
    id: current?.id || `service-${crypto.randomUUID()}`,
    type,
    name: text(input.name, 'INVALID_SERVICE_NAME', 100)!,
    version: current ? current.version + 1 : 1,
    fields,
    responsibleRole: input.responsibleRole,
    slaResponseMinutes: input.slaResponseMinutes,
    heavyService: input.heavyService,
    cancellable: input.cancellable,
    resourceTypes: [...new Set(input.resourceTypes)] as ServiceCatalogItem['resourceTypes'],
    roomCategories: input.roomCategories?.length ? [...new Set(input.roomCategories)] as ServiceCatalogItem['roomCategories'] : undefined,
    updatedAt: now,
    updatedBy: actor.id
  };
  db.serviceCatalog = current
    ? (db.serviceCatalog || []).map(existing => existing.id === current.id ? item : existing)
    : [...(db.serviceCatalog || []), item];
  await audit({ actorId: actor.id, action: current ? 'SERVICE_CATALOG_UPDATE' : 'SERVICE_CATALOG_CREATE', entityType: 'SERVICE_CATALOG', entityId: item.id, details: { version: item.version, type: item.type } });
  return item;
});

export type WorkOrderTransitionInput = {
  action: 'REQUEST_INFO' | 'PROVIDE_INFO' | 'START' | 'COMPLETE' | 'CANCEL' | 'EXCEPTION' | 'RESUME';
  reason?: string;
  executionResult?: string;
  costAmount?: number;
  costNote?: string;
  fieldValues?: Record<string, string>;
};

export const applyWorkOrderTransition = (db: OfficeDb, order: WorkOrder, actor: User, input: WorkOrderTransitionInput, at = new Date().toISOString()): WorkOrder => {
  const booking = (db.bookings || []).find(item => item.id === order.bookingId);
  const requester = booking?.userId === actor.id;
  const manager = canManageWorkOrder(actor, order);
  if (!manager && !(requester && input.action === 'PROVIDE_INFO')) throw new DbError('FORBIDDEN', 403);
  const targets: Record<WorkOrderTransitionInput['action'], WorkOrderStatus> = {
    REQUEST_INFO: 'PENDING_INFO', PROVIDE_INFO: 'TODO', START: 'IN_PROGRESS', COMPLETE: 'DONE',
    CANCEL: 'CANCELLED', EXCEPTION: 'EXCEPTION', RESUME: 'IN_PROGRESS'
  };
  const allowed: Record<WorkOrderTransitionInput['action'], WorkOrderStatus[]> = {
    REQUEST_INFO: ['TODO', 'IN_PROGRESS'],
    PROVIDE_INFO: ['PENDING_INFO'],
    START: ['TODO'],
    COMPLETE: ['IN_PROGRESS'],
    CANCEL: ['TODO', 'PENDING_INFO'],
    EXCEPTION: ['TODO', 'PENDING_INFO', 'IN_PROGRESS'],
    RESUME: ['EXCEPTION']
  };
  if (!allowed[input.action] || !allowed[input.action].includes(order.status)) throw new DbError('INVALID_WORK_ORDER_TRANSITION', 409, { from: order.status, action: input.action });
  let fieldValues = order.fieldValues || {};
  if (input.action === 'PROVIDE_INFO') {
    if (!input.fieldValues || typeof input.fieldValues !== 'object' || Array.isArray(input.fieldValues)) throw new DbError('WORK_ORDER_FIELD_VALUES_REQUIRED', 400);
    const fields = order.requirementSnapshot?.catalogSnapshot?.fields || [];
    const supplied = { ...fieldValues };
    for (const [key, value] of Object.entries(input.fieldValues)) {
      const field = fields.find(item => item.key === key);
      if (!field || typeof value !== 'string' || value.trim().length > 500) throw new DbError('INVALID_SERVICE_FIELD_VALUE', 400, { field: key });
      const normalized = value.trim();
      if (normalized && field.type === 'NUMBER' && (!Number.isFinite(Number(normalized)) || Number(normalized) < 0)) throw new DbError('INVALID_SERVICE_FIELD_VALUE', 400, { field: key });
      if (normalized && field.type === 'SELECT' && !field.options?.includes(normalized)) throw new DbError('INVALID_SERVICE_FIELD_VALUE', 400, { field: key });
      if (normalized) supplied[key] = normalized;
      else delete supplied[key];
    }
    for (const field of fields) {
      if (field.required && !supplied[field.key]?.trim()) throw new DbError('SERVICE_FIELD_REQUIRED', 400, { field: field.key });
    }
    fieldValues = supplied;
  }
  const reason = text(input.reason, 'WORK_ORDER_REASON_REQUIRED', 500, ['REQUEST_INFO', 'CANCEL', 'EXCEPTION', 'RESUME'].includes(input.action));
  const executionResult = text(input.executionResult, 'WORK_ORDER_EXECUTION_RESULT_REQUIRED', 1000, input.action === 'COMPLETE');
  if (input.costAmount !== undefined && (!Number.isFinite(input.costAmount) || input.costAmount < 0 || input.costAmount > 100000000)) {
    throw new DbError('INVALID_WORK_ORDER_COST', 400);
  }
  if (input.action === 'CANCEL' && order.requirementSnapshot?.catalogSnapshot?.cancellable === false) {
    throw new DbError('WORK_ORDER_NOT_CANCELLABLE', 409);
  }
  const to = targets[input.action];
  return {
    ...order,
    status: to,
    fieldValues,
    requirementSnapshot: order.requirementSnapshot ? {
      ...order.requirementSnapshot,
      fieldValues,
      details: fieldValues.notes || order.requirementSnapshot.details
    } : order.requirementSnapshot,
    assigneeId: manager && ['START', 'COMPLETE', 'EXCEPTION', 'RESUME'].includes(input.action) ? actor.id : order.assigneeId,
    respondedAt: input.action === 'START' ? order.respondedAt || at : order.respondedAt,
    startedAt: input.action === 'START' ? order.startedAt || at : order.startedAt,
    completedAt: input.action === 'COMPLETE' ? at : order.completedAt,
    cancelledAt: input.action === 'CANCEL' ? at : order.cancelledAt,
    cancellationReason: input.action === 'CANCEL' ? reason : order.cancellationReason,
    exceptionReason: input.action === 'EXCEPTION' ? reason : input.action === 'RESUME' ? undefined : order.exceptionReason,
    executionResult: input.action === 'COMPLETE' ? executionResult : order.executionResult,
    costAmount: input.costAmount ?? order.costAmount,
    costNote: text(input.costNote, 'INVALID_WORK_ORDER_COST_NOTE', 500, false) ?? order.costNote,
    statusHistory: [...(order.statusHistory || []), { from: order.status, to, actorId: actor.id, at, reason: reason || executionResult }]
  };
};

export const transitionWorkOrder = async (actor: User, workOrderId: string, input: WorkOrderTransitionInput) => mutateDb(async (db, { audit }) => {
  ensureServiceDomain(db);
  const order = (db.workOrders || []).find(item => item.id === workOrderId);
  if (!order) throw new DbError('WORK_ORDER_NOT_FOUND', 404);
  const next = applyWorkOrderTransition(db, order, actor, input);
  db.workOrders = (db.workOrders || []).map(item => item.id === order.id ? next : item);
  await audit({ actorId: actor.id, action: `WORK_ORDER_${input.action}`, entityType: 'WORK_ORDER', entityId: order.id, details: { bookingId: order.bookingId, from: order.status, to: next.status, costAmount: next.costAmount } });
  const booking = (db.bookings || []).find(item => item.id === order.bookingId);
  if (booking) {
    const recipients = input.action === 'PROVIDE_INFO'
      ? (db.users || []).filter(user => user.role.includes(order.assigneeRole)).map(user => user.id)
      : [booking.userId];
    db.notifications = [...recipients.map(userId => ({
      id: crypto.randomUUID(), userId, title: input.action === 'PROVIDE_INFO' ? '服务待定信息已补充' : '会务服务单状态更新',
      content: `${bookingNoticePurpose(booking)}的${order.title}已更新为 ${next.status}。`,
      timestamp: new Date().toISOString(), isRead: false, type: (next.status === 'EXCEPTION' ? 'WARNING' : 'INFO') as 'WARNING' | 'INFO'
    })), ...(db.notifications || [])].slice(0, 1000);
  }
  return next;
});

export const saveServiceArea = async (actor: User, input: any, editingId?: string) => mutateDb(async (db, { audit }) => {
  if (!canManageServiceOperations(actor)) throw new DbError('FORBIDDEN', 403);
  ensureServiceDomain(db);
  const current = editingId ? (db.serviceAreas || []).find(item => item.id === editingId) : undefined;
  if (editingId && !current) throw new DbError('SERVICE_AREA_NOT_FOUND', 404);
  if (!Array.isArray(input?.resourceIds)) throw new DbError('INVALID_SERVICE_AREA_RESOURCES', 400);
  const resourceIds = [...new Set(input.resourceIds.map((id: any) => text(id, 'INVALID_SERVICE_AREA_RESOURCES', 128)))];
  if (resourceIds.some(id => !(db.resources || []).some(resource => resource.id === id && resource.type === 'ROOM'))) {
    throw new DbError('INVALID_SERVICE_AREA_RESOURCES', 400);
  }
  const area: ServiceArea = {
    id: current?.id || `area-${crypto.randomUUID()}`,
    name: text(input.name, 'INVALID_SERVICE_AREA_NAME', 100)!,
    campus: text(input.campus, 'INVALID_SERVICE_AREA_CAMPUS', 100, false),
    building: input.building || undefined,
    resourceIds: resourceIds as string[]
  };
  if (area.building && !['MAIN', 'ANNEX'].includes(area.building)) throw new DbError('INVALID_SERVICE_AREA_BUILDING', 400);
  db.serviceAreas = current ? (db.serviceAreas || []).map(item => item.id === area.id ? area : item) : [...(db.serviceAreas || []), area];
  if (area.id !== 'area-default') {
    db.serviceAreas = db.serviceAreas.map(item => item.id === 'area-default'
      ? { ...item, resourceIds: item.resourceIds.filter(id => !area.resourceIds.includes(id)) }
      : item);
  }
  await audit({ actorId: actor.id, action: 'SERVICE_AREA_SAVE', entityType: 'SERVICE_AREA', entityId: area.id, details: { resourceIds: area.resourceIds } });
  return area;
});

export const saveServiceShift = async (actor: User, input: any) => mutateDb(async (db, { audit }) => {
  if (!canManageServiceOperations(actor)) throw new DbError('FORBIDDEN', 403);
  ensureServiceDomain(db);
  if (!(db.serviceAreas || []).some(area => area.id === input?.areaId)) throw new DbError('SERVICE_AREA_NOT_FOUND', 404);
  const assignee = (db.users || []).find(user => user.id === input?.assigneeId);
  if (!assignee || (!assignee.role.includes('SERVICE_COORDINATOR') && !assignee.role.includes('FRONT_DESK') && !assignee.role.includes('SYSTEM_ADMIN'))) {
    throw new DbError('INVALID_SERVICE_ASSIGNEE', 400);
  }
  if (!Number.isFinite(Date.parse(input?.startsAt)) || !Number.isFinite(Date.parse(input?.endsAt)) || Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
    throw new DbError('INVALID_SERVICE_SHIFT_TIME', 400);
  }
  const shift: ServiceShift = {
    id: `shift-${crypto.randomUUID()}`, areaId: input.areaId, assigneeId: assignee.id,
    startsAt: new Date(input.startsAt).toISOString(), endsAt: new Date(input.endsAt).toISOString(),
    createdAt: new Date().toISOString(), createdBy: actor.id
  };
  db.serviceShifts = [shift, ...(db.serviceShifts || [])];
  await audit({ actorId: actor.id, action: 'SERVICE_SHIFT_CREATE', entityType: 'SERVICE_SHIFT', entityId: shift.id, details: { areaId: shift.areaId, assigneeId: shift.assigneeId } });
  return shift;
});

export const updateServiceInspection = async (actor: User, inspectionId: string, input: any) => mutateDb(async (db, { audit }) => {
  if (!canManageServiceOperations(actor)) throw new DbError('FORBIDDEN', 403);
  ensureServiceDomain(db);
  const inspection = (db.serviceInspections || []).find(item => item.id === inspectionId);
  if (!inspection) throw new DbError('SERVICE_INSPECTION_NOT_FOUND', 404);
  if (inspection.status !== 'PENDING' || !['DONE', 'EXCEPTION'].includes(input?.status)) throw new DbError('INVALID_INSPECTION_TRANSITION', 409);
  const note = text(input.note, 'INSPECTION_NOTE_REQUIRED', 1000, input.status === 'EXCEPTION');
  const next: ServiceInspection = { ...inspection, status: input.status, completedAt: new Date().toISOString(), completedBy: actor.id, note };
  db.serviceInspections = (db.serviceInspections || []).map(item => item.id === inspection.id ? next : item);
  await audit({ actorId: actor.id, action: 'SERVICE_INSPECTION_UPDATE', entityType: 'SERVICE_INSPECTION', entityId: inspection.id, details: { status: next.status, areaId: inspection.areaId } });
  return next;
});

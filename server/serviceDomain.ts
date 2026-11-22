import type {
  Booking,
  BookingServiceRequirement,
  Resource,
  ServiceArea,
  ServiceCatalogItem,
  ServiceCatalogSnapshot,
  User,
  WorkOrder
} from '../types.ts';
import { DEFAULT_HEAVY_SERVICE_TYPES, DEFAULT_SERVICE_CATALOG } from '../constants.ts';
import type { OfficeDb } from './tools.ts';
import { DbError } from './errors.ts';
import { bookingNoticePurpose } from './confidentiality.ts';
import type { AuditInput } from './audit.ts';
import type { JobInstruction } from './jobStore.ts';

type ServiceMutationContext = {
  scheduleJob: (job: JobInstruction) => Promise<void>;
  audit: (input: AuditInput) => Promise<void>;
};

export const ensureServiceDomain = (db: OfficeDb) => {
  if (!db.serviceCatalog) db.serviceCatalog = [];
  for (const item of DEFAULT_SERVICE_CATALOG) {
    if (!db.serviceCatalog.some(existing => existing.type === item.type)) db.serviceCatalog.push(structuredClone(item));
  }
  if (!db.serviceAreas) db.serviceAreas = [];
  if (!db.serviceShifts) db.serviceShifts = [];
  if (!db.serviceInspections) db.serviceInspections = [];
  if (!db.checkInEvents) db.checkInEvents = [];
  if (!db.usageFacts) db.usageFacts = [];
  if (!db.usageAppeals) db.usageAppeals = [];
  const resourceIds = (db.resources || []).filter(resource => resource.type === 'ROOM').map(resource => resource.id);
  if (!db.serviceAreas.length && resourceIds.length) {
    db.serviceAreas.push({ id: 'area-default', name: '默认会务责任区', resourceIds });
  }
  for (const area of db.serviceAreas) {
    if (area.id === 'area-default') area.resourceIds = resourceIds;
  }
  db.workOrders = (db.workOrders || []).map(order => {
    const booking = (db.bookings || []).find(item => item.id === order.bookingId);
    const resource = (db.resources || []).find(item => item.id === booking?.resourceId);
    const requirement = order.requirementSnapshot || booking?.serviceRequirements?.find(item => item.type === order.type) || { type: order.type };
    const sla = requirement.catalogSnapshot?.slaResponseMinutes
      || (db.serviceCatalog || []).find(item => item.type === order.type)?.slaResponseMinutes || 10;
    return {
      ...order,
      scheduleVersion: order.scheduleVersion || booking?.scheduleVersion || 1,
      requirementSnapshot: requirement,
      fieldValues: order.fieldValues || requirement.fieldValues || {},
      areaId: order.areaId || serviceAreaForResource(db, resource)?.id,
      responseDueAt: order.responseDueAt || new Date(Date.parse(order.createdAt) + sla * 60000).toISOString(),
      statusHistory: order.statusHistory?.length ? order.statusHistory : [{ to: order.status, at: order.createdAt }]
    };
  });
};

export const serviceAreaForResource = (db: OfficeDb, resource?: Resource): ServiceArea | undefined =>
  (db.serviceAreas || []).find(area => resource && area.resourceIds.includes(resource.id))
  || (db.serviceAreas || []).find(area => resource?.campus && area.campus === resource.campus)
  || (db.serviceAreas || []).find(area => resource?.building && area.building === resource.building)
  || db.serviceAreas?.[0];

const catalogSnapshot = (item: ServiceCatalogItem): ServiceCatalogSnapshot => ({
  catalogItemId: item.id,
  catalogVersion: item.version,
  name: item.name,
  fields: structuredClone(item.fields),
  responsibleRole: item.responsibleRole,
  slaResponseMinutes: item.slaResponseMinutes,
  heavyService: item.heavyService,
  cancellable: item.cancellable
});

export const freezeServiceRequirements = (
  db: OfficeDb,
  requirements: BookingServiceRequirement[],
  resource: Resource
): BookingServiceRequirement[] => {
  ensureServiceDomain(db);
  return requirements.map(requirement => {
    const catalog = (db.serviceCatalog || []).find(item => item.type === requirement.type);
    if (!catalog) throw new DbError('SERVICE_CATALOG_ITEM_NOT_FOUND', 409);
    if (!catalog.resourceTypes.includes(resource.type)
      || (catalog.roomCategories?.length && (!resource.roomCategory || !catalog.roomCategories.includes(resource.roomCategory)))) {
      throw new DbError('SERVICE_NOT_AVAILABLE_FOR_RESOURCE', 409);
    }
    const supplied = { ...(requirement.fieldValues || {}) };
    if (requirement.details && !supplied.notes) supplied.notes = requirement.details;
    const fieldValues: Record<string, string> = {};
    for (const field of catalog.fields) {
      const value = String(supplied[field.key] ?? '').trim();
      if (value.length > 500) throw new DbError('INVALID_SERVICE_FIELD_VALUE', 400);
      if (field.required && !value) throw new DbError('SERVICE_FIELD_REQUIRED', 400, { type: requirement.type, field: field.key });
      if (value && field.type === 'NUMBER' && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
        throw new DbError('INVALID_SERVICE_FIELD_VALUE', 400, { type: requirement.type, field: field.key });
      }
      if (value && field.type === 'SELECT' && !field.options?.includes(value)) {
        throw new DbError('INVALID_SERVICE_FIELD_VALUE', 400, { type: requirement.type, field: field.key });
      }
      if (value) fieldValues[field.key] = value;
    }
    return {
      type: requirement.type,
      details: requirement.details?.trim() || fieldValues.notes,
      fieldValues,
      catalogSnapshot: catalogSnapshot(catalog)
    };
  });
};

export const isHeavyServiceBooking = (booking: Booking, resource?: Resource) =>
  resource?.roomCategory === 'AUDITORIUM'
  || Boolean(booking.auditoriumSetup?.stageRequired || (booking.auditoriumSetup?.rehearsalMinutes || 0) > 0)
  || (booking.serviceRequirements || []).some(requirement => requirement.catalogSnapshot
    ? requirement.catalogSnapshot.heavyService : DEFAULT_HEAVY_SERVICE_TYPES.includes(requirement.type));

export const cancellationCutoffMinutes = (booking: Booking, resource: Resource | undefined, settings: {
  standardCancellationCutoffMinutes: number;
  servicedCancellationCutoffMinutes: number;
}) => isHeavyServiceBooking(booking, resource)
  ? settings.servicedCancellationCutoffMinutes
  : settings.standardCancellationCutoffMinutes;

export const assertCancellationAuthorized = (
  booking: Booking,
  resource: Resource | undefined,
  settings: { standardCancellationCutoffMinutes: number; servicedCancellationCutoffMinutes: number },
  actor: User,
  now = Date.now()
) => {
  const cutoff = cancellationCutoffMinutes(booking, resource, settings);
  const withinCutoff = now <= Date.parse(booking.startTime) - cutoff * 60000;
  const authorized = actor.role.includes('SYSTEM_ADMIN') || actor.role.includes('APPROVAL_ADMIN');
  if (!withinCutoff && !authorized) {
    throw new DbError('CANCELLATION_AUTHORIZATION_REQUIRED', 403, { cutoffMinutes: cutoff });
  }
  return { cutoffMinutes: cutoff, authorizedLateCancel: !withinCutoff };
};

const approvedAt = (booking: Booking) => booking.approvalHistory.at(-1)?.timestamp
  || booking.approvalSubmittedAt || booking.createdAt;

export const createBookingWorkOrders = async (
  db: OfficeDb,
  booking: Booking,
  context: ServiceMutationContext
): Promise<WorkOrder[]> => {
  ensureServiceDomain(db);
  const resource = (db.resources || []).find(item => item.id === booking.resourceId);
  const scheduleVersion = booking.scheduleVersion || 1;
  const requirements = booking.serviceRequirements?.length
    ? booking.serviceRequirements
    : [
        ...(booking.needsTeaService ? [{ type: 'TEA' as const }] : []),
        ...(booking.isVideoConference ? [{ type: 'VIDEO' as const }] : [])
      ];
  const frozen = resource ? freezeServiceRequirements(db, requirements, resource) : requirements;
  const created: WorkOrder[] = [];
  for (const requirement of frozen) {
    const snapshot = requirement.catalogSnapshot || (db.serviceCatalog || []).find(item => item.type === requirement.type);
    if (!snapshot) continue;
    const id = `wo-${booking.id}-v${scheduleVersion}-${requirement.type}`;
    if ((db.workOrders || []).some(order => order.id === id
      || (order.bookingId === booking.id && order.type === requirement.type && (order.scheduleVersion || 1) === scheduleVersion))) continue;
    const createdAt = approvedAt(booking);
    const responsibleRole = snapshot.responsibleRole;
    const slaResponseMinutes = snapshot.slaResponseMinutes;
    const order: WorkOrder = {
      id,
      bookingId: booking.id,
      type: requirement.type,
      title: `${bookingNoticePurpose(booking)}${snapshot.name}`,
      assigneeRole: responsibleRole,
      status: 'TODO',
      createdAt,
      scheduleVersion,
      requirementSnapshot: structuredClone(requirement),
      fieldValues: structuredClone(requirement.fieldValues || {}),
      areaId: serviceAreaForResource(db, resource)?.id,
      responseDueAt: new Date(Date.parse(createdAt) + slaResponseMinutes * 60000).toISOString(),
      statusHistory: [{ to: 'TODO', at: createdAt, reason: '预约核准后生成服务单' }]
    };
    created.push(order);
    await context.scheduleJob({
      key: `service-sla:${order.id}`,
      type: 'SERVICE_SLA_ESCALATION',
      runAt: new Date(order.responseDueAt!),
      payload: { bookingId: booking.id, workOrderId: order.id, scheduleVersion }
    });
    await context.audit({
      action: 'WORK_ORDER_AUTO_CREATE', entityType: 'WORK_ORDER', entityId: order.id,
      details: { bookingId: booking.id, type: order.type, scheduleVersion, catalogVersion: requirement.catalogSnapshot?.catalogVersion }
    });
  }
  if (created.length) db.workOrders = [...created, ...(db.workOrders || [])];
  return created;
};

export const syncWorkOrdersForBookingChange = (
  db: OfficeDb,
  booking: Booking,
  reason: string,
  actorId?: string,
  at = new Date().toISOString()
) => {
  db.workOrders = (db.workOrders || []).map(order => {
    if (order.bookingId !== booking.id || ['DONE', 'CANCELLED', 'EXCEPTION'].includes(order.status)) return order;
    const started = order.status === 'IN_PROGRESS' || Boolean(order.startedAt);
    const cancellable = order.requirementSnapshot?.catalogSnapshot?.cancellable !== false;
    if (!started && cancellable) {
      return {
        ...order,
        status: 'CANCELLED' as const,
        cancelledAt: at,
        cancellationReason: reason,
        statusHistory: [...(order.statusHistory || []), { from: order.status, to: 'CANCELLED' as const, actorId, at, reason }]
      };
    }
    return {
      ...order,
      status: 'EXCEPTION' as const,
      exceptionReason: `${reason}；服务已执行或不可撤销，保留执行结果与成本。`,
      statusHistory: [...(order.statusHistory || []), { from: order.status, to: 'EXCEPTION' as const, actorId, at, reason }]
    };
  });
};

export const canManageServiceOperations = (actor: User) =>
  actor.role.includes('SYSTEM_ADMIN') || actor.role.includes('SERVICE_COORDINATOR') || actor.role.includes('FRONT_DESK');

export const canManageWorkOrder = (actor: User, order: WorkOrder) =>
  actor.role.includes('SYSTEM_ADMIN') || actor.role.includes(order.assigneeRole);

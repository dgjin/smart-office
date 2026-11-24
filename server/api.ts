import type { IncomingMessage, ServerResponse } from 'node:http';
import { databaseHealth, DbError, deleteResource, readDb, saveBookings, saveResource } from './db.ts';
import { HttpError, readBody, readJson, send, setSecurityHeaders, validateWriteRequest } from './http.ts';
import { handleAgentChat, handleAgentStatus } from './agent.ts';
import { listNotifications, markNotificationsRead } from './notifications.ts';
import { buildTodos } from './tools.ts';
import { executeAgentAction } from './actions.ts';
import { actorFromRequest } from './auth/sessions.ts';
import { handleAuthRequest } from './auth/routes.ts';
import { getPreferences, updatePreferences } from './preferences.ts';
import { getChatConversation, saveChatConversation } from './chatConversations.ts';
import { getWorkspace, recordConfidentialBookingRead } from './workspace.ts';
import {
  createBackup, createConfidentialityAuthorization, deleteApprovalDelegate, deleteConfidentialWhitelistEntry, deleteDepartment, deleteUser,
  getRuleConfiguration, importRecords, restoreBackup, saveApprovalDelegate, saveApprovalRuleSet, saveConfidentialWhitelistEntry, saveDepartment, saveRole,
  saveRuleSettings, saveUser, saveWorkflow
} from './admin.ts';
import { importResourceLedger, preflightResourceImport } from './resourceLedger.ts';
import { listAuditEvents, recordAudit } from './audit.ts';
import { exportBookingIcs } from './calendarExport.ts';
import { getActorDbView } from './confidentiality.ts';
import type { User } from '../types.ts';
import { logEvent, observeRequest, requestIdFor } from './observability.ts';
import { saveServiceArea, saveServiceCatalogItem, saveServiceShift, transitionWorkOrder, updateServiceInspection } from './serviceOperations.ts';
import { checkInBooking, completeBookingEarly, confirmBookingUsage, createUsageAppeal, releaseBookingByActor, resolveUsageAppeal } from './usageOperations.ts';
import { actOnException, getDashboard, getExceptionCenter } from './operations.ts';
import { createDevice, getDeviceSnapshot, heartbeatDevice, listDevices, restartDevice, revokeDevice, rotateDevice } from './devices.ts';
import { getOperationsReport, operationsReportCsv, writeOperationsReportXlsx } from './reports.ts';
import { applyOrganizationSync, listOrganizationSyncBatches, previewOrganizationSync } from './organizationSync.ts';
import { handleOaCallback } from './oaCallbacks.ts';
import { getIntegrationOperations, reconcileIntegrations, recordIntegrationCompensation, replayIntegrationEvent } from './integrationOperations.ts';
import {
  exportHq3dLayout,
  importHq3dLayout,
  preflightHq3dLayoutImport
} from './hq3dLayoutImport.ts';
import { createHq3dLayoutExcel } from './hq3dLayoutExcel.ts';
import { parseHq3dLayoutUpload } from './hq3dLayoutFiles.ts';
import {
  addHq3dMaintenance,
  deleteHq3dMaintenance,
  getHq3dSnapshot,
  resetHq3dRoomProfile,
  saveHq3dRoomProfile,
  setHq3dFloorArea,
  updateHq3dMaintenanceStatus
} from './hq3d.ts';
import { handleMonitoringEvents, handleMonitoringSnapshot } from './monitoring.ts';
import { publishMonitoringChange } from './monitoringEvents.ts';

const requireAdmin = (actor: User) => {
  if (!actor.role.includes('SYSTEM_ADMIN')) throw new HttpError(403, 'FORBIDDEN');
};

const requireConfidentialityManager = (actor: User) => {
  if (!actor.role.includes('SYSTEM_ADMIN') && !actor.role.includes('SECURITY_ADMIN')) throw new HttpError(403, 'FORBIDDEN');
};

// 楼层图的房间资料（人名、部门、面积）属于空间台账，普通员工只读；
// 改台账的权限收在管理员与行政/前台运营角色上。
const SPACE_EDITOR_ROLES = ['SYSTEM_ADMIN', 'SERVICE_COORDINATOR', 'FRONT_DESK'];
const requireSpaceEditor = (actor: User) => {
  if (!actor.role.some(role => SPACE_EDITOR_ROLES.includes(role))) throw new HttpError(403, 'FORBIDDEN');
};

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/')) return false;
  setSecurityHeaders(res);
  observeRequest(req, res, url.pathname);
  try {
    if (url.pathname === '/api/integrations/oa/callback' && req.method === 'POST') {
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED');
      const raw = await readBody(req, 64 * 1024);
      send(res, 200, await handleOaCallback(raw, req.headers['x-smart-office-signature']));
      return true;
    }
    if (url.pathname === '/api/device/snapshot' && req.method === 'GET') {
      send(res, 200, await getDeviceSnapshot(req));
      return true;
    }
    if (url.pathname === '/api/device/heartbeat' && req.method === 'POST') {
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED');
      send(res, 200, await heartbeatDevice(req, await readJson(req, 16 * 1024)));
      return true;
    }
    validateWriteRequest(req);
    if (await handleAuthRequest(req, res, url)) return true;

    const actor = await actorFromRequest(req);
    if (!actor) {
      send(res, 401, { error: 'UNAUTHENTICATED' });
      return true;
    }

    if (url.pathname === '/api/health/database' && req.method === 'GET') {
      send(res, 200, await databaseHealth());
      return true;
    }
    if (url.pathname === '/api/workspace' && req.method === 'GET') {
      send(res, 200, await getWorkspace(actor));
      return true;
    }
    if (url.pathname === '/api/monitoring/snapshot' && req.method === 'GET') {
      await handleMonitoringSnapshot(res, actor);
      return true;
    }
    if (url.pathname === '/api/monitoring/events' && req.method === 'GET') {
      await handleMonitoringEvents(req, res, actor);
      return true;
    }
    if (url.pathname === '/api/dashboard' && req.method === 'GET') {
      send(res, 200, await getDashboard(actor));
      return true;
    }
    if (url.pathname === '/api/exceptions' && req.method === 'GET') {
      send(res, 200, await getExceptionCenter(actor));
      return true;
    }
    const exceptionMatch = url.pathname.match(/^\/api\/exceptions\/([^/]+)$/);
    if (exceptionMatch && req.method === 'POST') {
      send(res, 200, { exception: await actOnException(actor, decodeURIComponent(exceptionMatch[1]), await readJson(req)) });
      return true;
    }
    if (url.pathname === '/api/integrations' && req.method === 'GET') {
      send(res, 200, await getIntegrationOperations(actor));
      return true;
    }
    if (url.pathname === '/api/integrations/reconcile' && req.method === 'POST') {
      await readJson(req);
      send(res, 200, await reconcileIntegrations(actor));
      return true;
    }
    if (url.pathname === '/api/integrations/replay' && req.method === 'POST') {
      const { eventKey } = await readJson(req);
      send(res, 200, await replayIntegrationEvent(actor, String(eventKey || '')));
      return true;
    }
    if (url.pathname === '/api/integrations/compensations' && req.method === 'POST') {
      send(res, 201, { compensation: await recordIntegrationCompensation(actor, await readJson(req)) });
      return true;
    }
    if (url.pathname === '/api/reports' && req.method === 'GET') {
      requireAdmin(actor);
      send(res, 200, await getOperationsReport(actor, url.searchParams.get('start') || '', url.searchParams.get('end') || ''));
      return true;
    }
    if (url.pathname === '/api/reports/export' && req.method === 'GET') {
      requireAdmin(actor);
      const format = url.searchParams.get('format') || 'csv';
      if (!['csv', 'xlsx'].includes(format)) throw new HttpError(400, 'INVALID_REPORT_FORMAT');
      const revisionValue = url.searchParams.get('revision');
      const expectedRevision = Number(revisionValue);
      if (!revisionValue || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new HttpError(400, 'REPORT_REVISION_REQUIRED');
      const report = await getOperationsReport(actor, url.searchParams.get('start') || '', url.searchParams.get('end') || '');
      if (report.revision !== expectedRevision) throw new HttpError(409, 'REPORT_SNAPSHOT_CHANGED');
      const filename = `smart-office-report-${report.start.slice(0, 10)}.${format}`;
      res.statusCode = 200;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      if (format === 'xlsx') {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        await writeOperationsReportXlsx(report, res);
      } else {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.end(operationsReportCsv(report));
      }
      return true;
    }
    if (url.pathname === '/api/devices' && req.method === 'GET') {
      requireAdmin(actor);
      send(res, 200, { devices: await listDevices() });
      return true;
    }
    if (url.pathname === '/api/devices' && req.method === 'POST') {
      requireAdmin(actor);
      send(res, 201, await createDevice(actor, await readJson(req)));
      return true;
    }
    const deviceMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/(rotate|restart|revoke)$/);
    if (deviceMatch && req.method === 'POST') {
      requireAdmin(actor);
      const id = decodeURIComponent(deviceMatch[1]);
      await readJson(req);
      const device = deviceMatch[2] === 'rotate' ? await rotateDevice(actor, id)
        : deviceMatch[2] === 'restart' ? { device: await restartDevice(actor, id) }
          : { device: await revokeDevice(actor, id) };
      send(res, 200, device);
      return true;
    }
    if (url.pathname === '/api/users' && req.method === 'POST') {
      requireAdmin(actor);
      const { user } = await readJson(req);
      send(res, 201, { user: await saveUser(user, actor.id), workspace: await getWorkspace(actor) });
      return true;
    }
    const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && ['PUT', 'DELETE'].includes(req.method || '')) {
      requireAdmin(actor);
      const id = decodeURIComponent(userMatch[1]);
      const result = req.method === 'PUT'
        ? { user: await saveUser((await readJson(req)).user, actor.id, id) }
        : await deleteUser(id, actor.id);
      send(res, 200, { ...result, workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/roles' && req.method === 'POST') {
      requireAdmin(actor);
      const { role } = await readJson(req);
      send(res, 201, { role: await saveRole(role, actor.id), workspace: await getWorkspace(actor) });
      return true;
    }
    const roleMatch = url.pathname.match(/^\/api\/roles\/([^/]+)$/);
    if (roleMatch && req.method === 'PUT') {
      requireAdmin(actor);
      const { role } = await readJson(req);
      send(res, 200, { role: await saveRole(role, actor.id, decodeURIComponent(roleMatch[1])), workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/departments' && req.method === 'POST') {
      requireAdmin(actor);
      const { department } = await readJson(req);
      send(res, 201, { department: await saveDepartment(department, actor.id), workspace: await getWorkspace(actor) });
      return true;
    }
    const departmentMatch = url.pathname.match(/^\/api\/departments\/([^/]+)$/);
    if (departmentMatch && ['PUT', 'DELETE'].includes(req.method || '')) {
      requireAdmin(actor);
      const id = decodeURIComponent(departmentMatch[1]);
      const result = req.method === 'PUT'
        ? { department: await saveDepartment((await readJson(req)).department, actor.id, id) }
        : await deleteDepartment(id, actor.id);
      send(res, 200, { ...result, workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/organization-sync' && req.method === 'GET') {
      requireAdmin(actor);
      send(res, 200, { batches: await listOrganizationSyncBatches() });
      return true;
    }
    if (url.pathname === '/api/organization-sync/preview' && req.method === 'POST') {
      requireAdmin(actor);
      send(res, 201, { batch: await previewOrganizationSync(await readJson(req, 5 * 1024 * 1024), actor.id) });
      return true;
    }
    if (url.pathname === '/api/organization-sync/apply' && req.method === 'POST') {
      requireAdmin(actor);
      const { batchId } = await readJson(req);
      if (typeof batchId !== 'string' || !batchId) throw new HttpError(400, 'INVALID_ORGANIZATION_SYNC_BATCH');
      send(res, 200, await applyOrganizationSync(batchId, actor.id));
      return true;
    }
    if (url.pathname === '/api/workflow' && req.method === 'PUT') {
      requireAdmin(actor);
      const { workflow } = await readJson(req);
      send(res, 200, { workflow: await saveWorkflow(workflow, actor.id), workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/approval-rule-set' && req.method === 'PUT') {
      requireAdmin(actor);
      const ruleSet = await saveApprovalRuleSet(await readJson(req), actor.id);
      send(res, 200, { ruleSet, workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/approval-delegates' && req.method === 'POST') {
      requireAdmin(actor);
      const { delegate } = await readJson(req);
      send(res, 201, { delegate: await saveApprovalDelegate(delegate, actor.id), workspace: await getWorkspace(actor) });
      return true;
    }
    const delegateMatch = url.pathname.match(/^\/api\/approval-delegates\/([^/]+)$/);
    if (delegateMatch && req.method === 'DELETE') {
      requireAdmin(actor);
      const result = await deleteApprovalDelegate(decodeURIComponent(delegateMatch[1]), actor.id);
      send(res, 200, { ...result, workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/audit' && req.method === 'GET') {
      requireAdmin(actor);
      send(res, 200, { events: await listAuditEvents({
        actorId: url.searchParams.get('actorId') || undefined,
        action: url.searchParams.get('action') || undefined,
        entityType: url.searchParams.get('entityType') || undefined,
        entityId: url.searchParams.get('entityId') || undefined,
        start: url.searchParams.get('start') || undefined,
        end: url.searchParams.get('end') || undefined,
        limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined
      }) });
      return true;
    }
    if (url.pathname === '/api/rules' && req.method === 'GET') {
      requireAdmin(actor);
      send(res, 200, await getRuleConfiguration());
      return true;
    }
    if (url.pathname === '/api/rules' && req.method === 'PUT') {
      requireAdmin(actor);
      const { settings } = await readJson(req);
      send(res, 200, { ruleVersion: await saveRuleSettings(settings, actor.id), workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/resources/ledger/preflight' && req.method === 'POST') {
      requireAdmin(actor);
      const { items } = await readJson(req, 2 * 1024 * 1024);
      send(res, 200, { report: await preflightResourceImport(items) });
      return true;
    }
    if (url.pathname === '/api/resources/ledger/import' && req.method === 'POST') {
      requireAdmin(actor);
      const { items } = await readJson(req, 2 * 1024 * 1024);
      const result = await importResourceLedger(items, actor.id);
      send(res, 201, { ...result, workspace: await getWorkspace(actor) });
      return true;
    }
    const importMatch = url.pathname.match(/^\/api\/imports\/(USERS|RESOURCES|DEPARTMENTS)$/);
    if (importMatch && req.method === 'POST') {
      requireAdmin(actor);
      const { items } = await readJson(req, 2 * 1024 * 1024);
      send(res, 201, { items: await importRecords(importMatch[1], items, actor.id), workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/backup' && req.method === 'GET') {
      requireAdmin(actor);
      const backup = await createBackup();
      await recordAudit({ actorId: actor.id, action: 'BACKUP_EXPORT', entityType: 'BACKUP', entityId: String(backup.revision) });
      send(res, 200, backup);
      return true;
    }
    if (url.pathname === '/api/backup/restore' && req.method === 'POST') {
      requireAdmin(actor);
      const result = await restoreBackup(await readJson(req, 5 * 1024 * 1024), actor.id);
      send(res, 200, { ...result, workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/preferences' && req.method === 'GET') {
      send(res, 200, await getPreferences(actor.id));
      return true;
    }
    if (url.pathname === '/api/preferences' && req.method === 'PUT') {
      send(res, 200, await updatePreferences(actor.id, await readJson(req)));
      return true;
    }

    /* ---------- 总部楼层 3D 分布图 ----------
       读：一次拿全量快照（2 栋 24 层 427 间，约 200KB），比按层轮询省往返。
       写：房间资料、维护记录、楼层面积分开三组，
            各走自己的表与事务，不碰 bookings/resources 的乐观锁。 */
    if (url.pathname === '/api/hq3d/snapshot' && req.method === 'GET') {
      const snapshot = await getHq3dSnapshot();
      send(res, 200, { ...snapshot, capabilities: { canManageLayout: actor.role.includes('SYSTEM_ADMIN') } });
      return true;
    }
    if (url.pathname === '/api/hq3d/rooms' && req.method === 'GET') {
      const snapshot = await getHq3dSnapshot();
      send(res, 200, { ...snapshot, capabilities: { canManageLayout: actor.role.includes('SYSTEM_ADMIN') } });
      return true;
    }
    if (url.pathname === '/api/hq3d/layout/export' && req.method === 'GET') {
      requireAdmin(actor);
      const floorNoValue = url.searchParams.get('floorNo');
      const document = await exportHq3dLayout({
        kind: url.searchParams.get('scope'),
        buildingId: url.searchParams.get('buildingId'),
        floorNo: floorNoValue === null ? undefined : Number(floorNoValue)
      });
      if (url.searchParams.get('format') === 'xlsx') {
        const buffer = await createHq3dLayoutExcel(document);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="hq3d-layout.xlsx"');
        res.setHeader('Content-Length', String(buffer.length));
        res.setHeader('Cache-Control', 'no-store');
        res.end(buffer);
      } else {
        send(res, 200, document);
      }
      return true;
    }
    if (url.pathname === '/api/hq3d/layout/parse' && req.method === 'POST') {
      requireAdmin(actor);
      const { fileName, contentBase64, scope } = await readJson(req, 12 * 1024 * 1024);
      send(res, 200, await parseHq3dLayoutUpload({ fileName, contentBase64, scope }));
      return true;
    }
    if (url.pathname === '/api/hq3d/layout/preflight' && req.method === 'POST') {
      requireAdmin(actor);
      const { layout } = await readJson(req, 2 * 1024 * 1024);
      send(res, 200, { report: await preflightHq3dLayoutImport(layout) });
      return true;
    }
    if (url.pathname === '/api/hq3d/layout/import' && req.method === 'POST') {
      requireAdmin(actor);
      const { layout, baselineHash } = await readJson(req, 2 * 1024 * 1024);
      const report = await importHq3dLayout(actor.id, layout, baselineHash);
      publishMonitoringChange('hq3d');
      send(res, 200, { report });
      return true;
    }
    const hqRoomMatch = url.pathname.match(/^\/api\/hq3d\/rooms\/([^/]+)$/);
    if (hqRoomMatch && req.method === 'PUT') {
      requireSpaceEditor(actor);
      const uid = decodeURIComponent(hqRoomMatch[1]);
      const { profile } = await readJson(req);
      const saved = await saveHq3dRoomProfile(actor, uid, profile || {});
      publishMonitoringChange('hq3d');
      send(res, 200, { profile: saved });
      return true;
    }
    if (hqRoomMatch && req.method === 'DELETE') {
      requireSpaceEditor(actor);
      const uid = decodeURIComponent(hqRoomMatch[1]);
      await resetHq3dRoomProfile(actor, uid);
      publishMonitoringChange('hq3d');
      send(res, 200, { reset: true });
      return true;
    }
    const hqMaintenanceMatch = url.pathname.match(/^\/api\/hq3d\/rooms\/([^/]+)\/maintenance$/);
    if (hqMaintenanceMatch && req.method === 'POST') {
      requireSpaceEditor(actor);
      const uid = decodeURIComponent(hqMaintenanceMatch[1]);
      const { record } = await readJson(req);
      const saved = await addHq3dMaintenance(actor, uid, record || {});
      publishMonitoringChange('hq3d');
      send(res, 201, { record: saved });
      return true;
    }
    const hqMaintenanceItemMatch = url.pathname.match(/^\/api\/hq3d\/maintenance\/([^/]+)$/);
    if (hqMaintenanceItemMatch && req.method === 'PATCH') {
      requireSpaceEditor(actor);
      const id = decodeURIComponent(hqMaintenanceItemMatch[1]);
      const { status } = await readJson(req);
      const record = await updateHq3dMaintenanceStatus(actor, id, status);
      publishMonitoringChange('hq3d');
      send(res, 200, { record });
      return true;
    }
    if (hqMaintenanceItemMatch && req.method === 'DELETE') {
      requireSpaceEditor(actor);
      await deleteHq3dMaintenance(actor, decodeURIComponent(hqMaintenanceItemMatch[1]));
      publishMonitoringChange('hq3d');
      send(res, 200, { deleted: true });
      return true;
    }
    const hqFloorMatch = url.pathname.match(/^\/api\/hq3d\/floors\/([^/]+)\/([^/]+)\/area$/);
    if (hqFloorMatch && req.method === 'PUT') {
      requireSpaceEditor(actor);
      const buildingId = decodeURIComponent(hqFloorMatch[1]);
      const floorTag = decodeURIComponent(hqFloorMatch[2]);
      const { areaTotal } = await readJson(req);
      send(res, 200, { areaTotal: await setHq3dFloorArea(actor, buildingId, floorTag, areaTotal) });
      return true;
    }
    if (url.pathname === '/api/resources' && req.method === 'POST') {
      requireAdmin(actor);
      const { resource } = await readJson(req);
      if (!resource?.id) throw new HttpError(400, 'INVALID_RESOURCE');
      const saved = await saveResource(resource, actor.id);
      send(res, 201, { resource: saved, workspace: await getWorkspace(actor) });
      return true;
    }
    const resourceEditMatch = url.pathname.match(/^\/api\/resources\/([^/]+)$/);
    if (resourceEditMatch && req.method === 'PUT') {
      requireAdmin(actor);
      const { resource } = await readJson(req);
      if (!resource) throw new HttpError(400, 'INVALID_RESOURCE');
      const id = decodeURIComponent(resourceEditMatch[1]);
      const saved = await saveResource(resource, actor.id, id);
      send(res, 200, { resource: saved, workspace: await getWorkspace(actor) });
      return true;
    }
    if (resourceEditMatch && req.method === 'DELETE') {
      requireAdmin(actor);
      await deleteResource(decodeURIComponent(resourceEditMatch[1]), actor.id);
      send(res, 200, { ok: true, workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/confidential-whitelist' && req.method === 'POST') {
      requireConfidentialityManager(actor);
      const { entry } = await readJson(req);
      send(res, 201, { entry: await saveConfidentialWhitelistEntry(entry, actor.id), workspace: await getWorkspace(actor) });
      return true;
    }
    const whitelistMatch = url.pathname.match(/^\/api\/confidential-whitelist\/([^/]+)$/);
    if (whitelistMatch && req.method === 'DELETE') {
      requireConfidentialityManager(actor);
      await deleteConfidentialWhitelistEntry(decodeURIComponent(whitelistMatch[1]), actor.id);
      send(res, 200, { ok: true, workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/bookings' && req.method === 'POST') {
      const { booking } = await readJson(req);
      if (!booking?.resourceId || !booking?.startTime || !booking?.endTime) throw new HttpError(400, 'INVALID_BOOKING');
      const saved = await saveBookings([booking], actor);
      send(res, 201, { booking: saved[0], workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/bookings/batch' && req.method === 'POST') {
      const { bookings } = await readJson(req);
      if (!Array.isArray(bookings) || bookings.length === 0 || bookings.some((booking: any) => !booking?.resourceId || !booking?.startTime || !booking?.endTime)) {
        throw new HttpError(400, 'INVALID_BOOKINGS');
      }
      const saved = await saveBookings(bookings, actor);
      send(res, 201, { bookings: saved, workspace: await getWorkspace(actor) });
      return true;
    }
    const confidentialReadMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/confidential-read$/);
    if (confidentialReadMatch && req.method === 'POST') {
      await readJson(req);
      send(res, 200, await recordConfidentialBookingRead(actor, decodeURIComponent(confidentialReadMatch[1])));
      return true;
    }
    const icsMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/ics$/);
    if (icsMatch && req.method === 'GET') {
      const result = await exportBookingIcs(actor, decodeURIComponent(icsMatch[1]));
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.end(result.ics);
      return true;
    }
    const confidentialityMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/confidential-authorizations$/);
    if (confidentialityMatch && req.method === 'POST') {
      requireConfidentialityManager(actor);
      const authorization = await createConfidentialityAuthorization(decodeURIComponent(confidentialityMatch[1]), await readJson(req), actor.id);
      send(res, 201, { authorization, workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/service-catalog' && req.method === 'POST') {
      requireAdmin(actor);
      const item = await saveServiceCatalogItem(await readJson(req), actor);
      send(res, 201, { item, workspace: await getWorkspace(actor) });
      return true;
    }
    const catalogMatch = url.pathname.match(/^\/api\/service-catalog\/([^/]+)$/);
    if (catalogMatch && req.method === 'PUT') {
      requireAdmin(actor);
      const item = await saveServiceCatalogItem(await readJson(req), actor, decodeURIComponent(catalogMatch[1]));
      send(res, 200, { item, workspace: await getWorkspace(actor) });
      return true;
    }
    const workOrderMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/transitions$/);
    if (workOrderMatch && req.method === 'POST') {
      const order = await transitionWorkOrder(actor, decodeURIComponent(workOrderMatch[1]), await readJson(req));
      send(res, 200, { order, workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/service-areas' && req.method === 'POST') {
      const area = await saveServiceArea(actor, await readJson(req));
      send(res, 201, { area, workspace: await getWorkspace(actor) });
      return true;
    }
    const areaMatch = url.pathname.match(/^\/api\/service-areas\/([^/]+)$/);
    if (areaMatch && req.method === 'PUT') {
      const area = await saveServiceArea(actor, await readJson(req), decodeURIComponent(areaMatch[1]));
      send(res, 200, { area, workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/service-shifts' && req.method === 'POST') {
      const shift = await saveServiceShift(actor, await readJson(req));
      send(res, 201, { shift, workspace: await getWorkspace(actor) });
      return true;
    }
    const inspectionMatch = url.pathname.match(/^\/api\/service-inspections\/([^/]+)$/);
    if (inspectionMatch && req.method === 'POST') {
      const inspection = await updateServiceInspection(actor, decodeURIComponent(inspectionMatch[1]), await readJson(req));
      send(res, 200, { inspection, workspace: await getWorkspace(actor) });
      return true;
    }
    const checkInMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/check-in$/);
    if (checkInMatch && req.method === 'POST') {
      const result = await checkInBooking(actor, decodeURIComponent(checkInMatch[1]), await readJson(req));
      send(res, 200, { ...result, workspace: await getWorkspace(actor) });
      return true;
    }
    const releaseMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/release$/);
    if (releaseMatch && req.method === 'POST') {
      const booking = await releaseBookingByActor(actor, decodeURIComponent(releaseMatch[1]), await readJson(req));
      send(res, 200, { booking, workspace: await getWorkspace(actor) });
      return true;
    }
    const usageConfirmationMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/usage-confirmation$/);
    if (usageConfirmationMatch && req.method === 'POST') {
      const booking = await confirmBookingUsage(actor, decodeURIComponent(usageConfirmationMatch[1]), await readJson(req));
      send(res, 200, { booking, workspace: await getWorkspace(actor) });
      return true;
    }
    const appealMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/usage-appeals$/);
    if (appealMatch && req.method === 'POST') {
      const appeal = await createUsageAppeal(actor, decodeURIComponent(appealMatch[1]), await readJson(req));
      send(res, 201, { appeal, workspace: await getWorkspace(actor) });
      return true;
    }
    const appealResolutionMatch = url.pathname.match(/^\/api\/usage-appeals\/([^/]+)$/);
    if (appealResolutionMatch && req.method === 'POST') {
      const result = await resolveUsageAppeal(actor, decodeURIComponent(appealResolutionMatch[1]), await readJson(req));
      send(res, 200, { ...result, workspace: await getWorkspace(actor) });
      return true;
    }
    const completeMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/complete$/);
    if (completeMatch && req.method === 'POST') {
      await readJson(req);
      const result = await completeBookingEarly(actor, decodeURIComponent(completeMatch[1]));
      send(res, 200, { ...result, workspace: await getWorkspace(actor) });
      return true;
    }
    const editMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)$/);
    if (editMatch && req.method === 'PUT') {
      const { booking } = await readJson(req);
      const id = decodeURIComponent(editMatch[1]);
      if (!booking?.resourceId || !booking?.startTime || !booking?.endTime) throw new HttpError(400, 'INVALID_BOOKING');
      const saved = await saveBookings([booking], actor, id);
      send(res, 200, { booking: saved[0], workspace: await getWorkspace(actor) });
      return true;
    }
    if (url.pathname === '/api/agent/conversation' && req.method === 'GET') {
      send(res, 200, await getChatConversation(actor.id));
      return true;
    }
    if (url.pathname === '/api/agent/conversation' && req.method === 'PUT') {
      send(res, 200, await saveChatConversation(actor.id, await readJson(req, 512 * 1024)));
      return true;
    }
    if (url.pathname === '/api/agent/status' && req.method === 'GET') {
      handleAgentStatus(req, res);
      return true;
    }
    if (url.pathname === '/api/agent/chat' && req.method === 'POST') {
      await handleAgentChat(req, res, actor);
      return true;
    }
    if (url.pathname === '/api/notifications' && req.method === 'GET') {
      send(res, 200, { notifications: await listNotifications(actor.id) });
      return true;
    }
    if (url.pathname === '/api/notifications' && req.method === 'PATCH') {
      const body = await readJson(req);
      if (!Array.isArray(body.ids) || body.ids.some((id: any) => typeof id !== 'string')) throw new HttpError(400, 'INVALID_REQUEST');
      send(res, 200, { changed: await markNotificationsRead(actor.id, body.ids) });
      return true;
    }
    if (url.pathname === '/api/todos' && req.method === 'GET') {
      const db = getActorDbView(await readDb(), actor);
      const todos = buildTodos(db, actor.id);
      send(res, 200, { total: todos.length, todos });
      return true;
    }
    if (url.pathname === '/api/agent/action' && req.method === 'POST') {
      const { action } = await readJson(req);
      if (!action?.type) throw new HttpError(400, 'INVALID_REQUEST');
      const result = await executeAgentAction(actor.id, action);
      send(res, 200, {
        ...result,
        notifications: await listNotifications(actor.id),
        workspace: await getWorkspace(actor)
      });
      return true;
    }
    send(res, 404, { error: 'NOT_FOUND' });
    return true;
  } catch (err: any) {
    if (res.writableEnded) return true;
    if (res.headersSent) {
      res.end();
      return true;
    }
    if (err instanceof DbError) {
      send(res, err.status, { error: err.message, conflicts: err.details });
      return true;
    }
    const status = err instanceof HttpError ? err.status : Number(err?.status) || 500;
    if (status >= 500) logEvent('error', 'api.failed', { requestId: requestIdFor(req), pathname: url.pathname, status, errorName: err?.name, code: err?.code });
    send(res, status, {
      error: err instanceof HttpError ? err.code : status === 500 ? 'INTERNAL' : err?.message || 'ACTION_FAILED',
      detail: status >= 400 && status < 500 ? String(err?.message || err) : undefined
    });
    return true;
  }
}

export function registerApi(middlewares: any) {
  middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const handled = await handleApiRequest(req, res, new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`));
    if (!handled) next();
  });
}

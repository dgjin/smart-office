import type { IncomingMessage, ServerResponse } from 'node:http';
import { databaseHealth, DbError, readDb, saveBookings, saveResource } from './db.ts';
import { HttpError, readJson, send, setSecurityHeaders, validateWriteRequest } from './http.ts';
import { handleAgentChat, handleAgentStatus } from './agent.ts';
import { listNotifications, markNotificationsRead } from './notifications.ts';
import { buildTodos } from './tools.ts';
import { completeBookingEarly, executeAgentAction } from './actions.ts';
import { actorFromRequest } from './auth/sessions.ts';
import { handleAuthRequest } from './auth/routes.ts';
import { getPreferences, updatePreferences } from './preferences.ts';
import { getChatConversation, saveChatConversation } from './chatConversations.ts';
import { getWorkspace } from './workspace.ts';
import {
  createBackup, deleteApprovalDelegate, deleteDepartment, deleteUser, importRecords, restoreBackup,
  saveApprovalDelegate, saveDepartment, saveRole, saveUser, saveWorkflow
} from './admin.ts';
import { listAuditEvents, recordAudit } from './audit.ts';
import type { User } from '../types.ts';
import { logEvent, observeRequest, requestIdFor } from './observability.ts';

const requireAdmin = (actor: User) => {
  if (!actor.role.includes('SYSTEM_ADMIN')) throw new HttpError(403, 'FORBIDDEN');
};

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/')) return false;
  setSecurityHeaders(res);
  observeRequest(req, res, url.pathname);
  try {
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
    if (url.pathname === '/api/workflow' && req.method === 'PUT') {
      requireAdmin(actor);
      const { workflow } = await readJson(req);
      send(res, 200, { workflow: await saveWorkflow(workflow, actor.id), workspace: await getWorkspace(actor) });
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
      send(res, 200, { events: await listAuditEvents(Number(url.searchParams.get('limit')) || 200) });
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
    const completeMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/complete$/);
    if (completeMatch && req.method === 'POST') {
      await readJson(req);
      const result = await completeBookingEarly(actor.id, decodeURIComponent(completeMatch[1]));
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
      const db = await readDb();
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

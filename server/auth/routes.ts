import type { IncomingMessage, ServerResponse } from 'node:http';
import { readDb } from '../db.ts';
import { send, setSecurityHeaders } from '../http.ts';
import { devAuthAllowed } from './dev.ts';
import { completeOidcLogin, createOidcAuthorizationUrl, safeReturnTo } from './oidc.ts';
import { actorFromRequest, createSession, revokeSession, sessionCookie } from './sessions.ts';
import { oidcConfig } from '../config.ts';
import { clientIp, enforceAuthRateLimit } from '../rateLimit.ts';
import { logEvent, requestIdFor } from '../observability.ts';

const AUTH_ROUTES = new Set([
  '/api/auth/options',
  '/api/auth/login',
  '/api/auth/callback',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/dev',
]);

const redirect = (res: ServerResponse, location: string, cookie?: string) => {
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
};

const methodNotAllowed = (res: ServerResponse, allowed: string) => {
  res.setHeader('Allow', allowed);
  send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
};

export const handleAuthRequest = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
  if (!AUTH_ROUTES.has(url.pathname)) return false;
  setSecurityHeaders(res);
  if (enforceAuthRateLimit(req, res, url.pathname)) return true;

  try {
    if (url.pathname === '/api/auth/options') {
      if (req.method !== 'GET') {
        methodNotAllowed(res, 'GET');
        return true;
      }
      const oidc = oidcConfig();
      const development = devAuthAllowed(req);
      const users = development ? ((await readDb()).users || []).filter(user => user.status !== 'DISABLED') : [];
      send(res, 200, {
        oidc: Boolean(oidc.issuer && oidc.clientId && oidc.redirectUri),
        development,
        users: users.map(({ id, name, department, role }) => ({ id, name, department, role }))
      });
      return true;
    }

    if (url.pathname === '/api/auth/login') {
      if (req.method !== 'GET') {
        methodNotAllowed(res, 'GET');
        return true;
      }
      const authorizationUrl = await createOidcAuthorizationUrl(url.searchParams.get('returnTo'));
      redirect(res, authorizationUrl);
      return true;
    }

    if (url.pathname === '/api/auth/callback') {
      if (req.method !== 'GET') {
        methodNotAllowed(res, 'GET');
        return true;
      }
      const result = await completeOidcLogin(url);
      const token = await createSession(result.userId);
      redirect(res, result.returnTo, sessionCookie(token));
      return true;
    }

    if (url.pathname === '/api/auth/me') {
      if (req.method !== 'GET') {
        methodNotAllowed(res, 'GET');
        return true;
      }
      const actor = await actorFromRequest(req);
      if (!actor) {
        send(res, 401, { error: 'UNAUTHENTICATED' });
        return true;
      }
      send(res, 200, { actor });
      return true;
    }

    if (url.pathname === '/api/auth/logout') {
      if (req.method !== 'POST') {
        methodNotAllowed(res, 'POST');
        return true;
      }
      res.setHeader('Set-Cookie', sessionCookie('', true));
      await revokeSession(req);
      send(res, 200, { ok: true });
      return true;
    }

    if (!devAuthAllowed(req)) {
      send(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    if (req.method !== 'GET') {
      methodNotAllowed(res, 'GET');
      return true;
    }
    const userId = url.searchParams.get('userId') || '';
    const db = await readDb();
    const actor = (db.users || []).find(user => user.id === userId && user.status !== 'DISABLED');
    if (!actor) throw new Error('DEV_AUTH_FAILED');
    safeReturnTo(url.searchParams.get('returnTo'));
    const token = await createSession(actor.id);
    res.setHeader('Set-Cookie', sessionCookie(token));
    send(res, 200, { actor });
    return true;
  } catch (error: any) {
    const status = error instanceof Error && error.message === 'INVALID_RETURN_TO'
      ? 400
      : ['/api/auth/callback', '/api/auth/dev'].includes(url.pathname) ? 401 : 500;
    logEvent(status >= 500 ? 'error' : 'warn', 'auth.failed', {
      requestId: requestIdFor(req), pathname: url.pathname, clientIp: clientIp(req), status, errorName: error?.name, code: error?.code
    });
    if (status === 400) {
      send(res, 400, { error: 'INVALID_RETURN_TO' });
    } else if (url.pathname === '/api/auth/callback') {
      send(res, 401, { error: 'AUTH_FAILED' });
    } else if (url.pathname === '/api/auth/dev') {
      send(res, 401, { error: 'DEV_AUTH_FAILED' });
    } else {
      send(res, 500, { error: 'AUTH_UNAVAILABLE' });
    }
    return true;
  }
};

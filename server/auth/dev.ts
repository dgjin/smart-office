import type { IncomingMessage } from 'node:http';
import { DEV_AUTH_ENABLED } from '../config.ts';

export const devAuthAllowed = (req: IncomingMessage) => {
  const remote = req.socket.remoteAddress || '';
  const host = String(req.headers.host || '').split(':')[0];
  return DEV_AUTH_ENABLED
    && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
    && ['127.0.0.1', 'localhost', '::1'].includes(host);
};

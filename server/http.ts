import type { IncomingMessage, ServerResponse } from 'node:http';

export const send = (res: ServerResponse, status: number, payload: any) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

export const readBody = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => resolve(raw));
  req.on('error', reject);
});

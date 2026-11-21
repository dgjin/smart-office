import crypto from 'node:crypto';
import http from 'node:http';

const base64url = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

export class FakeOidcProvider {
  private server: http.Server | null = null;
  private privateKey: crypto.KeyObject;
  private publicJwk: JsonWebKey & { kid: string; alg: string; use: string };
  private codes = new Map<string, { challenge: string; nonce: string; redirectUri: string }>();
  issuer = '';
  clientId = 'smart-office-test';
  subject = 'oidc-integration-subject';

  constructor() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = privateKey;
    this.publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fake-oidc-key', alg: 'RS256', use: 'sig' };
  }

  async start() {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.writableEnded) {
          res.statusCode = 500;
          res.end();
        }
      });
    });
    await new Promise<void>((resolve, reject) => this.server!.listen(0, '127.0.0.1', resolve).once('error', reject));
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Fake OIDC 端口分配失败');
    this.issuer = `http://127.0.0.1:${address.port}`;
  }

  async stop() {
    if (!this.server) return;
    await new Promise<void>(resolve => this.server!.close(() => resolve()));
    this.server = null;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '/', this.issuer);
    if (url.pathname === '/.well-known/openid-configuration') {
      return this.json(res, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none']
      });
    }
    if (url.pathname === '/jwks') return this.json(res, { keys: [this.publicJwk] });
    if (url.pathname === '/authorize') {
      const challenge = url.searchParams.get('code_challenge') || '';
      const nonce = url.searchParams.get('nonce') || '';
      const redirectUri = url.searchParams.get('redirect_uri') || '';
      if (url.searchParams.get('client_id') !== this.clientId
        || url.searchParams.get('response_type') !== 'code'
        || url.searchParams.get('scope') !== 'openid'
        || url.searchParams.get('code_challenge_method') !== 'S256'
        || !challenge || !nonce || !redirectUri || !url.searchParams.get('state')) {
        res.statusCode = 400;
        return res.end();
      }
      const code = crypto.randomBytes(24).toString('base64url');
      this.codes.set(code, { challenge, nonce, redirectUri });
      const callback = new URL(redirectUri);
      callback.searchParams.set('code', code);
      callback.searchParams.set('state', url.searchParams.get('state')!);
      res.statusCode = 303;
      res.setHeader('Location', callback.href);
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const body = await this.body(req);
      const code = body.get('code') || '';
      const grant = this.codes.get(code);
      const verifier = body.get('code_verifier') || '';
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      if (!grant || body.get('grant_type') !== 'authorization_code' || body.get('client_id') !== this.clientId
        || body.get('redirect_uri') !== grant.redirectUri || challenge !== grant.challenge) {
        res.statusCode = 400;
        return this.json(res, { error: 'invalid_grant' });
      }
      this.codes.delete(code);
      const now = Math.floor(Date.now() / 1000);
      const header = base64url({ alg: 'RS256', typ: 'JWT', kid: 'fake-oidc-key' });
      const payload = base64url({ iss: this.issuer, sub: this.subject, aud: this.clientId, iat: now, exp: now + 300, nonce: grant.nonce });
      const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), this.privateKey).toString('base64url');
      return this.json(res, {
        access_token: crypto.randomBytes(24).toString('base64url'),
        token_type: 'Bearer',
        expires_in: 300,
        id_token: `${header}.${payload}.${signature}`
      });
    }
    res.statusCode = 404;
    res.end();
  }

  private json(res: http.ServerResponse, value: unknown) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(value));
  }

  private async body(req: http.IncomingMessage) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    return new URLSearchParams(raw);
  }
}

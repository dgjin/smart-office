import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { FakeOidcProvider } from '../support/fakeOidc.ts';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const provider = new FakeOidcProvider();
const server = new TestServer();

const beginLogin = async (returnTo = '/') => {
  const login = await server.request(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  assert.equal(login.status, 303);
  const authorizationUrl = login.headers.get('location');
  assert.ok(authorizationUrl);
  const authorization = await fetch(authorizationUrl, { redirect: 'manual' });
  assert.equal(authorization.status, 303);
  const callbackUrl = authorization.headers.get('location');
  assert.ok(callbackUrl);
  return { authorizationUrl: new URL(authorizationUrl), callbackUrl: new URL(callbackUrl) };
};

describe('OIDC Authorization Code + PKCE 集成验证', { skip: !integrationEnabled, concurrency: false }, () => {
  before(async () => {
    await resetTestDb();
    await provider.start();
    await server.start(baseUrl => ({
      OIDC_ISSUER: provider.issuer,
      OIDC_CLIENT_ID: provider.clientId,
      OIDC_CLIENT_SECRET: '',
      OIDC_REDIRECT_URI: `${baseUrl}/api/auth/callback`,
      OIDC_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url')
    }));
    const options = await (await server.request('/api/auth/options')).json() as any;
    const admin = options.users.find((user: any) => user.role.includes('SYSTEM_ADMIN'));
    assert.ok(admin);
    await queryTestDb('INSERT INTO user_identities (issuer, subject, user_id) VALUES (?, ?, ?)', [provider.issuer, provider.subject, admin.id]);
  });

  after(async () => {
    await server.stop();
    await provider.stop();
  });

  it('验证 S256、签名 claims、nonce、一次性 state 和受控身份绑定', async () => {
    const { authorizationUrl, callbackUrl } = await beginLogin('/?view=BOOKINGS');
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
    const state = authorizationUrl.searchParams.get('state')!;
    const nonce = authorizationUrl.searchParams.get('nonce')!;
    const requests = await queryTestDb<any[]>('SELECT state_hash, nonce_hash, code_verifier_encrypted, consumed_at FROM oidc_auth_requests');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].state_hash, crypto.createHash('sha256').update(state).digest('hex'));
    assert.equal(requests[0].nonce_hash, crypto.createHash('sha256').update(nonce).digest('hex'));
    assert.ok(!requests[0].code_verifier_encrypted.includes(state));
    assert.ok(!requests[0].code_verifier_encrypted.includes(nonce));

    const callback = await server.request(`${callbackUrl.pathname}${callbackUrl.search}`);
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get('location'), '/?view=BOOKINGS');
    const cookie = (callback.headers.get('set-cookie') || '').split(';')[0];
    assert.match(cookie, /^smart_office_session=/);
    const me = await server.request('/api/auth/me', { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    const identities = await queryTestDb<any[]>('SELECT last_login_at FROM user_identities WHERE issuer = ? AND subject = ?', [provider.issuer, provider.subject]);
    assert.ok(identities[0]?.last_login_at);
    const consumed = await queryTestDb<any[]>('SELECT consumed_at FROM oidc_auth_requests WHERE state_hash = ?', [crypto.createHash('sha256').update(state).digest('hex')]);
    assert.ok(consumed[0]?.consumed_at);
    assert.equal((await server.request(`${callbackUrl.pathname}${callbackUrl.search}`)).status, 401);
    assert.equal((await server.request('/api/auth/login?returnTo=https%3A%2F%2Fevil.example%2F')).status, 400);
  });

  it('拒绝未绑定 subject，不自动创建内部用户', async () => {
    provider.subject = 'unbound-integration-subject';
    const { callbackUrl } = await beginLogin();
    const usersBefore = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'users'");
    const callback = await server.request(`${callbackUrl.pathname}${callbackUrl.search}`);
    assert.equal(callback.status, 401);
    const usersAfter = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'users'");
    assert.deepEqual(usersAfter, usersBefore);
    const identity = await queryTestDb<any[]>('SELECT user_id FROM user_identities WHERE subject = ?', [provider.subject]);
    assert.equal(identity.length, 0);
  });
});

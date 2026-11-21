import crypto from 'node:crypto';
import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretBasic,
  customFetch,
  discovery,
  None,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type AuthorizationCodeGrantChecks,
  type Configuration,
  type CustomFetch,
} from 'openid-client';
import type { ResultSetHeader } from 'mysql2';
import { IS_PRODUCTION, oidcConfig } from '../config.ts';
import { getDbPool, readDb } from '../db.ts';

const AUTH_REQUEST_TTL_MINUTES = 10;
const DEFAULT_RETURN_TO = '/';

type OidcSettings = ReturnType<typeof oidcConfig>;

type ConsumedAuthRequest = {
  id: string;
  nonceHash: string;
  codeVerifierEncrypted: string;
  returnTo: string;
};

export type OidcLoginResult = {
  userId: string;
  returnTo: string;
};

let configurationPromise: Promise<Configuration> | null = null;

const sha256 = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest();

const hashesEqual = (left: Buffer, rightHex: string) => {
  if (!/^[a-f0-9]{64}$/i.test(rightHex)) return false;
  return crypto.timingSafeEqual(left, Buffer.from(rightHex, 'hex'));
};

const settings = (): OidcSettings => {
  const config = oidcConfig();
  if (!config.issuer || !config.clientId || !config.redirectUri) throw new Error('OIDC_NOT_CONFIGURED');
  const issuer = new URL(config.issuer);
  const redirectUri = new URL(config.redirectUri);
  const loopbackIssuer = ['127.0.0.1', 'localhost', '::1'].includes(issuer.hostname);
  const insecureAllowed = !IS_PRODUCTION && loopbackIssuer;
  if (issuer.protocol !== 'https:' && !(issuer.protocol === 'http:' && insecureAllowed)) {
    throw new Error('OIDC_NOT_CONFIGURED');
  }
  if (redirectUri.protocol !== 'https:' && (IS_PRODUCTION || redirectUri.protocol !== 'http:')) {
    throw new Error('OIDC_NOT_CONFIGURED');
  }
  if (redirectUri.username || redirectUri.password || redirectUri.search || redirectUri.hash) {
    throw new Error('OIDC_NOT_CONFIGURED');
  }
  return config;
};

const clientAuthentication = (config: OidcSettings) => config.clientSecret
  ? ClientSecretBasic(config.clientSecret)
  : None();

const getConfiguration = async (fetchImplementation?: CustomFetch) => {
  const config = settings();
  const issuer = new URL(config.issuer);
  const execute = !IS_PRODUCTION && issuer.protocol === 'http:' ? [allowInsecureRequests] : undefined;
  if (fetchImplementation) {
    return discovery(issuer, config.clientId, config.clientSecret || undefined, clientAuthentication(config), {
      [customFetch]: fetchImplementation,
      execute,
    });
  }
  if (!configurationPromise) {
    configurationPromise = discovery(issuer, config.clientId, config.clientSecret || undefined, clientAuthentication(config), { execute })
      .catch(error => {
        configurationPromise = null;
        throw error;
      });
  }
  return configurationPromise;
};

const encryptionKey = () => {
  const encoded = process.env.OIDC_TOKEN_ENCRYPTION_KEY || '';
  const key = /^[a-f0-9]{64}$/i.test(encoded)
    ? Buffer.from(encoded, 'hex')
    : Buffer.from(encoded, 'base64url');
  if (key.length !== 32) throw new Error('OIDC_ENCRYPTION_NOT_CONFIGURED');
  return key;
};

const encryptCodeVerifier = (id: string, stateHash: string, codeVerifier: string) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${id}:${stateHash}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(codeVerifier, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
};

const decryptCodeVerifier = (id: string, stateHash: string, encrypted: string) => {
  const [version, ivValue, tagValue, ciphertextValue, extra] = encrypted.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue || extra) throw new Error('INVALID_AUTH_REQUEST');
  const iv = Buffer.from(ivValue, 'base64url');
  const tag = Buffer.from(tagValue, 'base64url');
  const ciphertext = Buffer.from(ciphertextValue, 'base64url');
  if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw new Error('INVALID_AUTH_REQUEST');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAAD(Buffer.from(`${id}:${stateHash}`, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

export const safeReturnTo = (value: string | null | undefined) => {
  if (!value) return DEFAULT_RETURN_TO;
  if (value.length > 512 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('INVALID_RETURN_TO');
  }
  const parsed = new URL(value, 'https://smart-office.local');
  if (parsed.origin !== 'https://smart-office.local') throw new Error('INVALID_RETURN_TO');
  return value;
};

export const createOidcAuthorizationUrl = async (requestedReturnTo?: string | null) => {
  const returnTo = safeReturnTo(requestedReturnTo);
  const config = settings();
  const configuration = await getConfiguration();
  const id = crypto.randomUUID();
  const state = randomState();
  const nonce = randomNonce();
  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const stateHash = sha256(state).toString('hex');
  const nonceHash = sha256(nonce).toString('hex');
  const codeVerifierEncrypted = encryptCodeVerifier(id, stateHash, codeVerifier);

  await getDbPool().query(`INSERT INTO oidc_auth_requests
    (id, state_hash, nonce_hash, code_verifier_encrypted, return_to, expires_at)
    VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ${AUTH_REQUEST_TTL_MINUTES} MINUTE))`,
  [id, stateHash, nonceHash, codeVerifierEncrypted, returnTo]);

  const authorizationUrl = buildAuthorizationUrl(configuration, {
    redirect_uri: config.redirectUri,
    scope: 'openid',
    response_type: 'code',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return authorizationUrl.href;
};

const consumeAuthRequest = async (state: string): Promise<ConsumedAuthRequest | null> => {
  const stateHash = sha256(state).toString('hex');
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<any[]>(`SELECT id, nonce_hash, code_verifier_encrypted, return_to
      FROM oidc_auth_requests
      WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > NOW(3) FOR UPDATE`, [stateHash]);
    if (!rows[0]) {
      await connection.rollback();
      return null;
    }
    const [result] = await connection.query<ResultSetHeader>(
      'UPDATE oidc_auth_requests SET consumed_at = NOW(3) WHERE id = ? AND consumed_at IS NULL',
      [rows[0].id],
    );
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return null;
    }
    await connection.commit();
    return {
      id: rows[0].id,
      nonceHash: rows[0].nonce_hash,
      codeVerifierEncrypted: rows[0].code_verifier_encrypted,
      returnTo: rows[0].return_to,
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};

const unverifiedIdTokenNonce = (idToken: unknown) => {
  if (typeof idToken !== 'string') return undefined;
  const parts = idToken.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof claims.nonce === 'string' ? claims.nonce : undefined;
  } catch {
    return undefined;
  }
};

export const completeOidcLogin = async (callbackUrl: URL): Promise<OidcLoginResult> => {
  const state = callbackUrl.searchParams.get('state');
  if (!state) throw new Error('AUTH_FAILED');
  const authRequest = await consumeAuthRequest(state);
  if (!authRequest) throw new Error('AUTH_FAILED');

  const config = settings();
  const stateHash = sha256(state).toString('hex');
  const codeVerifier = decryptCodeVerifier(authRequest.id, stateHash, authRequest.codeVerifierEncrypted);
  const checks: AuthorizationCodeGrantChecks = {
    expectedState: state,
    pkceCodeVerifier: codeVerifier,
    idTokenExpected: true,
  };

  // Only the nonce hash is persisted. Capture its unverified value from the token
  // response so openid-client can perform the authoritative signed-claim check.
  const nonceCapturingFetch: CustomFetch = async (url, options) => {
    const isCodeGrant = options.body instanceof URLSearchParams && options.body.get('grant_type') === 'authorization_code';
    const response = await fetch(url, options as RequestInit);
    if (!isCodeGrant) return response;
    try {
      const body = await response.clone().json() as { id_token?: unknown };
      const nonce = unverifiedIdTokenNonce(body.id_token);
      if (nonce && hashesEqual(sha256(nonce), authRequest.nonceHash)) checks.expectedNonce = nonce;
    } catch {
      // authorizationCodeGrant below handles malformed token responses uniformly.
    }
    return response;
  };

  const configuration = await getConfiguration(nonceCapturingFetch);
  const currentUrl = new URL(config.redirectUri);
  currentUrl.search = callbackUrl.search;
  const tokens = await authorizationCodeGrant(configuration, currentUrl, checks);
  const claims = tokens.claims();
  if (!claims || claims.iss !== config.issuer || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255
    || typeof claims.nonce !== 'string' || !hashesEqual(sha256(claims.nonce), authRequest.nonceHash)) {
    throw new Error('AUTH_FAILED');
  }

  const [identities] = await getDbPool().query<any[]>(
    'SELECT user_id FROM user_identities WHERE issuer = ? AND subject = ?',
    [config.issuer, claims.sub],
  );
  const userId = identities[0]?.user_id;
  if (typeof userId !== 'string' || !userId) throw new Error('AUTH_FAILED');
  const db = await readDb();
  if (!(db.users || []).some(user => user.id === userId)) throw new Error('AUTH_FAILED');

  await getDbPool().query(
    'UPDATE user_identities SET last_login_at = NOW(3) WHERE issuer = ? AND subject = ? AND user_id = ?',
    [config.issuer, claims.sub, userId],
  );
  return { userId, returnTo: safeReturnTo(authRequest.returnTo) };
};

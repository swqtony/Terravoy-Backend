import jwt from 'jsonwebtoken';
import { verifySessionToken, maskToken, LeancloudMisconfigError } from './leancloud.js';
import { config } from '../config.js';
import { verifyBearerToken } from '../utils/auth.js';
import { verifyAccessToken } from '../plugins/authBearer.js';

const isDev = (process.env.NODE_ENV || '').toLowerCase() !== 'production';

export class AuthError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.code = code;
    this.meta = meta;
  }
}

function parseRole(req) {
  const roleHeader = (req.headers['x-terra-role'] || '').toString().toLowerCase();
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  // In production, never trust role headers; rely on token claims instead.
  if (isProd) return 'traveler';
  if (roleHeader === 'admin') return 'admin';
  return roleHeader === 'host' ? 'host' : 'traveler';
}

function pickHeader(req, keys) {
  for (const k of keys) {
    const raw = req.headers[k];
    if (raw === undefined || raw === null) continue;
    if (Array.isArray(raw)) return raw[0];
    return raw;
  }
  return null;
}

function parseBearer(req) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth) return null;
  const [scheme, token] = auth.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token;
}

export function issueLocalJwt({ userId, role, expiresMinutes }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (expiresMinutes * 60);
  return jwt.sign({ sub: userId, role, iat: now, exp }, config.auth.localJwtSecret);
}

function verifyLocalJwt(token) {
  try {
    return jwt.verify(token, config.auth.localJwtSecret);
  } catch (_err) {
    return null;
  }
}

export async function requireAuth(req, reply) {
  const reqId = req.id;
  const path = req.url;
  const leanUserId = (pickHeader(req, ['x-leancloud-user-id', 'x-leancloud-userid']) || '').toString().trim();
  const sessionToken = (pickHeader(req, ['x-lc-session', 'x-leancloud-sessiontoken', 'x-leancloud-session-token']) || '').toString().trim();
  const terraToken = pickHeader(req, ['x-terra-token', 'x-terrra-token']);
  const context = { reqId, path, actor: leanUserId || 'anonymous' };

  // Terra token (JWT) path
  if (terraToken) {
    const terra = verifyBearerToken(terraToken);
    if (terra) {
      if (isDev && req.log) {
        req.log.info({
          event: 'auth.terra',
          reqId,
          path,
          actor: terra.sub,
          authMethod: 'terra-token',
        }, 'Authenticated via terra token');
      }
      const role = terra.role || parseRole(req);
      return { userId: terra.sub, role, tokenType: 'terra' };
    }
    if (isDev && req.log) {
      req.log.warn({ event: 'auth.terra.invalid', reqId, path }, 'Invalid terra token, fallback to LeanCloud');
    }
  }

  // Local JWT path
  const bearer = parseBearer(req);
  if (bearer) {
    const access = verifyAccessToken(bearer);
    if (access) {
      if (isDev && req.log) {
        req.log.info({
          event: 'auth.access',
          reqId,
          path,
          actor: access.sub,
          authMethod: 'access-token',
        }, 'Authenticated via access token');
      }
      const role = parseRole(req);
      req.user = { userId: access.sub, phone: access.phone || null };
      return { userId: access.sub, role, tokenType: 'access' };
    }
    const decoded = verifyLocalJwt(bearer);
    if (!decoded) {
      throw new AuthError('UNAUTHORIZED', 'Invalid bearer token', { reqId, path, authMethod: 'bearer' });
    }
    if (isDev && req.log) {
      req.log.info({
        event: 'auth.localjwt',
        reqId,
        path,
        actor: decoded.sub,
        authMethod: 'bearer',
      }, 'Authenticated via bearer local JWT');
    }
    return { userId: decoded.sub, role: decoded.role || 'traveler', tokenType: 'bearer' };
  }

  if (!leanUserId || !sessionToken) {
    throw new AuthError('UNAUTHORIZED', 'Missing Bearer or LeanCloud SessionToken', { reqId, path, authMethod: 'leancloud' });
  }

  if (isDev && req.log) {
    req.log.info({
      event: 'auth.headers.leancloud',
      reqId,
      path,
      leancloudUserId: leanUserId.toString(),
      leancloudSessionToken: maskToken(sessionToken.toString()),
      authMethod: 'leancloud',
    }, 'Received LeanCloud auth headers');
  }

  if (!config.flags.devAuthBypass) {
    let verified = null;
    try {
      verified = await verifySessionToken(leanUserId, sessionToken, { logger: req.log, context: { ...context, authMethod: 'leancloud' } });
    } catch (err) {
      if (err instanceof LeancloudMisconfigError) {
        throw new AuthError('MISCONFIG', err.message, { reqId, path, authMethod: 'leancloud' });
      }
      throw err;
    }
    if (!verified) {
      throw new AuthError('UNAUTHORIZED', 'Invalid LeanCloud session', { reqId, path, authMethod: 'leancloud' });
    }
  }

  const role = parseRole(req);
  const ttl = config.auth.localJwtTtlMin;
  const jwtToken = issueLocalJwt({ userId: leanUserId, role, expiresMinutes: ttl });
  if (reply && typeof reply.header === 'function') {
    reply.header('x-local-jwt', jwtToken);
  }
  return { userId: leanUserId, role, tokenType: 'session', issuedJwt: jwtToken };
}

export function respondAuthError(err, reply) {
  if (!(err instanceof AuthError)) return false;
  if (err.code === 'MISCONFIG') {
    reply.code(500).send({ success: false, code: 'MISCONFIG', message: 'LeanCloud server config missing' });
    return true;
  }
  if (err.code === 'UNAUTHORIZED') {
    const msg = err.meta?.authMethod === 'leancloud'
      ? 'Invalid LeanCloud session'
      : err.message || 'Unauthorized';
    reply.code(401).send({ success: false, code: 'UNAUTHORIZED', message: msg });
    return true;
  }
  return false;
}

import jwt from 'jsonwebtoken';
import { config } from '../config.js';
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

  // Local JWT path
  const bearer = parseBearer(req);
  if (!bearer) {
    throw new AuthError('UNAUTHORIZED', 'Missing bearer token', { reqId, path, authMethod: 'bearer' });
  }
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
    const role = access.role || parseRole(req);
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

export function respondAuthError(err, reply) {
  if (!(err instanceof AuthError)) return false;
  if (err.code === 'UNAUTHORIZED') {
    reply.code(401).send({ success: false, code: 'UNAUTHORIZED', message: err.message || 'Unauthorized' });
    return true;
  }
  return false;
}

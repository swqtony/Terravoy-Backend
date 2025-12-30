import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export class BearerAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function verifyAccessToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, config.auth.jwtSecret);
  } catch (_err) {
    return null;
  }
}

export async function requireBearer(req) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth) {
    throw new BearerAuthError('UNAUTHORIZED', 'Missing bearer token');
  }
  const [scheme, token] = auth.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') {
    throw new BearerAuthError('UNAUTHORIZED', 'Invalid bearer token');
  }
  const decoded = verifyAccessToken(token);
  if (!decoded) {
    throw new BearerAuthError('UNAUTHORIZED', 'Invalid bearer token');
  }
  req.user = {
    userId: decoded.sub,
    phone: decoded.phone || null,
  };
  return req.user;
}

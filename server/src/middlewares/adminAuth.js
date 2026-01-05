import jwt from 'jsonwebtoken';
import { config } from '../config.js';

function parseBearer(req) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth) return null;
  const [scheme, token] = auth.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token;
}

export function requireAdminAuth(req, reply) {
  const token = parseBearer(req);
  if (!token) {
    reply.code(401).send({ success: false, code: 'UNAUTHORIZED', message: 'Missing admin token' });
    return null;
  }

  try {
    const decoded = jwt.verify(token, config.adminAuth.jwtSecret);
    if (decoded?.type !== 'admin' || !decoded?.sub) {
      reply.code(401).send({ success: false, code: 'UNAUTHORIZED', message: 'Invalid admin token' });
      return null;
    }
    req.admin = { id: decoded.sub };
    return decoded;
  } catch (_err) {
    reply.code(401).send({ success: false, code: 'UNAUTHORIZED', message: 'Invalid admin token' });
    return null;
  }
}

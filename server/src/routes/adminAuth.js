import { config } from '../config.js';
import {
  createAdminSession,
  getAdminByEmail,
  getAdminById,
  getSessionByRefreshToken,
  issueAdminTokens,
  rotateRefreshToken,
  revokeSession,
  touchAdminLogin,
  verifyPassword,
} from '../services/adminAuthService.js';
import { requireAdminAuth } from '../middlewares/adminAuth.js';

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  const parts = header.split(';');
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rest.join('=') || '');
  }
  return cookies;
}

function buildCookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) segments.push(`Max-Age=${options.maxAge}`);
  if (options.expires) segments.push(`Expires=${options.expires.toUTCString()}`);
  segments.push(`Path=${options.path || '/'}`);
  if (options.httpOnly) segments.push('HttpOnly');
  if (options.secure) segments.push('Secure');
  if (options.sameSite) segments.push(`SameSite=${options.sameSite}`);
  return segments.join('; ');
}

function setRefreshCookie(reply, refreshToken) {
  const maxAge = config.adminAuth.refreshTtlDays * 24 * 60 * 60;
  const expires = new Date(Date.now() + maxAge * 1000);
  const cookie = buildCookie(config.adminAuth.cookieName, refreshToken, {
    maxAge,
    expires,
    path: '/functions/v1/admin',
    httpOnly: true,
    secure: config.adminAuth.cookieSecure,
    sameSite: config.adminAuth.cookieSameSite,
  });
  reply.header('Set-Cookie', cookie);
}

function clearRefreshCookie(reply) {
  const cookie = buildCookie(config.adminAuth.cookieName, '', {
    maxAge: 0,
    expires: new Date(0),
    path: '/functions/v1/admin',
    httpOnly: true,
    secure: config.adminAuth.cookieSecure,
    sameSite: config.adminAuth.cookieSameSite,
  });
  reply.header('Set-Cookie', cookie);
}

export default async function adminAuthRoutes(app) {
  const pool = app.pg.pool;

  app.post('/functions/v1/admin/auth/login', async (req, reply) => {
    const email = (req.body?.email || '').toString().trim();
    const password = (req.body?.password || '').toString();
    if (!email || !password) {
      return reply.code(400).send({ success: false, code: 'INVALID_REQUEST', message: 'Missing credentials' });
    }

    const admin = await getAdminByEmail(pool, email);
    if (!admin || admin.status !== 'active') {
      return reply.code(401).send({ success: false, code: 'UNAUTHORIZED', message: 'Invalid credentials' });
    }

    const ok = verifyPassword(password, admin.password_hash);
    if (!ok) {
      return reply.code(401).send({ success: false, code: 'UNAUTHORIZED', message: 'Invalid credentials' });
    }

    const { accessToken, refreshToken, refreshTokenHash, refreshExpiresAt } = issueAdminTokens(admin.id);
    await createAdminSession(pool, {
      adminUserId: admin.id,
      refreshTokenHash,
      refreshExpiresAt,
      ip: req.ip,
      ua: req.headers['user-agent'] || null,
      deviceId: req.headers['x-device-id'] || null,
    });
    await touchAdminLogin(pool, admin.id);
    setRefreshCookie(reply, refreshToken);

    return reply.send({ accessToken, admin: { id: admin.id, email: admin.email } });
  });

  app.post('/functions/v1/admin/auth/refresh', async (req, reply) => {
    const cookies = parseCookies(req.headers.cookie || '');
    const refreshToken = cookies[config.adminAuth.cookieName];
    if (!refreshToken) {
      return reply.code(401).send({ success: false, code: 'UNAUTHORIZED', message: 'Missing refresh token' });
    }

    const session = await getSessionByRefreshToken(pool, refreshToken);
    if (!session || session.revoked_at) {
      return reply.code(401).send({ success: false, code: 'UNAUTHORIZED', message: 'Invalid refresh token' });
    }

    if (new Date(session.refresh_expires_at).getTime() <= Date.now()) {
      return reply.code(401).send({ success: false, code: 'UNAUTHORIZED', message: 'Refresh token expired' });
    }

    const { accessToken } = issueAdminTokens(session.admin_user_id);
    const rotated = await rotateRefreshToken(pool, session.id);
    setRefreshCookie(reply, rotated.refreshToken);

    return reply.send({ accessToken });
  });

  app.post('/functions/v1/admin/auth/logout', async (req, reply) => {
    const cookies = parseCookies(req.headers.cookie || '');
    const refreshToken = cookies[config.adminAuth.cookieName];
    if (refreshToken) {
      const session = await getSessionByRefreshToken(pool, refreshToken);
      if (session && !session.revoked_at) {
        await revokeSession(pool, session.id);
      }
    }
    clearRefreshCookie(reply);
    return reply.send({ success: true });
  });

  app.get('/functions/v1/admin/me', async (req, reply) => {
    const decoded = requireAdminAuth(req, reply);
    if (!decoded) return;

    const admin = await getAdminById(pool, decoded.sub);
    if (!admin) {
      return reply.code(401).send({ success: false, code: 'UNAUTHORIZED', message: 'Invalid admin token' });
    }

    return reply.send({ id: admin.id, email: admin.email, status: admin.status });
  });
}

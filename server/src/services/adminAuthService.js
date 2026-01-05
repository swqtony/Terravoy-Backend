import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const PASSWORD_HASH_PREFIX = 'scrypt';

function normalizeEmail(email) {
  return (email || '').toString().trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${PASSWORD_HASH_PREFIX}$${salt}$${derived}`;
}

export function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;
  const [prefix, salt, hash] = storedHash.split('$');
  if (prefix !== PASSWORD_HASH_PREFIX || !salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(derived, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function createAdminUser(pool, { email, password, status = 'active' }) {
  const normalizedEmail = normalizeEmail(email);
  const passwordHash = hashPassword(password);
  const { rows } = await pool.query(
    `insert into admin_users (email, password_hash, status)
     values ($1, $2, $3)
     returning id, email, status, created_at`,
    [normalizedEmail, passwordHash, status]
  );
  return rows[0];
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildAccessToken(adminUserId) {
  const payload = { sub: adminUserId, type: 'admin' };
  const expiresIn = `${config.adminAuth.accessTtlMin}m`;
  return jwt.sign(payload, config.adminAuth.jwtSecret, { expiresIn });
}

export function issueAdminTokens(adminUserId) {
  const accessToken = buildAccessToken(adminUserId);
  const refreshToken = crypto.randomBytes(32).toString('base64url');
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const refreshExpiresAt = new Date(
    Date.now() + config.adminAuth.refreshTtlDays * 24 * 60 * 60 * 1000
  );
  return { accessToken, refreshToken, refreshTokenHash, refreshExpiresAt };
}

export async function rotateRefreshToken(pool, sessionId) {
  const refreshToken = crypto.randomBytes(32).toString('base64url');
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const refreshExpiresAt = new Date(
    Date.now() + config.adminAuth.refreshTtlDays * 24 * 60 * 60 * 1000
  );
  await pool.query(
    `update admin_sessions
     set refresh_token_hash = $1, refresh_expires_at = $2
     where id = $3`,
    [refreshTokenHash, refreshExpiresAt, sessionId]
  );
  return { refreshToken, refreshTokenHash, refreshExpiresAt };
}

export async function revokeSession(pool, sessionId) {
  await pool.query(
    'update admin_sessions set revoked_at = now() where id = $1',
    [sessionId]
  );
}

export async function getAdminByEmail(pool, email) {
  const normalizedEmail = normalizeEmail(email);
  const { rows } = await pool.query(
    'select id, email, password_hash, status, last_login_at from admin_users where email = $1',
    [normalizedEmail]
  );
  return rows[0] || null;
}

export async function getAdminById(pool, adminUserId) {
  const { rows } = await pool.query(
    'select id, email, status, last_login_at from admin_users where id = $1',
    [adminUserId]
  );
  return rows[0] || null;
}

export async function createAdminSession(pool, { adminUserId, refreshTokenHash, refreshExpiresAt, ip, ua, deviceId }) {
  const { rows } = await pool.query(
    `insert into admin_sessions
     (admin_user_id, refresh_token_hash, refresh_expires_at, ip, ua, device_id)
     values ($1, $2, $3, $4, $5, $6)
     returning id, admin_user_id`,
    [adminUserId, refreshTokenHash, refreshExpiresAt, ip || null, ua || null, deviceId || null]
  );
  return rows[0];
}

export async function getSessionByRefreshToken(pool, refreshToken) {
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const { rows } = await pool.query(
    `select id, admin_user_id, refresh_expires_at, revoked_at
     from admin_sessions
     where refresh_token_hash = $1`,
    [refreshTokenHash]
  );
  return rows[0] || null;
}

export async function touchAdminLogin(pool, adminUserId) {
  await pool.query(
    'update admin_users set last_login_at = now() where id = $1',
    [adminUserId]
  );
}

export function getRefreshTokenHash(token) {
  return hashRefreshToken(token);
}

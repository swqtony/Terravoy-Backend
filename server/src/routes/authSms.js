import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { ok, error } from '../utils/responses.js';
import { requireBearer, BearerAuthError } from '../plugins/authBearer.js';
import {
  sendSmsViaProvider,
  SmsProviderNotConfigured,
} from '../services/smsProvider.js';

function now() {
  return new Date();
}

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  return phone.trim();
}

function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return '****';
  if (normalized.length <= 4) return '****';
  return `****${normalized.slice(-4)}`;
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function hashToken(token) {
  return crypto
    .createHmac('sha256', config.auth.jwtSecret)
    .update(token)
    .digest('hex');
}

function randomCode() {
  const value = crypto.randomInt(0, 1000000);
  return value.toString().padStart(6, '0');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function issueAccessToken({ userId, phone }) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = nowSeconds + config.auth.accessTtlSeconds;
  const payload = {
    sub: userId,
    phone,
    iat: nowSeconds,
    exp,
  };
  const token = jwt.sign(payload, config.auth.jwtSecret);
  return { token, exp };
}

export default async function authSmsRoutes(app) {
  const pool = app.pg.pool;

  app.post('/functions/v1/auth/sms/send', async (req, reply) => {
    const { phone, purpose = 'login' } = req.body || {};
    const normalized = normalizePhone(phone);
    if (!normalized) {
      return error(reply, 'INVALID_REQUEST', 'phone is required', 400);
    }
    try {
      const { rows } = await pool.query(
        'select created_at from auth_sms_codes where phone = $1 order by created_at desc limit 1',
        [normalized]
      );
      const lastCreatedAt = rows[0]?.created_at ? new Date(rows[0].created_at) : null;
      if (lastCreatedAt) {
        const diffSeconds = Math.floor((Date.now() - lastCreatedAt.getTime()) / 1000);
        if (diffSeconds < config.auth.smsCooldownSeconds) {
          return error(reply, 'SMS_COOLDOWN', 'Too many requests', 429);
        }
      }
      const code = randomCode();
      const codeHash = hashCode(code);
      const expiresAt = new Date(Date.now() + config.auth.smsExpiresSeconds * 1000);
      await pool.query(
        `insert into auth_sms_codes (phone, code_hash, expires_at)
         values ($1, $2, $3)`,
        [normalized, codeHash, expiresAt]
      );
      if (config.auth.smsMode === 'gateway') {
        try {
          await sendSmsViaProvider({
            phone: normalized,
            code,
            purpose,
            provider: config.auth.smsProvider,
            providerKey: config.auth.smsProviderKey,
            providerSecret: config.auth.smsProviderSecret,
            providerSign: config.auth.smsProviderSign,
            providerTemplateLogin: config.auth.smsProviderTemplateLogin,
            providerTemplateRegister: config.auth.smsProviderTemplateRegister,
          });
        } catch (err) {
          if (err instanceof SmsProviderNotConfigured) {
            return error(reply, err.code, err.message, 501);
          }
          throw err;
        }
      }
      const resp = { ok: true };
      if (config.auth.debugSms && process.env.NODE_ENV !== 'production') {
        resp.debugCode = code;
      }
      return ok(reply, resp);
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to send sms', 500);
    }
  });

  app.post('/functions/v1/auth/sms/verify', async (req, reply) => {
    const { phone, code, deviceId = null, purpose = 'login' } = req.body || {};
    const normalized = normalizePhone(phone);
    if (!normalized || !code) {
      return error(reply, 'INVALID_REQUEST', 'phone and code are required', 400);
    }
    try {
      const { rows } = await pool.query(
        `select id, code_hash, expires_at, consumed_at
         from auth_sms_codes
         where phone = $1 and consumed_at is null and expires_at > now()
         order by created_at desc
         limit 1`,
        [normalized]
      );
      const record = rows[0];
      if (!record) {
        return error(reply, 'SMS_INVALID', 'Invalid or expired code', 400);
      }
      if (config.auth.smsMode === 'gateway') {
        if (hashCode(code) !== record.code_hash) {
          return error(reply, 'SMS_INVALID', 'Invalid or expired code', 400);
        }
      } else {
        req.log.warn(
          `[AUTH_SMS][MOCK_VERIFY_BYPASS] phone=${maskPhone(normalized)} purpose=${purpose}`
        );
      }
      await pool.query(
        'update auth_sms_codes set consumed_at = now() where id = $1',
        [record.id]
      );
      const { rows: userRows } = await pool.query(
        `insert into auth_users (phone)
         values ($1)
         on conflict (phone) do update set phone = excluded.phone
         returning id, phone, kyc_verified`,
        [normalized]
      );
      const user = userRows[0];
      const refreshToken = randomToken();
      const refreshHash = hashToken(refreshToken);
      const refreshExpiresAt = new Date(Date.now() + config.auth.refreshTtlSeconds * 1000);
      await pool.query(
        `insert into auth_sessions (user_id, refresh_token_hash, refresh_expires_at, device_id)
         values ($1, $2, $3, $4)`,
        [user.id, refreshHash, refreshExpiresAt, deviceId]
      );
      const accessToken = issueAccessToken({ userId: user.id, phone: user.phone });
      return ok(reply, {
        accessToken: accessToken.token,
        accessTokenExpiresIn: config.auth.accessTtlSeconds,
        refreshToken,
        refreshTokenExpiresIn: config.auth.refreshTtlSeconds,
        user: { id: user.id, phone: user.phone, kycVerified: user.kyc_verified === true },
      });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to verify sms', 500);
    }
  });

  app.post('/functions/v1/auth/refresh', async (req, reply) => {
    const { refreshToken, deviceId = null } = req.body || {};
    if (!refreshToken) {
      return error(reply, 'INVALID_REQUEST', 'refreshToken is required', 400);
    }
    try {
      const refreshHash = hashToken(refreshToken);
      const { rows } = await pool.query(
        `select s.id, s.user_id, s.refresh_expires_at, s.revoked_at, s.device_id, u.phone, u.kyc_verified
         from auth_sessions s
         join auth_users u on u.id = s.user_id
         where s.refresh_token_hash = $1
           and s.revoked_at is null
           and s.refresh_expires_at > now()
         limit 1`,
        [refreshHash]
      );
      const session = rows[0];
      if (!session) {
        return error(reply, 'UNAUTHORIZED', 'Invalid refresh token', 401);
      }
      await pool.query(
        'update auth_sessions set revoked_at = now() where id = $1',
        [session.id]
      );
      const nextRefreshToken = randomToken();
      const nextRefreshHash = hashToken(nextRefreshToken);
      const nextRefreshExpiresAt = new Date(Date.now() + config.auth.refreshTtlSeconds * 1000);
      await pool.query(
        `insert into auth_sessions (user_id, refresh_token_hash, refresh_expires_at, device_id)
         values ($1, $2, $3, $4)`,
        [session.user_id, nextRefreshHash, nextRefreshExpiresAt, deviceId || session.device_id]
      );
      const accessToken = issueAccessToken({ userId: session.user_id, phone: session.phone });
      return ok(reply, {
        accessToken: accessToken.token,
        accessTokenExpiresIn: config.auth.accessTtlSeconds,
        refreshToken: nextRefreshToken,
        refreshTokenExpiresIn: config.auth.refreshTtlSeconds,
        user: { id: session.user_id, phone: session.phone, kycVerified: session.kyc_verified === true },
      });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to refresh token', 500);
    }
  });

  app.post('/functions/v1/auth/logout', async (req, reply) => {
    try {
      await requireBearer(req);
    } catch (err) {
      if (err instanceof BearerAuthError) {
        return error(reply, 'UNAUTHORIZED', err.message, 401);
      }
      throw err;
    }
    const { refreshToken = null, deviceId = null } = req.body || {};
    try {
      if (refreshToken) {
        const refreshHash = hashToken(refreshToken);
        await pool.query(
          'update auth_sessions set revoked_at = now() where refresh_token_hash = $1',
          [refreshHash]
        );
      } else if (deviceId) {
        await pool.query(
          'update auth_sessions set revoked_at = now() where user_id = $1 and device_id = $2 and revoked_at is null',
          [req.user.userId, deviceId]
        );
      } else {
        await pool.query(
          'update auth_sessions set revoked_at = now() where user_id = $1 and revoked_at is null',
          [req.user.userId]
        );
      }
      return ok(reply, { ok: true });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to logout', 500);
    }
  });
}

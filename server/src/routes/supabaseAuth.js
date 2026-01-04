import crypto from 'crypto';
import { config } from '../config.js';
import jwt from 'jsonwebtoken';
import { issueTerraToken } from '../utils/auth.js';
import { verifyAccessToken } from '../plugins/authBearer.js';
import { ok, error } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';
import { pool } from '../db/pool.js';

async function ensureProfile(userId) {
  const { rows } = await pool.query(
    'select ensure_profile_v2($1, $2) as id',
    [userId, null]
  );
  return rows[0]?.id;
}

async function fetchProfile(profileId) {
  const { rows } = await pool.query(
    `select id, nickname, avatar_url, interests, communicable_languages,
            gender, age, first_language, second_language, home_city
     from profiles where id = $1 limit 1`,
    [profileId]
  );
  return rows[0] || null;
}

function buildMatchProfile(profile) {
  const nowYear = new Date().getFullYear();
  const ageValue = Number(profile?.age);
  const birthYear =
    Number.isFinite(ageValue) && ageValue > 0 ? nowYear - ageValue : null;
  const communicable =
    Array.isArray(profile?.communicable_languages)
      ? profile.communicable_languages.filter((val) => !!val)
      : [];
  if (communicable.length === 0) {
    if (profile?.first_language) communicable.push(profile.first_language);
    if (profile?.second_language) communicable.push(profile.second_language);
  }
  const primary =
    profile?.first_language || communicable[0] || 'en';
  return {
    languageProfile: {
      primaryLanguageCode: primary,
      communicableLanguages: communicable,
    },
    gender: profile?.gender || '',
    birthYear,
    homeCityCode: profile?.home_city || '',
    extra: {
      interests: Array.isArray(profile?.interests) ? profile.interests : [],
    },
  };
}

// Deterministic pseudo token generator for local use.
function fakeToken(prefix, seed) {
  return `${prefix}.${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
}

export default async function authRoutes(app) {
  // auth-supabase-login
  app.post('/functions/v1/auth-supabase-login', async (req, reply) => {
    const { userId = null } = req.body || {};
    if (!userId) {
      return error(reply, 'INVALID_REQUEST', 'userId is required', 400);
    }
    try {
      const profileId = await ensureProfile(userId);
      const refresh_token = fakeToken('refresh', userId);
      const access_token = fakeToken('access', userId);
      return ok(reply, {
        access_token,
        refresh_token,
        expires_in: 7 * 24 * 3600,
        supabaseUserId: profileId,
        email: `${userId}@local.supabase`,
      });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to login', 500);
    }
  });

  // terra-auth
  app.post('/functions/v1/terra-auth', async (req, reply) => {
    const {
      userId,
      role,
      phone = null,
      expiresInSeconds,
      sessionToken = null,
    } = req.body || {};
    if (!userId || (role !== 'traveler' && role !== 'host')) {
      return error(reply, 'INVALID_REQUEST', 'userId and role required', 400);
    }
    if (req.headers.authorization) {
      const bearer = req.headers.authorization.split(' ')[1];
      if (bearer) {
        const verified = verifyAccessToken(bearer);
        if (!verified) {
          try {
            jwt.verify(bearer, config.auth.localJwtSecret);
          } catch (_err) {
            return error(reply, 'UNAUTHORIZED', 'Invalid bearer token', 401);
          }
        }
      }
    }
    try {
      await ensureProfile(userId);
      const issued = issueTerraToken({
        userId,
        role,
        phone,
        expiresInSeconds,
      });
      return ok(reply, {
        terraToken: issued.token,
        expiresIn: issued.expiresIn,
        issuedAt: issued.issuedAt,
        role,
        phone: phone ?? null,
        sessionToken: sessionToken ?? null,
      });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to issue terra token', 500);
    }
  });

  // auth.switchRole (local backend compatibility)
  app.post('/functions/v1/auth.switchRole', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    if (!auth) return;

    const role = (req.body?.role || '').toString().toLowerCase();
    if (role !== 'traveler' && role !== 'host') {
      return error(reply, 'INVALID_REQUEST', 'role is required', 400);
    }

    try {
      const { rows: userRows } = await pool.query(
        'select phone, kyc_verified from auth_users where id = $1 limit 1',
        [auth.userId]
      );
      const userRow = userRows[0] || {};
      const { rows: certRows } = await pool.query(
        'select status from host_certifications where user_id = $1 limit 1',
        [auth.userId]
      );
      const hostApproved = certRows[0]?.status === 'approved';
      if (role === 'host' && !hostApproved) {
        return error(reply, 'FORBIDDEN', 'Host certification required', 403);
      }
      const roles = hostApproved ? ['traveler', 'host'] : ['traveler'];
      await ensureProfile(auth.userId);
      const profileId = await ensureProfile(auth.userId);
      const profile = await fetchProfile(profileId);
      const matchProfile = profile ? buildMatchProfile(profile) : null;
      return ok(reply, {
        sessionToken: req.body?.sessionToken ?? null,
        user: {
          id: auth.userId,
          userId: auth.userId,
          phone: userRow.phone || null,
          roles,
          current_role: role,
          verified_level: 0,
          credit_score: 500,
          nickname: profile?.nickname || '',
          avatarUrl: profile?.avatar_url || '',
          gender: profile?.gender || '',
          match_profile: matchProfile ?? undefined,
        },
      });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to switch role', 500);
    }
  });
}

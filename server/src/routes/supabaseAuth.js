import crypto from 'crypto';
import { config } from '../config.js';
import { parseActor, issueTerraToken, isDevTerraToken, verifyBearerToken } from '../utils/auth.js';
import { ok, error } from '../utils/responses.js';
import { pool } from '../db/pool.js';

async function ensureProfile(leancloudUserId) {
  const { rows } = await pool.query(
    'select ensure_profile_v2($1, $2) as id',
    [leancloudUserId, null]
  );
  return rows[0]?.id;
}

// Deterministic pseudo token generator for local use.
function fakeToken(prefix, seed) {
  return `${prefix}.${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
}

export default async function authRoutes(app) {
  // auth-supabase-login
  app.post('/functions/v1/auth-supabase-login', async (req, reply) => {
    const { leancloudUserId } = req.body || {};
    if (!leancloudUserId) {
      return error(reply, 'INVALID_REQUEST', 'leancloudUserId is required', 400);
    }
    try {
      const profileId = await ensureProfile(leancloudUserId);
      const refresh_token = fakeToken('refresh', leancloudUserId);
      const access_token = fakeToken('access', leancloudUserId);
      return ok(reply, {
        access_token,
        refresh_token,
        expires_in: 7 * 24 * 3600,
        supabaseUserId: profileId,
        email: `${leancloudUserId}@local.supabase`,
      });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to login', 500);
    }
  });

  // terra-auth
  app.post('/functions/v1/terra-auth', async (req, reply) => {
    const {
      leancloudUserId,
      role,
      phone = null,
      expiresInSeconds,
      sessionToken = null,
    } = req.body || {};
    if (!leancloudUserId || (role !== 'traveler' && role !== 'host')) {
      return error(reply, 'INVALID_REQUEST', 'leancloudUserId and role required', 400);
    }
    // Basic dev-token bypass: accept x-terra-token equal to dev token.
    const actor = parseActor(req);
    if (actor.terraToken && !isDevTerraToken(actor.terraToken)) {
      // not validating real terra token; accept dev or absent
    }
    if (req.headers.authorization) {
      const bearer = req.headers.authorization.split(' ')[1];
      const verified = verifyBearerToken(bearer);
      if (!verified) {
        return error(reply, 'UNAUTHORIZED', 'Invalid bearer token', 401);
      }
    }
    try {
      await ensureProfile(leancloudUserId);
      const issued = issueTerraToken({
        leancloudUserId,
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
}

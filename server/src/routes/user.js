import { ok, error } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';
import { signUrlFromStoredUrl } from '../services/storage/ossStorageService.js';

function normalizeUserId(raw) {
  if (!raw) return '';
  return String(raw).trim();
}

function isUuidLike(raw) {
  return /^[0-9a-fA-F-]{36}$/.test(raw);
}

let cachedHasUserIdColumn = null;
const DEFAULT_AVATAR_URL = 'https://picsum.photos/seed/me/200';

function resolveAvatarUrl(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return DEFAULT_AVATAR_URL;
  // Sign OSS URLs for access when Block Public Access is enabled
  return signUrlFromStoredUrl(trimmed);
}

async function hasUserIdColumn(pool) {
  if (cachedHasUserIdColumn !== null) return cachedHasUserIdColumn;
  const { rows } = await pool.query(
    `select 1
       from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'user_id'
      limit 1`
  );
  cachedHasUserIdColumn = rows.length > 0;
  return cachedHasUserIdColumn;
}

function buildPublicProfile(row) {
  const userId = row.user_id?.toString() ?? row.id?.toString() ?? '';
  const nickname = typeof row.nickname === 'string' ? row.nickname.trim() : '';
  const avatarUrl = resolveAvatarUrl(row.avatar_url);
  const tags = Array.isArray(row.interests)
    ? row.interests.map((val) => String(val).trim()).filter(Boolean)
    : [];
  return {
    userId,
    nickname,
    avatarUrl,
    shortId: userId.length > 4 ? userId.slice(-4) : userId,
    signature: null,
    gender: row.gender ?? null,
    homeCity: row.home_city ?? null,
    tags,
  };
}

export default async function userRoutes(app) {
  const pool = app.pg.pool;

  app.post('/functions/v1/user.publicProfile', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    const userId = normalizeUserId(req.body?.userId);
    if (!userId) {
      return error(reply, 'INVALID_REQUEST', 'userId is required', 400);
    }
    try {
      const hasUserId = await hasUserIdColumn(pool);
      const selectCols = hasUserId
        ? 'id, user_id, nickname, avatar_url, gender, home_city, interests'
        : 'id, nickname, avatar_url, gender, home_city, interests';
      const whereClause = hasUserId ? 'user_id = $1 or id = $1' : 'id = $1';
      const { rows } = await pool.query(
        `select ${selectCols}
         from profiles
         where ${whereClause}
         limit 1`,
        [userId]
      );
      if (!rows[0]) {
        return error(reply, 'NOT_FOUND', 'Profile not found', 404);
      }
      return ok(reply, buildPublicProfile(rows[0]));
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch profile', 500);
    }
  });

  app.post('/functions/v1/user.publicProfiles', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    const rawIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
    const userIds = rawIds
      .map((val) => normalizeUserId(val))
      .filter((val) => val && isUuidLike(val));
    if (userIds.length === 0) {
      return ok(reply, { profiles: [] });
    }
    const uniqueIds = Array.from(new Set(userIds));
    try {
      const hasUserId = await hasUserIdColumn(pool);
      const selectCols = hasUserId
        ? 'id, user_id, nickname, avatar_url, gender, home_city, interests'
        : 'id, nickname, avatar_url, gender, home_city, interests';
      const whereClause = hasUserId
        ? 'user_id = any($1::uuid[]) or id = any($1::uuid[])'
        : 'id = any($1::uuid[])';
      const { rows } = await pool.query(
        `select ${selectCols}
         from profiles
         where ${whereClause}`,
        [uniqueIds]
      );
      const profiles = rows.map(buildPublicProfile);
      return ok(reply, { profiles });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch profiles', 500);
    }
  });
}

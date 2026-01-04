import { ok, error } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';
import { authorize } from '../services/authorize.js';

const NICKNAME_MAX_LEN = 32;
const DEFAULT_AVATAR_URL = 'https://picsum.photos/seed/me/200';

function resolveAvatarUrl(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed || DEFAULT_AVATAR_URL;
}

function requireUserId(userId) {
  if (!userId || String(userId).trim().length === 0) {
    const err = new Error('userId is required');
    err.code = 'USER_ID_REQUIRED';
    err.statusCode = 400;
    throw err;
  }
  return String(userId).trim();
}

async function ensureProfile(pool, userId, supabaseUserId = null) {
  const validated = requireUserId(userId);
  const { rows } = await pool.query(
    'select ensure_profile_v2($1, $2) as id',
    [validated, supabaseUserId]
  );
  return rows[0]?.id;
}

async function fetchProfile(pool, profileId) {
  const { rows } = await pool.query(
    `select id, nickname, avatar_url, interests, communicable_languages,
            is_completed, gender, age, first_language, second_language, home_city
     from profiles where id = $1 limit 1`,
    [profileId]
  );
  return rows[0] || null;
}

function normalizeText(val) {
  if (typeof val !== 'string') return '';
  return val.trim();
}

function computeProfileCompletion(profile) {
  const missing = [];
  const gender = normalizeText(profile?.gender);
  const firstLanguage = normalizeText(profile?.first_language);
  const secondLanguage = normalizeText(profile?.second_language);
  const homeCity = normalizeText(profile?.home_city);
  const age = Number(profile?.age);

  if (!gender) missing.push('gender');
  if (!Number.isFinite(age) || age < 18 || age > 120) missing.push('age');
  if (!firstLanguage) missing.push('firstLanguage');
  if (!secondLanguage) missing.push('secondLanguage');
  if (!homeCity) missing.push('homeCity');

  return { isCompleted: missing.length === 0, missing };
}

export default async function profileRoutes(app) {
  const pool = app.pg.pool;

  // supabase/functions/profile-bootstrap
  app.post('/functions/v1/profile-bootstrap', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    const { supabaseUserId = null } = req.body || {};
    try {
      const profileId = await ensureProfile(pool, auth.userId, supabaseUserId);
      const profile = await fetchProfile(pool, profileId);
      if (!profile) {
        return error(reply, 'PROFILE_NOT_FOUND', 'Profile not found', 404);
      }
      const resolvedAvatarUrl = resolveAvatarUrl(profile.avatar_url);
      if (resolvedAvatarUrl !== (profile.avatar_url || '')) {
        await pool.query(
          'update profiles set avatar_url = $1 where id = $2',
          [resolvedAvatarUrl, profileId]
        );
        profile.avatar_url = resolvedAvatarUrl;
      }
      const completion = computeProfileCompletion(profile);
      if (profile.is_completed !== completion.isCompleted) {
        await pool.query(
          'update profiles set is_completed = $1 where id = $2',
          [completion.isCompleted, profileId]
        );
      }
      // Return complete profile data for Flutter to sync
      return ok(reply, {
        profileId,
        isCompleted: completion.isCompleted,
        missingFields: completion.missing,
        issuedJwt: auth.issuedJwt,
        // Include profile data
        profile: {
          nickname: profile.nickname || '',
          avatarUrl: resolveAvatarUrl(profile.avatar_url),
          interests: Array.isArray(profile.interests) ? profile.interests : [],
          communicableLanguages: Array.isArray(profile.communicable_languages)
            ? profile.communicable_languages
            : [profile.first_language, profile.second_language].filter(Boolean),
          gender: profile.gender || '',
          age: profile.age || null,
          firstLanguage: profile.first_language || '',
          secondLanguage: profile.second_language || '',
          homeCity: profile.home_city || '',
        },
      });
    } catch (err) {
      if (err?.statusCode) {
        return error(reply, err.code || 'INVALID_REQUEST', err.message, err.statusCode);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to bootstrap profile', 500);
    }
  });

  // supabase/functions/profile-update
  app.post('/functions/v1/profile-update', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    authorize(auth, 'profile:update');
    try {
      const { profileId = null, payload = null } = req.body || {};
      if (!profileId || String(profileId).trim().length === 0) {
        return error(reply, 'INVALID_REQUEST', 'profileId is required', 400);
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return error(reply, 'INVALID_REQUEST', 'payload is required', 400);
      }

      const ownerProfileId = await ensureProfile(pool, auth.userId);
      if (profileId !== ownerProfileId) {
        return error(reply, 'FORBIDDEN', 'profileId does not belong to user', 403);
      }
      const profile = await fetchProfile(pool, profileId);
      if (!profile) {
        return error(reply, 'PROFILE_NOT_FOUND', 'Profile not found', 404);
      }

      const updates = {};
      const invalidFields = [];
      const nickname = Object.prototype.hasOwnProperty.call(payload, 'nickname')
        ? normalizeText(payload.nickname)
        : null;
      if (nickname !== null) {
        if (!nickname || nickname.length > NICKNAME_MAX_LEN) {
          return error(reply, 'INVALID_NICKNAME', 'Invalid nickname', 400);
        }
        updates.nickname = nickname;
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'gender')) {
        const gender = normalizeText(payload.gender);
        if (!gender) invalidFields.push('gender');
        else updates.gender = gender;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'age')) {
        const numericAge = Number(payload.age);
        if (!Number.isFinite(numericAge) || numericAge < 18 || numericAge > 120) {
          invalidFields.push('age');
        } else {
          updates.age = numericAge;
        }
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'firstLanguage')) {
        const firstLanguage = normalizeText(payload.firstLanguage);
        if (!firstLanguage) invalidFields.push('firstLanguage');
        else updates.first_language = firstLanguage;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'secondLanguage')) {
        const secondLanguage = normalizeText(payload.secondLanguage);
        if (!secondLanguage) invalidFields.push('secondLanguage');
        else updates.second_language = secondLanguage;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'homeCity')) {
        const homeCity = normalizeText(payload.homeCity);
        if (!homeCity) invalidFields.push('homeCity');
        else updates.home_city = homeCity;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'avatarUrl')) {
        updates.avatar_url = normalizeText(payload.avatarUrl);
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'interests')) {
        const interests = Array.isArray(payload.interests)
          ? payload.interests
              .map((val) => normalizeText(val))
              .filter((val) => val)
          : [];
        updates.interests = interests;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'communicableLanguages')) {
        const languages = Array.isArray(payload.communicableLanguages)
          ? payload.communicableLanguages
              .map((val) => normalizeText(val))
              .filter((val) => val)
          : [];
        updates.communicable_languages = languages;
      }

      if (invalidFields.length > 0) {
        return error(reply, 'INVALID_REQUEST', 'Missing required fields', 400, {
          missingFields: invalidFields,
        });
      }

      const fields = Object.keys(updates);
      if (fields.length === 0) {
        return error(reply, 'INVALID_REQUEST', 'payload is empty', 400);
      }
      const values = fields.map((key) => updates[key]);
      const setClause = fields.map((key, idx) => `${key} = $${idx + 2}`);
      await pool.query(
        `update profiles set ${setClause.join(', ')} where id = $1`,
        [profileId, ...values]
      );
      return ok(reply, { profileId, issuedJwt: auth.issuedJwt });
    } catch (err) {
      if (err?.statusCode) {
        return error(reply, err.code || 'INVALID_REQUEST', err.message, err.statusCode);
      }
      req.log.error(err);
      const message = err.message || 'Failed to update profile';
      if (message.startsWith('INVALID_FIELD:')) {
        const field = message.split(':')[1] || 'unknown';
        return error(reply, 'INVALID_REQUEST', 'Missing required fields', 400, {
          missingFields: [field],
        });
      }
      return error(reply, 'SERVER_ERROR', 'Failed to update profile', 500);
    }
  });

  // supabase/functions/trip-card-create
  app.post('/functions/v1/trip-card-create', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    const {
      profileId: bodyProfileId,
      destinationCity,
      destinationCountry = null,
      startDate,
      endDate,
    } = req.body || {};
    if (!destinationCity || !startDate || !endDate) {
      return error(reply, 'INVALID_REQUEST', 'Missing required fields', 400);
    }
    try {
      const profileId = await ensureProfile(pool, auth.userId);
      if (bodyProfileId && bodyProfileId !== profileId) {
        return error(reply, 'INVALID_REQUEST', 'profileId mismatch', 400);
      }
      const { rows } = await pool.query(
        `insert into trip_cards
        (profile_id, destination_city, destination_country, start_date, end_date)
        values ($1,$2,$3,$4,$5) returning *`,
        [profileId, destinationCity, destinationCountry, startDate, endDate]
      );
      return ok(reply, rows[0] || {}, 200);
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to create trip card', 500);
    }
  });

  // preferences stub (not present in DB)
  app.post('/functions/v1/preferences-update', async (_req, reply) => {
    return error(reply, 'NOT_IMPLEMENTED', 'preferences-update not implemented in current schema', 501);
  });

  app.post('/functions/v1/preferences-fetch', async (_req, reply) => {
    return error(reply, 'NOT_IMPLEMENTED', 'preferences-fetch not implemented in current schema', 501);
  });
}

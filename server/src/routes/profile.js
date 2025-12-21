import { ok, error } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';
import { authorize } from '../services/authorize.js';

async function ensureProfile(pool, leancloudUserId, supabaseUserId = null) {
  const { rows } = await pool.query(
    'select ensure_profile_v2($1, $2) as id',
    [leancloudUserId, supabaseUserId]
  );
  return rows[0]?.id;
}

async function fetchProfile(pool, profileId) {
  const { rows } = await pool.query(
    `select id, is_completed, gender, age, first_language, second_language, home_city
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
    const { leancloudUserId = null, supabaseUserId = null } = req.body || {};
    try {
      if (leancloudUserId && leancloudUserId !== auth.userId) {
        return error(reply, 'INVALID_REQUEST', 'leancloudUserId mismatch', 400);
      }
      const profileId = await ensureProfile(pool, auth.userId, supabaseUserId);
      const profile = await fetchProfile(pool, profileId);
      if (!profile) {
        return error(reply, 'PROFILE_NOT_FOUND', 'Profile not found', 404);
      }
      const completion = computeProfileCompletion(profile);
      if (profile.is_completed !== completion.isCompleted) {
        await pool.query(
          'update profiles set is_completed = $1 where id = $2',
          [completion.isCompleted, profileId]
        );
      }
      return ok(reply, {
        profileId,
        isCompleted: completion.isCompleted,
        missingFields: completion.missing,
        issuedJwt: auth.issuedJwt,
      });
    } catch (err) {
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
      const {
        profileId: bodyProfileId = null,
        gender,
        age,
        firstLanguage,
        secondLanguage,
        homeCity,
      } = req.body || {};
      const profileId = await ensureProfile(pool, auth.userId);
      if (bodyProfileId && bodyProfileId !== profileId) {
        return error(reply, 'INVALID_REQUEST', 'profileId mismatch', 400);
      }
      const requiredFields = {
        gender: normalizeText(gender),
        firstLanguage: normalizeText(firstLanguage),
        secondLanguage: normalizeText(secondLanguage),
        homeCity: normalizeText(homeCity),
      };
      const numericAge = Number(age);
      const missing = [];
      if (!requiredFields.gender) missing.push('gender');
      if (!Number.isFinite(numericAge) || numericAge < 18 || numericAge > 120) missing.push('age');
      if (!requiredFields.firstLanguage) missing.push('firstLanguage');
      if (!requiredFields.secondLanguage) missing.push('secondLanguage');
      if (!requiredFields.homeCity) missing.push('homeCity');
      if (missing.length > 0) {
        return error(reply, 'INVALID_REQUEST', 'Missing required fields', 400, { missingFields: missing });
      }
      await pool.query(
        'select update_profile_from_questionnaire($1,$2,$3,$4,$5,$6)',
        [
          profileId,
          requiredFields.gender,
          numericAge,
          requiredFields.firstLanguage,
          requiredFields.secondLanguage,
          requiredFields.homeCity,
        ]
      );
      return ok(reply, { profileId, issuedJwt: auth.issuedJwt });
    } catch (err) {
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

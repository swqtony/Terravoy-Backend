import { ok, error } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';
import { authorize } from '../services/authorize.js';
import { fetchPrefsForMatch, upsertPrefsForMatch } from '../services/preferencesService.js';
import { ensureMatchThread } from '../services/imApi.js';

function requireExternalUserId(externalUserId) {
  if (!externalUserId || String(externalUserId).trim().length === 0) {
    const err = new Error('externalUserId is required');
    err.code = 'EXTERNAL_USER_ID_REQUIRED';
    err.statusCode = 400;
    throw err;
  }
  return String(externalUserId).trim();
}

async function ensureProfile(pool, externalUserId) {
  const validated = requireExternalUserId(externalUserId);
  const { rows } = await pool.query(
    'select ensure_profile_v2($1, $2) as id',
    [validated, null]
  );
  return rows[0]?.id;
}

async function fetchProfile(pool, profileId) {
  const { rows } = await pool.query(
    `select id, is_completed, gender, age,
            first_language, second_language, home_city
     from profiles where id = $1`,
    [profileId]
  );
  return rows[0] || null;
}

async function fetchOtherProfile(pool, otherProfileId) {
  if (!otherProfileId) return null;
  return (await fetchProfile(pool, otherProfileId)) || null;
}

async function getActiveRequest(pool, profileId) {
  const { rows } = await pool.query(
    'select * from match_requests where profile_id = $1 and status = $2 order by created_at desc limit 1',
    [profileId, 'waiting']
  );
  return rows[0] || null;
}

async function getLatestRequest(pool, profileId) {
  const { rows } = await pool.query(
    'select * from match_requests where profile_id = $1 order by created_at desc limit 1',
    [profileId]
  );
  return rows[0] || null;
}

async function getSessionByRequest(pool, requestId) {
  const { rows } = await pool.query(
    `select *
     from match_sessions
     where request_a_id = $1 or request_b_id = $1
     order by created_at desc
     limit 1`,
    [requestId]
  );
  return rows[0] || null;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeGender(val) {
  return typeof val === 'string' ? val : null;
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

function normalizeNumber(val) {
  if (val === null || val === undefined) return null;
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) ? num : null;
}

function normalizeLanguages(val) {
  if (!Array.isArray(val)) return null;
  const cleaned = val.filter((v) => typeof v === 'string' && v.length > 0);
  return cleaned.length ? cleaned : null;
}

function normalizeCityScope(val) {
  return typeof val === 'string' && val.length > 0 ? val : 'Strict';
}

async function fetchUserIdByProfileId(pool, profileId) {
  if (!profileId) return null;
  const { rows } = await pool.query(
    `select user_id
     from profiles
     where id = $1
     limit 1`,
    [profileId]
  );
  return rows[0]?.user_id || null;
}

async function fetchUserIdMap(pool, profileIds) {
  const ids = (profileIds || []).filter(Boolean);
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query(
    `select id, user_id
     from profiles
     where id = any($1::uuid[])`,
    [ids]
  );
  const map = new Map();
  for (const row of rows) {
    const userId = row.user_id || row.id;
    if (row.id && userId) {
      map.set(row.id, userId);
    }
  }
  return map;
}

async function buildMatchedResponse(pool, sessionRow, profileId, requestId) {
  const isA = sessionRow.profile_a_id === profileId;
  const otherProfileId = isA ? sessionRow.profile_b_id : sessionRow.profile_a_id;
  if (!otherProfileId || otherProfileId === profileId) return null;
  const otherExternalUserId =
    (await fetchUserIdByProfileId(pool, otherProfileId)) || otherProfileId;
  const matchSessionId = sessionRow.id || sessionRow.session_id || null;
  const matchRequestId =
    requestId ||
    sessionRow.request_a_id ||
    sessionRow.request_b_id ||
    null;
  const threadId = sessionRow.thread_id ?? null;
  if (!otherExternalUserId) {
    return {
      status: 'profile_incomplete',
      errorCode: 'PEER_LEANCLOUD_ID_MISSING',
      message: 'peerUserId missing',
      matchSessionId,
      matchRequestId,
      peerUserId: null,
      otherUserId: null,
      peerLeancloudUserId: null,
      threadId,
      reusedThread: !!threadId,
      serverTime: new Date().toISOString(),
      selfProfileId: profileId,
      otherProfileId,
    };
  }
  return {
    status: 'matched',
    matchSessionId,
    matchRequestId,
    peerUserId: otherExternalUserId,
    otherUserId: otherExternalUserId,
    peerLeancloudUserId: otherExternalUserId,
    threadId,
    reusedThread: !!threadId,
    serverTime: new Date().toISOString(),
    session: sessionRow,
    selfProfileId: profileId,
    otherProfileId,
  };
}

function isSessionForRequest(sessionRow, requestId) {
  if (!sessionRow || !requestId) return false;
  return (
    sessionRow.request_a_id === requestId ||
    sessionRow.request_b_id === requestId
  );
}

function isStrongMatched(data) {
  const peerUserId = data.peerUserId || data.peerLeancloudUserId;
  return (
    data.matchSessionId &&
    peerUserId &&
    data.threadId
  );
}

function listMissingFields(data) {
  const missing = [];
  if (!data.matchSessionId) missing.push('matchSessionId');
  if (!data.matchRequestId) missing.push('matchRequestId');
  if (!data.peerUserId && !data.peerLeancloudUserId) missing.push('peerUserId');
  if (!data.threadId) missing.push('threadId');
  return missing;
}

function resolvePeerFromSession(sessionRow, requestId) {
  if (!sessionRow) return { peerProfileId: null, peerRequestId: null };
  const isRequestA = sessionRow.request_a_id === requestId;
  if (isRequestA) {
    return {
      peerProfileId: sessionRow.profile_b_id || null,
      peerRequestId: sessionRow.request_b_id || null,
    };
  }
  return {
    peerProfileId: sessionRow.profile_a_id || null,
    peerRequestId: sessionRow.request_a_id || null,
  };
}

async function resolvePeerLeanId(pool, data) {
  if (data?.peerUserId) return data.peerUserId;
  if (data?.peerLeancloudUserId) return data.peerLeancloudUserId;
  if (!data?.otherProfileId) return null;
  return data.otherProfileId;
}

async function markSessionMatched(pool, sessionId) {
  if (!sessionId) return;
  await pool.query(
    "update match_sessions set status = 'matched' where id = $1 and status <> 'matched'",
    [sessionId]
  );
}

async function ensureThreadForSession({ pool, sessionRow, logger, context }) {
  if (!sessionRow) return null;
  if (sessionRow.thread_id) return sessionRow.thread_id;
  if (!sessionRow.profile_a_id || !sessionRow.profile_b_id) return null;
  const userIdMap = await fetchUserIdMap(pool, [
    sessionRow.profile_a_id,
    sessionRow.profile_b_id,
  ]);
  const memberA =
    userIdMap.get(sessionRow.profile_a_id) || sessionRow.profile_a_id;
  const memberB =
    userIdMap.get(sessionRow.profile_b_id) || sessionRow.profile_b_id;
  const threadId = await ensureMatchThread({
    sessionId: sessionRow.id,
    memberA,
    memberB,
    actorUserId: memberA,
  });
  if (!threadId) return null;
  await pool.query(
    'update match_sessions set thread_id = $1 where id = $2',
    [threadId, sessionRow.id]
  );
  sessionRow.thread_id = threadId;
  if (logger?.info) {
    logger.info({
      event: 'thread.attached',
      threadId,
      sessionId: sessionRow.id,
      ...context,
    }, 'IM thread attached');
  }
  return threadId;
}

export default async function matchRoutes(app) {
  const pool = app.pg.pool;

  app.post('/functions/v1/match-start', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    const body = req.body || {};
    const {
      tripCardId,
      preferredGender = null,
      preferredAgeMin = null,
      preferredAgeMax = null,
      preferredLanguages = null,
      cityScopeMode = 'Strict',
      preferences = null,
    } = body;
    if (!tripCardId) {
      return error(reply, 'INVALID_REQUEST', 'tripCardId is required', 400);
    }
    try {
      const profileId = await ensureProfile(pool, auth.userId);
      authorize({ ...auth, profileId }, 'match:start');
      const profile = await fetchProfile(pool, profileId);
      if (!profile) {
        return ok(reply, { status: 'incomplete_profile', profileId, issuedJwt: auth.issuedJwt });
      }
      const completion = computeProfileCompletion(profile);
      if (profile.is_completed !== completion.isCompleted) {
        await pool.query(
          'update profiles set is_completed = $1 where id = $2',
          [completion.isCompleted, profileId]
        );
      }
      if (!completion.isCompleted) {
        return ok(reply, {
          status: 'incomplete_profile',
          profileId,
          missingFields: completion.missing,
          issuedJwt: auth.issuedJwt,
        });
      }

      const hasPreferredGender = hasOwn(body, 'preferredGender');
      const hasPreferredAgeMin = hasOwn(body, 'preferredAgeMin');
      const hasPreferredAgeMax = hasOwn(body, 'preferredAgeMax');
      const hasPreferredLanguages = hasOwn(body, 'preferredLanguages');
      const hasCityScopeMode = hasOwn(body, 'cityScopeMode');

      let effectivePrefs = preferences;
      if (!effectivePrefs || (typeof effectivePrefs === 'object' && Object.keys(effectivePrefs).length === 0)) {
        effectivePrefs = await fetchPrefsForMatch(pool, auth.userId);
      } else {
        await upsertPrefsForMatch(pool, auth.userId, effectivePrefs);
      }
      effectivePrefs = effectivePrefs || {};

      const resolvedPreferredGender = hasPreferredGender
        ? normalizeGender(preferredGender)
        : normalizeGender(effectivePrefs.preferredGender);
      const resolvedPreferredAgeMin = hasPreferredAgeMin
        ? normalizeNumber(preferredAgeMin)
        : normalizeNumber(effectivePrefs.preferredAgeMin);
      const resolvedPreferredAgeMax = hasPreferredAgeMax
        ? normalizeNumber(preferredAgeMax)
        : normalizeNumber(effectivePrefs.preferredAgeMax);
      const resolvedPreferredLanguages = hasPreferredLanguages
        ? normalizeLanguages(preferredLanguages)
        : normalizeLanguages(effectivePrefs.preferredLanguages);
      const resolvedCityScopeMode = hasCityScopeMode
        ? normalizeCityScope(cityScopeMode)
        : normalizeCityScope(effectivePrefs.cityScopeMode);

      const appliedPreferences = {
        preferredGender: resolvedPreferredGender,
        preferredAgeMin: resolvedPreferredAgeMin,
        preferredAgeMax: resolvedPreferredAgeMax,
        preferredLanguages: resolvedPreferredLanguages,
        cityScopeMode: resolvedCityScopeMode,
        raw: effectivePrefs,
      };

      const { rows: sessionRows } = await pool.query(
        'select * from start_match($1,$2,$3,$4,$5,$6,$7)',
        [
          profileId,
          tripCardId,
          resolvedPreferredGender,
          resolvedPreferredAgeMin,
          resolvedPreferredAgeMax,
          resolvedPreferredLanguages,
          resolvedCityScopeMode,
        ]
      );
      const latestReq = await getLatestRequest(pool, profileId);
      const latestRequestId = latestReq?.id ?? null;
      const sessionRow = sessionRows[0] || null;
      if (sessionRow && process.env.NODE_ENV !== 'production') {
        req.log.debug({ event: 'match-start.sessionRow', sessionRow }, 'match-start raw sessionRow');
      }
      if (sessionRow) {
        await ensureThreadForSession({
          pool,
          sessionRow,
          logger: req.log,
          context: {
            requestId: latestRequestId,
            sessionId: sessionRow.id,
          },
        });
        const data = await buildMatchedResponse(pool, sessionRow, profileId, latestRequestId);
        if (!data) {
          const hasProfileA = !!sessionRow.profile_a_id;
          const hasProfileB = !!sessionRow.profile_b_id;
          const inSession =
            sessionRow.profile_a_id === profileId ||
            sessionRow.profile_b_id === profileId;
          const sameProfiles =
            sessionRow.profile_a_id &&
            sessionRow.profile_a_id === sessionRow.profile_b_id;
          const otherProfileId =
            sessionRow.profile_a_id === profileId
              ? sessionRow.profile_b_id
              : sessionRow.profile_a_id;
          const peerProfile = otherProfileId
            ? await fetchOtherProfile(pool, otherProfileId)
            : null;
          const peerProfileMissing = Boolean(otherProfileId && !peerProfile);
          const invalidReason = !sessionRow
            ? 'session_not_found'
            : !hasProfileA || !hasProfileB
              ? 'session_profiles_missing'
              : !inSession
                ? 'self_profile_not_in_session'
                : sameProfiles
                  ? 'self_peer_same_profile'
                  : peerProfileMissing
                    ? 'peer_profile_not_found'
                    : 'unknown';
          req.log.warn({
            event: 'match-start.invalid_or_self_match_context',
            actor: auth.userId,
            headerLeancloudUserId: null,
            requestId: latestRequestId,
            selfProfileId: profileId,
            sessionLookup: {
              byRequestA: latestRequestId,
              byRequestB: latestRequestId,
              fallbackUsed: false,
            },
            sessionRow: sessionRow
              ? {
                  id: sessionRow.id,
                  request_a_id: sessionRow.request_a_id,
                  request_b_id: sessionRow.request_b_id,
                  profile_a_id: sessionRow.profile_a_id,
                  profile_b_id: sessionRow.profile_b_id,
                  thread_id: sessionRow.thread_id,
                  status: sessionRow.status,
                }
              : null,
            invalidReason,
          }, 'match-start invalid_or_self_match context');
          if (process.env.NODE_ENV !== 'production') {
            req.log.warn({
              event: 'match-start.downgrade_waiting',
              reason: 'invalid_or_self_match',
              requestId: latestRequestId,
              sessionId: sessionRow.id,
            }, 'match-start downgrade to waiting');
          }
        } else {
        if (data.status === 'profile_incomplete') {
          return ok(reply, {
            ...data,
            issuedJwt: auth.issuedJwt,
          });
        }
        const response = {
          ...data,
          preferences: effectivePrefs,
          appliedPreferences,
          issuedJwt: auth.issuedJwt,
        };
        const missing = listMissingFields(response);
        if (
          missing.length === 0 &&
          isSessionForRequest(sessionRow, response.matchRequestId)
        ) {
          if (process.env.NODE_ENV !== 'production') {
            req.log.debug({ event: 'match-start.response', response }, 'match-start response');
          }
          return ok(reply, response);
        }
        if (process.env.NODE_ENV !== 'production') {
          req.log.warn({
            event: 'match-start.downgrade_waiting',
            reason: 'incomplete_match_fields_or_mismatched_request',
            missing,
            requestId: response.matchRequestId,
            sessionId: sessionRow.id,
            requestA: sessionRow.request_a_id,
            requestB: sessionRow.request_b_id,
            threadId: sessionRow.thread_id,
          }, 'match-start downgrade to waiting');
        }
        }
      }
      const activeReq = await getActiveRequest(pool, profileId);
      const response = {
        status: 'waiting',
        matchRequestId: activeReq?.id ?? latestRequestId ?? null,
        matchSessionId: null,
        peerUserId: null,
        otherUserId: null,
        peerLeancloudUserId: null,
        threadId: null,
        reusedThread: false,
        serverTime: new Date().toISOString(),
        issuedJwt: auth.issuedJwt,
      };
      if (process.env.NODE_ENV !== 'production') {
        req.log.debug({ event: 'match-start.response', response }, 'match-start response');
      }
      return ok(reply, response);
    } catch (err) {
      req.log.error(err);
      const status = err.statusCode || 500;
      return error(reply, err.code || 'SERVER_ERROR', err.message || 'Failed to start match', status);
    }
  });

  app.post('/functions/v1/match-poll', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    const { requestId } = req.body || {};
    if (!requestId) {
      return error(reply, 'INVALID_REQUEST_ID', 'requestId is required', 400);
    }
    try {
      const profileId = await ensureProfile(pool, auth.userId);
      const { rows: reqRows } = await pool.query(
        'select * from match_requests where id = $1 limit 1',
        [requestId]
      );
      const ownerRow = reqRows[0] || null;
      authorize({ ...auth, profileId }, 'match:poll', { ownerProfileId: ownerRow?.profile_id });
      if (!ownerRow) {
        return error(reply, 'NOT_FOUND', 'Request not found', 404);
      }
      if (ownerRow.status === 'waiting') {
        const { rows: touchedRows } = await pool.query(
          'select * from touch_match_request($1,$2)',
          [requestId, profileId]
        );
        const touched = touchedRows[0] || null;
        if (!touched) {
          return ok(reply, {
            status: 'expired',
            requestId,
            profileId,
            requestStatus: ownerRow.status,
            reason: 'request_expired',
            issuedJwt: auth.issuedJwt,
          });
        }
      }
      const activeReq = await getActiveRequest(pool, profileId);
      if (activeReq && activeReq.id !== requestId) {
        return ok(reply, {
          status: 'cancelled',
          requestId,
          profileId,
          requestStatus: ownerRow.status,
          reason: 'superseded_by_new_request',
          issuedJwt: auth.issuedJwt,
        });
      }
      if (
        ownerRow.status &&
        ownerRow.status !== 'waiting' &&
        ownerRow.status !== 'matched'
      ) {
        return ok(reply, {
          status: ownerRow.status || 'ended',
          requestId,
          profileId,
          requestStatus: ownerRow.status,
          reason: 'request_not_waiting',
          issuedJwt: auth.issuedJwt,
        });
      }

      const sessionRow = await getSessionByRequest(pool, requestId);
      req.log.info({
        event: 'match-poll.session_read',
        requestId,
        hit: Boolean(sessionRow),
        sessionId: sessionRow?.id ?? null,
        sessionStatus: sessionRow?.status ?? null,
        threadIdPresent: Boolean(sessionRow?.thread_id),
        threadIdPrefix: sessionRow?.thread_id
          ? String(sessionRow.thread_id).slice(0, 6)
          : null,
      }, 'match-poll session read');

      if (sessionRow) {
        await ensureThreadForSession({
          pool,
          sessionRow,
          logger: req.log,
          context: {
            requestId,
            sessionId: sessionRow.id,
          },
        });
        const data = await buildMatchedResponse(pool, sessionRow, profileId, requestId);
        if (!data) {
          if (process.env.NODE_ENV !== 'production') {
            req.log.warn({
              event: 'match-poll.downgrade_waiting',
              reason: 'invalid_or_self_match',
              requestId,
              sessionId: sessionRow.id,
            }, 'match-poll downgrade to waiting');
          }
          return ok(reply, {
            status: 'waiting',
            matchRequestId: requestId,
            matchSessionId: sessionRow.id,
            peerUserId: null,
            otherUserId: null,
            peerLeancloudUserId: null,
            threadId: null,
            reusedThread: false,
            serverTime: new Date().toISOString(),
            reason: 'invalid_or_self_match',
            issuedJwt: auth.issuedJwt,
          });
        }
        if (data.status === 'profile_incomplete') {
          return ok(reply, {
            ...data,
            issuedJwt: auth.issuedJwt,
          });
        }
        if (sessionRow.thread_id) {
          const response = {
            ...data,
            status: 'matched',
            threadId: sessionRow.thread_id,
            reusedThread: true,
            issuedJwt: auth.issuedJwt,
          };
          if (response.session) {
            response.session = {
              ...response.session,
              thread_id: sessionRow.thread_id,
              status: 'matched',
            };
          }
          return ok(reply, response);
        }
        return ok(reply, {
          status: 'waiting',
          matchRequestId: requestId,
          matchSessionId: sessionRow.id,
          peerUserId: data.peerUserId ?? data.peerLeancloudUserId ?? null,
          otherUserId: data.otherUserId ?? data.peerUserId ?? data.peerLeancloudUserId ?? null,
          peerLeancloudUserId: data.peerLeancloudUserId ?? null,
          threadId: null,
          reusedThread: false,
          serverTime: new Date().toISOString(),
          reason: 'thread_pending',
          issuedJwt: auth.issuedJwt,
        });
      }
      const response = {
        status: 'waiting',
        matchRequestId: requestId,
        matchSessionId: null,
        peerUserId: null,
        otherUserId: null,
        peerLeancloudUserId: null,
        threadId: null,
        reusedThread: false,
        reason: 'no_session_yet',
        serverTime: new Date().toISOString(),
        issuedJwt: auth.issuedJwt,
      };
      if (process.env.NODE_ENV !== 'production') {
        req.log.debug({ event: 'match-poll.response', response }, 'match-poll response');
      }
      return ok(reply, response);
    } catch (err) {
      req.log.error(err);
      const status = err.statusCode || 500;
      return error(reply, err.code || 'SERVER_ERROR', err.message || 'Failed to poll match', status);
    }
  });

  app.post('/functions/v1/match-heartbeat', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    const { requestId } = req.body || {};
    if (!requestId) {
      return error(reply, 'INVALID_REQUEST_ID', 'requestId is required', 400);
    }
    try {
      const profileId = await ensureProfile(pool, auth.userId);
      const { rows: reqRows } = await pool.query(
        'select * from match_requests where id = $1 limit 1',
        [requestId]
      );
      const ownerRow = reqRows[0] || null;
      authorize({ ...auth, profileId }, 'match:heartbeat', { ownerProfileId: ownerRow?.profile_id });
      if (!ownerRow) {
        return error(reply, 'NOT_FOUND', 'Request not found', 404);
      }

      const { rows: touchedRows } = await pool.query(
        'select * from touch_match_request($1,$2)',
        [requestId, profileId]
      );
      const touched = touchedRows[0] || null;
      if (!touched) {
        return ok(reply, {
          status: ownerRow.status || 'expired',
          requestId,
          profileId,
          requestStatus: ownerRow.status,
          reason: 'request_not_waiting_or_expired',
          issuedJwt: auth.issuedJwt,
        });
      }

      const sessionRow = await getSessionByRequest(pool, requestId);
      if (sessionRow) {
        await ensureThreadForSession({
          pool,
          sessionRow,
          logger: req.log,
          context: {
            requestId,
            sessionId: sessionRow.id,
          },
        });
      }
      if (sessionRow && sessionRow.thread_id) {
        const data = await buildMatchedResponse(pool, sessionRow, profileId, requestId);
        if (data?.status === 'profile_incomplete') {
          return ok(reply, {
            ...data,
            issuedJwt: auth.issuedJwt,
          });
        }
        if (data) {
          const response = {
            ...data,
            status: 'matched',
            threadId: sessionRow.thread_id,
            reusedThread: true,
            issuedJwt: auth.issuedJwt,
          };
          if (response.session) {
            response.session = {
              ...response.session,
              thread_id: sessionRow.thread_id,
              status: 'matched',
            };
          }
          return ok(reply, response);
        }
      }

      return ok(reply, {
        status: 'waiting',
        matchRequestId: requestId,
        matchSessionId: sessionRow?.id ?? null,
        peerLeancloudUserId: null,
        threadId: null,
        reusedThread: false,
        serverTime: new Date().toISOString(),
        issuedJwt: auth.issuedJwt,
      });
    } catch (err) {
      req.log.error(err);
      const status = err.statusCode || 500;
      return error(reply, err.code || 'SERVER_ERROR', err.message || 'Failed to heartbeat match', status);
    }
  });

  app.post('/functions/v1/match-cancel', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    const { requestId = null } = req.body || {};
    try {
      const profileId = await ensureProfile(pool, auth.userId);
      let targetRequestId = requestId;
      if (targetRequestId) {
        const { rows } = await pool.query(
          'select profile_id from match_requests where id = $1 limit 1',
          [targetRequestId]
        );
        const owner = rows[0]?.profile_id;
        authorize({ ...auth, profileId }, 'match:cancel', { ownerProfileId: owner });
        if (!owner) return error(reply, 'NOT_FOUND', 'request not found', 404);
        await pool.query('select cancel_match($1)', [targetRequestId]);
      } else {
        authorize({ ...auth, profileId }, 'match:cancel');
        const activeReq = await getActiveRequest(pool, profileId);
        targetRequestId = activeReq?.id ?? null;
        await pool.query('select cancel_active_match_requests($1)', [profileId]);
      }
      return ok(reply, {
        status: 'cancelled',
        requestId: targetRequestId,
        serverTime: new Date().toISOString(),
        issuedJwt: auth.issuedJwt,
      });
    } catch (err) {
      req.log.error(err);
      const status = err.statusCode || 500;
      return error(reply, err.code || 'SERVER_ERROR', err.message || 'Failed to cancel match', status);
    }
  });

  app.post('/functions/v1/match-attach-conversation', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    const { sessionId, threadId, force = false } = req.body || {};
    if (!sessionId || !threadId) {
      return error(reply, 'INVALID_REQUEST', 'sessionId and threadId required', 400);
    }
    try {
      const { rows } = await pool.query(
        `update match_sessions
         set thread_id = case when $3 then $2 else coalesce(thread_id, $2) end
         where id = $1
         returning *`,
        [sessionId, threadId, force]
      );
      return ok(reply, { ...(rows[0] || {}), issuedJwt: auth.issuedJwt });
    } catch (err) {
      req.log.error(err);
      const status = err.statusCode || 500;
      return error(reply, 'SERVER_ERROR', err.message || 'Failed to attach thread', status);
    }
  });

  app.post('/functions/v1/match-get-partner', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    const { sessionId, selfProfileId = null } = req.body || {};
    if (!sessionId) return error(reply, 'INVALID_REQUEST', 'sessionId required', 400);
    try {
    const { rows } = await pool.query(
        'select id, profile_a_id, profile_b_id, request_a_id, request_b_id, thread_id from match_sessions where id = $1 limit 1',
        [sessionId]
      );
      const sessionRow = rows[0];
      if (!sessionRow) return error(reply, 'NOT_FOUND', 'Session not found', 404);
      const profileId = selfProfileId || sessionRow.profile_a_id || sessionRow.profile_b_id;
      if (!profileId) return error(reply, 'FORBIDDEN', 'Profile missing', 403);
      const otherProfileId =
        sessionRow.profile_a_id === profileId
          ? sessionRow.profile_b_id
          : sessionRow.profile_a_id;
      const otherProfile = await fetchOtherProfile(pool, otherProfileId);
      return ok(reply, {
        status: otherProfile ? 'matched' : 'waiting',
        sessionId: sessionRow.id,
        requestId: sessionRow.request_a_id || sessionRow.request_b_id || null,
        otherProfileId: otherProfile?.id ?? null,
        otherUserId: otherProfile?.id ?? null,
        otherLeancloudUserId: otherProfile?.id ?? null,
        threadId: sessionRow.thread_id ?? null,
        issuedJwt: auth.issuedJwt,
      });
    } catch (err) {
      req.log.error(err);
      const status = err.statusCode || 500;
      return error(reply, 'SERVER_ERROR', err.message || 'Failed to get partner', status);
    }
  });
}

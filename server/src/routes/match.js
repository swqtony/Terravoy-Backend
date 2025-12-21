import { ok, error } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';
import { authorize } from '../services/authorize.js';
import { fetchPrefsForMatch, upsertPrefsForMatch } from '../services/preferencesService.js';
import { createOrReuseConversation } from '../services/leancloudConversation.js';

async function ensureProfile(pool, leancloudUserId) {
  const { rows } = await pool.query(
    'select ensure_profile_v2($1, $2) as id',
    [leancloudUserId, null]
  );
  return rows[0]?.id;
}

async function fetchProfile(pool, profileId) {
  const { rows } = await pool.query(
    `select id, leancloud_user_id, is_completed, gender, age,
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

async function buildMatchedResponse(pool, sessionRow, profileId, requestId) {
  const isA = sessionRow.profile_a_id === profileId;
  const otherProfileId = isA ? sessionRow.profile_b_id : sessionRow.profile_a_id;
  if (!otherProfileId || otherProfileId === profileId) return null;
  const otherProfile = await fetchOtherProfile(pool, otherProfileId);
  const otherLean = otherProfile?.leancloud_user_id ?? null;
  const matchSessionId = sessionRow.id || sessionRow.session_id || null;
  const matchRequestId =
    requestId ||
    sessionRow.request_a_id ||
    sessionRow.request_b_id ||
    null;
  const conversationId = sessionRow.conversation_id ?? null;
  return {
    status: 'matched',
    matchSessionId,
    matchRequestId,
    peerLeancloudUserId: otherLean,
    conversationId,
    reusedConversation: !!conversationId,
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
  return (
    data.matchSessionId &&
    data.peerLeancloudUserId &&
    data.conversationId
  );
}

function listMissingFields(data) {
  const missing = [];
  if (!data.matchSessionId) missing.push('matchSessionId');
  if (!data.matchRequestId) missing.push('matchRequestId');
  if (!data.peerLeancloudUserId) missing.push('peerLeancloudUserId');
  if (!data.conversationId) missing.push('conversationId');
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
  if (data?.peerLeancloudUserId) return data.peerLeancloudUserId;
  if (!data?.otherProfileId) return null;
  const otherProfile = await fetchOtherProfile(pool, data.otherProfileId);
  return otherProfile?.leancloud_user_id ?? null;
}

async function markSessionMatched(pool, sessionId) {
  if (!sessionId) return;
  await pool.query(
    "update match_sessions set status = 'matched' where id = $1 and status <> 'matched'",
    [sessionId]
  );
}

async function attachConversationForMatch(params) {
  const {
    pool,
    sessionId,
    selfLeancloudUserId,
    peerLeancloudUserId,
    logger,
    context,
  } = params;
  if (!sessionId || !selfLeancloudUserId || !peerLeancloudUserId) return null;
  const { rows: existingRows } = await pool.query(
    'select conversation_id from match_sessions where id = $1 limit 1',
    [sessionId]
  );
  const existingConversationId = existingRows[0]?.conversation_id ?? null;
  const { conversationId, reused } = await createOrReuseConversation(
    [selfLeancloudUserId, peerLeancloudUserId],
    { logger, context }
  );
  await pool.query(
    'select attach_conversation_to_session($1,$2,$3) as session',
    [sessionId, conversationId, true]
  );
  const updated = existingConversationId !== conversationId;
  if (logger?.info) {
    logger.info({
      event: 'conversation.attached',
      conversationId,
      reused,
      updated,
      ...context,
    }, 'LeanCloud conversation attached');
  }
  return { conversationId, reused, updated };
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
      const headerLeanId =
        (req.headers['x-leancloud-user-id'] ||
          req.headers['x-leancloud-userid'] ||
          '')?.toString?.() ||
        '';
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
      if (auth.userId && headerLeanId && auth.userId !== headerLeanId) {
        req.log.warn({
          event: 'auth.leancloud_mismatch',
          actor: auth.userId,
          headerLeancloudUserId: headerLeanId,
          requestId: latestRequestId,
          path: req.url,
        });
      }
      const sessionRow = sessionRows[0] || null;
      if (sessionRow && process.env.NODE_ENV !== 'production') {
        req.log.debug({ event: 'match-start.sessionRow', sessionRow }, 'match-start raw sessionRow');
      }
      if (sessionRow) {
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
          const leancloudMismatch =
            auth.userId && headerLeanId && auth.userId !== headerLeanId;
          const invalidReason = leancloudMismatch
            ? 'leancloud_user_mismatch'
            : !sessionRow
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
            headerLeancloudUserId: headerLeanId || null,
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
                  conversation_id: sessionRow.conversation_id,
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
            conversationId: sessionRow.conversation_id,
          }, 'match-start downgrade to waiting');
        }
        }
      }
      const activeReq = await getActiveRequest(pool, profileId);
      const response = {
        status: 'waiting',
        matchRequestId: activeReq?.id ?? latestRequestId ?? null,
        matchSessionId: null,
        peerLeancloudUserId: null,
        conversationId: null,
        reusedConversation: false,
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
      return error(reply, 'SERVER_ERROR', err.message || 'Failed to start match', status);
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
      const headerLeanId =
        (req.headers['x-leancloud-user-id'] ||
          req.headers['x-leancloud-userid'] ||
          '')?.toString?.() ||
        '';
      if (auth.userId && headerLeanId && auth.userId !== headerLeanId) {
        req.log.warn({
          event: 'auth.leancloud_mismatch',
          actor: auth.userId,
          headerLeancloudUserId: headerLeanId,
          requestId,
          path: req.url,
        });
      }
      const { rows: reqRows } = await pool.query(
        'select * from match_requests where id = $1 limit 1',
        [requestId]
      );
      const ownerRow = reqRows[0] || null;
      authorize({ ...auth, profileId }, 'match:poll', { ownerProfileId: ownerRow?.profile_id });
      if (!ownerRow) {
        return error(reply, 'NOT_FOUND', 'Request not found', 404);
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
        conversationIdPresent: Boolean(sessionRow?.conversation_id),
        conversationIdPrefix: sessionRow?.conversation_id
          ? String(sessionRow.conversation_id).slice(0, 6)
          : null,
      }, 'match-poll session read');

      if (sessionRow) {
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
            peerLeancloudUserId: null,
            conversationId: null,
            reusedConversation: false,
            serverTime: new Date().toISOString(),
            reason: 'invalid_or_self_match',
            issuedJwt: auth.issuedJwt,
          });
        }
        if (sessionRow.conversation_id) {
          const response = {
            ...data,
            status: 'matched',
            conversationId: sessionRow.conversation_id,
            reusedConversation: true,
            issuedJwt: auth.issuedJwt,
          };
          if (response.session) {
            response.session = {
              ...response.session,
              conversation_id: sessionRow.conversation_id,
              status: 'matched',
            };
          }
          return ok(reply, response);
        }
        return ok(reply, {
          status: 'waiting',
          matchRequestId: requestId,
          matchSessionId: sessionRow.id,
          peerLeancloudUserId: data.peerLeancloudUserId ?? null,
          conversationId: null,
          reusedConversation: false,
          serverTime: new Date().toISOString(),
          reason: 'conversation_pending',
          issuedJwt: auth.issuedJwt,
        });
      }
      const response = {
        status: 'waiting',
        matchRequestId: requestId,
        matchSessionId: null,
        peerLeancloudUserId: null,
        conversationId: null,
        reusedConversation: false,
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
      return error(reply, 'SERVER_ERROR', err.message || 'Failed to poll match', status);
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
      if (sessionRow && sessionRow.conversation_id) {
        const data = await buildMatchedResponse(pool, sessionRow, profileId, requestId);
        if (data) {
          const response = {
            ...data,
            status: 'matched',
            conversationId: sessionRow.conversation_id,
            reusedConversation: true,
            issuedJwt: auth.issuedJwt,
          };
          if (response.session) {
            response.session = {
              ...response.session,
              conversation_id: sessionRow.conversation_id,
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
        conversationId: null,
        reusedConversation: false,
        serverTime: new Date().toISOString(),
        issuedJwt: auth.issuedJwt,
      });
    } catch (err) {
      req.log.error(err);
      const status = err.statusCode || 500;
      return error(reply, 'SERVER_ERROR', err.message || 'Failed to heartbeat match', status);
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
      return error(reply, 'SERVER_ERROR', err.message || 'Failed to cancel match', status);
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
    const { sessionId, conversationId, force = false } = req.body || {};
    if (!sessionId || !conversationId) {
      return error(reply, 'INVALID_REQUEST', 'sessionId and conversationId required', 400);
    }
    try {
      const { rows } = await pool.query(
        'select attach_conversation_to_session($1,$2,$3) as session',
        [sessionId, conversationId, force]
      );
      return ok(reply, { ...(rows[0]?.session || {}), issuedJwt: auth.issuedJwt });
    } catch (err) {
      req.log.error(err);
      const status = err.statusCode || 500;
      return error(reply, 'SERVER_ERROR', err.message || 'Failed to attach conversation', status);
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
        'select id, profile_a_id, profile_b_id, request_a_id, request_b_id, conversation_id from match_sessions where id = $1 limit 1',
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
        otherLeancloudUserId: otherProfile?.leancloud_user_id ?? null,
        conversationId: sessionRow.conversation_id ?? null,
        issuedJwt: auth.issuedJwt,
      });
    } catch (err) {
      req.log.error(err);
      const status = err.statusCode || 500;
      return error(reply, 'SERVER_ERROR', err.message || 'Failed to get partner', status);
    }
  });
}

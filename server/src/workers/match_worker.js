import pino from 'pino';
import { pool } from '../db/pool.js';
import { createOrReuseConversation } from '../services/leancloudConversation.js';

const logger = pino({ transport: { target: 'pino-pretty' } });

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_BATCH = 50;
let tickSeq = 0;

function workerMetadata() {
  return {
    version: process.env.APP_VERSION || process.env.GIT_SHA || 'unknown',
    dbHost: process.env.POSTGRES_HOST || process.env.PGHOST || null,
    dbPort: process.env.POSTGRES_PORT || process.env.PGPORT || null,
    dbUser: process.env.POSTGRES_USER || process.env.PGUSER || null,
    dbName: process.env.POSTGRES_DB || process.env.PGDATABASE || null,
    intervalMs: Number(process.env.MATCH_WORKER_INTERVAL_MS) || DEFAULT_INTERVAL_MS,
    batch: Number(process.env.MATCH_WORKER_BATCH) || DEFAULT_BATCH,
  };
}

async function fetchWaitingRequests(client, limit) {
  const { rows } = await client.query(
    `select id, profile_id
     from match_requests
     where status = 'waiting'
       and expires_at >= now()
     order by last_seen_at desc, created_at desc
     limit $1
     for update skip locked`,
    [limit]
  );
  return rows;
}

async function fetchPendingSessions(client, limit) {
  const { rows } = await client.query(
    `select id, profile_a_id, profile_b_id, conversation_id
     from match_sessions
     where conversation_id is null
       and status in ('pending', 'matched')
     order by created_at desc
     limit $1`,
    [limit]
  );
  return rows;
}

async function fetchLeancloudUserIds(client, profileA, profileB) {
  const { rows } = await client.query(
    `select id, leancloud_user_id
     from profiles
     where id = any($1::uuid[])`,
    [[profileA, profileB]]
  );
  const map = new Map(rows.map((r) => [r.id, r.leancloud_user_id]));
  return {
    leanA: map.get(profileA) || null,
    leanB: map.get(profileB) || null,
  };
}

async function attachConversation(client, sessionId, conversationId) {
  await client.query(
    'select attach_conversation_to_session($1,$2,$3)',
    [sessionId, conversationId, true]
  );
  await client.query(
    "update match_sessions set status = 'matched' where id = $1 and status <> 'matched'",
    [sessionId]
  );
}

async function runOnce() {
  const client = await pool.connect();
  const tickId = `tick_${Date.now()}_${tickSeq++}`;
  const tickStarted = Date.now();
  let waitingCount = 0;
  let pendingCount = 0;
  let candidateCount = 0;
  let attachedCount = 0;
  let errorCount = 0;
  try {
    await client.query('BEGIN');
    const limit = Number(process.env.MATCH_WORKER_BATCH) || DEFAULT_BATCH;
    const waiting = await fetchWaitingRequests(client, limit);
    waitingCount = waiting.length;
    await client.query('COMMIT');

    logger.info({
      event: 'worker.scan',
      tickId,
      scannedCount: waiting.length,
    }, 'match worker scan');

    for (const req of waiting) {
      candidateCount += 1;
      try {
        const { rows: sessions } = await client.query(
          'select * from try_match($1)',
          [req.id]
        );
        if (!sessions || sessions.length === 0) continue;
        const session = sessions[0];
        logger.debug({
          event: 'worker.candidate',
          tickId,
          sessionId: session.id,
          status: session.status,
          createdAt: session.created_at,
        }, 'match worker candidate');
        logger.info({
          event: 'worker.matched',
          requestId: req.id,
          sessionId: session.id,
        }, 'match worker matched');

        if (session.conversation_id) {
          await attachConversation(client, session.id, session.conversation_id);
          attachedCount += 1;
          continue;
        }

        const { leanA, leanB } = await fetchLeancloudUserIds(
          client,
          session.profile_a_id,
          session.profile_b_id
        );
        if (!leanA || !leanB) {
          logger.warn({
            event: 'worker.missing_leancloud',
            sessionId: session.id,
            profileA: session.profile_a_id,
            profileB: session.profile_b_id,
          }, 'match worker missing leancloud user id');
          continue;
        }

        const { conversationId, reused } = await createOrReuseConversation(
          [leanA, leanB],
          {
            logger,
            context: {
              matchSessionId: session.id,
              requestId: req.id,
              selfLeancloudUserId: leanA,
              peerLeancloudUserId: leanB,
            },
          }
        );

        await attachConversation(client, session.id, conversationId);
        attachedCount += 1;
        logger.info({
          event: 'worker.conversation_attached',
          sessionId: session.id,
          conversationId,
          reused,
        }, 'match worker conversation attached');
      } catch (err) {
        errorCount += 1;
        logger.error({
          event: 'worker.error',
          requestId: req.id,
          error: err.message,
          stack: err.stack,
          tickId,
        }, 'match worker error');
      }
    }

    const pendingSessions = await fetchPendingSessions(client, limit);
    pendingCount = pendingSessions.length;
    if (pendingSessions.length > 0) {
      logger.info({
        event: 'worker.pending_sessions',
        tickId,
        count: pendingSessions.length,
      }, 'match worker pending sessions');
    }

    for (const session of pendingSessions) {
      candidateCount += 1;
      try {
        logger.debug({
          event: 'worker.candidate',
          tickId,
          sessionId: session.id,
          status: session.status,
          createdAt: session.created_at,
        }, 'match worker candidate');
        const { leanA, leanB } = await fetchLeancloudUserIds(
          client,
          session.profile_a_id,
          session.profile_b_id
        );
        if (!leanA || !leanB) {
          logger.warn({
            event: 'worker.missing_leancloud',
            sessionId: session.id,
            profileA: session.profile_a_id,
            profileB: session.profile_b_id,
          }, 'match worker missing leancloud user id');
          continue;
        }

        const { conversationId, reused } = await createOrReuseConversation(
          [leanA, leanB],
          {
            logger,
            context: {
              matchSessionId: session.id,
              selfLeancloudUserId: leanA,
              peerLeancloudUserId: leanB,
            },
          }
        );

        await attachConversation(client, session.id, conversationId);
        attachedCount += 1;
        logger.info({
          event: 'worker.conversation_attached',
          sessionId: session.id,
          conversationId,
          reused,
        }, 'match worker conversation attached');
      } catch (err) {
        errorCount += 1;
        logger.error({
          event: 'worker.error',
          sessionId: session.id,
          error: err.message,
          stack: err.stack,
          tickId,
        }, 'match worker error');
      }
    }
  } catch (err) {
    errorCount += 1;
    logger.error({
      event: 'worker.run_once_failed',
      error: err.message,
      stack: err.stack,
      tickId,
    }, 'match worker runOnce failed');
  } finally {
    const elapsedMs = Date.now() - tickStarted;
    logger.info({
      event: 'worker.tick',
      tickId,
      scannedCount: waitingCount + pendingCount,
      waitingCount,
      pendingCount,
      candidateCount,
      attachedCount,
      errorCount,
      elapsedMs,
    }, 'match worker tick');
    client.release();
  }
}

export function startMatchWorker() {
  if (process.env.ENABLE_MATCH_WORKER !== '1') {
    logger.info({
      event: 'worker.disabled',
      enabled: false,
      ...workerMetadata(),
    }, 'match worker disabled');
    return;
  }
  const interval = Number(process.env.MATCH_WORKER_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  logger.info({
    event: 'worker.start',
    enabled: true,
    ...workerMetadata(),
  }, 'match worker started');
  runOnce();
  setInterval(runOnce, interval);
}

import pino from 'pino';
import { pool } from '../db/pool.js';
import { initRedis, getRedisClient } from '../services/redis.js';
import { initPushService, sendPushToTokens } from '../services/pushService.js';
import { pushStreamKey, sendToDlq } from '../services/pushQueue.js';
import { config } from '../config.js';

const logger = pino({ transport: { target: 'pino-pretty' } });
const GROUP = 'push-workers';
const CONSUMER = process.env.PUSH_WORKER_NAME || `push-${Math.random().toString(36).slice(2, 10)}`;
const DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60;

function parseFields(fields) {
  const out = {};
  for (let i = 0; i < fields.length; i += 2) {
    out[fields[i]] = fields[i + 1];
  }
  return out;
}

async function ensureGroup(client) {
  try {
    await client.xGroupCreate(pushStreamKey(), GROUP, '0', { MKSTREAM: true });
  } catch (err) {
    if (err?.code !== 'BUSYGROUP') {
      throw err;
    }
  }
}

async function fetchDeviceTokens(userId) {
  const { rows } = await pool.query(
    `select token
     from device_tokens
     where user_id = $1 and platform = 'android'`,
    [userId]
  );
  return rows.map((r) => r.token);
}

function backoffMs(attempt) {
  const base = config.push.baseBackoffMs;
  return Math.min(base * Math.pow(2, attempt), 60_000);
}

async function handleMessage(client, entryId, fields) {
  const payload = parseFields(fields);
  const now = Date.now();
  const availableAt = Number(payload.available_at_ms || now);
  if (availableAt > now) {
    await client.xAck(pushStreamKey(), GROUP, entryId);
    await client.xAdd(pushStreamKey(), '*', payload);
    return;
  }

  const msgId = payload.msg_id;
  const threadId = payload.thread_id;
  const seq = payload.seq;
  const toUserId = payload.to_user_id;
  const attempt = Number(payload.attempt || 0);
  const dedupKey = `im:push:sent:${msgId}:${toUserId}`;

  const already = await client.get(dedupKey);
  if (already) {
    await client.xAck(pushStreamKey(), GROUP, entryId);
    return;
  }

  const tokens = await fetchDeviceTokens(toUserId);
  if (!tokens.length) {
    await client.xAck(pushStreamKey(), GROUP, entryId);
    return;
  }

  const result = await sendPushToTokens({
    tokens,
    payload: {
      thread_id: threadId,
      seq: String(seq),
      msg_id: msgId,
    },
  });

  if (result.ok) {
    await client.setEx(dedupKey, DEDUP_TTL_SECONDS, '1');
    await client.xAck(pushStreamKey(), GROUP, entryId);
    return;
  }

  if (attempt + 1 >= config.push.maxRetries) {
    await sendToDlq({
      ...payload,
      error: result.error || 'send_failed',
      failed_at_ms: String(Date.now()),
    });
    await client.xAck(pushStreamKey(), GROUP, entryId);
    return;
  }

  const nextAttempt = attempt + 1;
  await client.xAck(pushStreamKey(), GROUP, entryId);
  await client.xAdd(pushStreamKey(), '*', {
    ...payload,
    attempt: String(nextAttempt),
    available_at_ms: String(Date.now() + backoffMs(nextAttempt)),
  });
}

async function main() {
  await initRedis({ logger });
  const client = getRedisClient();
  if (!client) {
    logger.error('Redis not available');
    process.exit(1);
  }
  initPushService({ logger });
  await ensureGroup(client);

  logger.info({ event: 'push.worker.start', consumer: CONSUMER }, 'Push worker started');
  while (true) {
    const res = await client.xReadGroup(
      GROUP,
      CONSUMER,
      [{ key: pushStreamKey(), id: '>' }],
      { COUNT: 10, BLOCK: 5000 }
    );
    if (!res) continue;
    for (const stream of res) {
      for (const message of stream.messages) {
        try {
          await handleMessage(client, message.id, message.message);
        } catch (err) {
          logger.error({ err: err?.message }, 'Push worker failed');
        }
      }
    }
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});

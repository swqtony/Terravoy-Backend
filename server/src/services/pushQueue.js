import { getRedisClient } from './redis.js';

const STREAM_KEY = 'im:push:queue';
const DLQ_KEY = 'im:push:dlq';

export function pushStreamKey() {
  return STREAM_KEY;
}

export function pushDlqKey() {
  return DLQ_KEY;
}

export async function enqueuePushJob({
  msgId,
  threadId,
  seq,
  toUserId,
  attempt = 0,
  availableAtMs = Date.now(),
}) {
  const client = getRedisClient();
  if (!client) return false;
  await client.xAdd(
    STREAM_KEY,
    '*',
    {
      msg_id: msgId,
      thread_id: threadId,
      seq: String(seq),
      to_user_id: toUserId,
      attempt: String(attempt),
      available_at_ms: String(availableAtMs),
    }
  );
  return true;
}

export async function sendToDlq(payload) {
  const client = getRedisClient();
  if (!client) return false;
  await client.xAdd(DLQ_KEY, '*', payload);
  return true;
}

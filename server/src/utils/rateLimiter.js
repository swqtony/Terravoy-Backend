import { getRedisClient } from '../services/redis.js';

const DEFAULT_WINDOW_MS = 60 * 1000;

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local max_hits = tonumber(ARGV[2])
local now = redis.call('TIME')
local now_ms = (now[1] * 1000) + math.floor(now[2] / 1000)
local window_start = now_ms - window_ms
redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
local count = redis.call('ZCARD', key)
if count >= max_hits then
  local earliest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldest = tonumber(earliest[2]) or now_ms
  local retry_after_ms = oldest + window_ms - now_ms
  if retry_after_ms < 0 then retry_after_ms = 0 end
  return {0, retry_after_ms}
end
redis.call('ZADD', key, now_ms, tostring(now_ms))
redis.call('PEXPIRE', key, window_ms + 1000)
return {1, 0}
`;

class InMemoryLimiter {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
  }

  check(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = this.hits.get(key) || [];
    let idx = 0;
    while (idx < timestamps.length && timestamps[idx] <= windowStart) {
      idx += 1;
    }
    const active = idx > 0 ? timestamps.slice(idx) : timestamps;
    if (active.length >= this.max) {
      const retryAfterMs = Math.max(0, active[0] + this.windowMs - now);
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }
    active.push(now);
    this.hits.set(key, active);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export class SlidingWindowRateLimiter {
  constructor({ windowMs = DEFAULT_WINDOW_MS, max = 60 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.fallback = new InMemoryLimiter({ windowMs, max });
  }

  async check(key) {
    const client = getRedisClient();
    if (!client) {
      return this.fallback.check(key);
    }
    try {
      const result = await client.eval(SLIDING_WINDOW_LUA, {
        keys: [key],
        arguments: [this.windowMs.toString(), this.max.toString()],
      });
      const allowed = Number(result?.[0]) === 1;
      const retryAfterMs = Number(result?.[1] || 0);
      return {
        allowed,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    } catch (_err) {
      return this.fallback.check(key);
    }
  }
}

import { createClient } from 'redis';
import { config } from '../config.js';

let redisClient = null;
let redisReady = false;

export function getRedisClient() {
  return redisReady ? redisClient : null;
}

export async function initRedis({ logger } = {}) {
  if (redisClient) return redisClient;
  if (!config.redis.url) {
    if (logger?.warn) {
      logger.warn({ event: 'redis.disabled' }, 'Redis URL not set, skipping');
    }
    return null;
  }
  redisClient = createClient({
    url: config.redis.url,
    socket: {
      connectTimeout: config.redis.connectTimeoutMs,
      reconnectStrategy: (retries) => {
        if (retries > config.redis.maxRetries) return new Error('Redis retry limit exceeded');
        return Math.min(retries * 100, 2000);
      },
    },
  });

  redisClient.on('error', (err) => {
    redisReady = false;
    if (logger?.error) {
      logger.error({ event: 'redis.error', err: err?.message }, 'Redis error');
    }
  });
  redisClient.on('ready', () => {
    redisReady = true;
    if (logger?.info) {
      logger.info({ event: 'redis.ready' }, 'Redis ready');
    }
  });
  redisClient.on('end', () => {
    redisReady = false;
    if (logger?.warn) {
      logger.warn({ event: 'redis.end' }, 'Redis connection closed');
    }
  });

  try {
    await redisClient.connect();
  } catch (err) {
    redisReady = false;
    if (logger?.error) {
      logger.error({ event: 'redis.connect_failed', err: err?.message }, 'Redis connect failed');
    }
  }
  return redisClient;
}

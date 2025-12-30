import { initRedis, getRedisClient } from '../server/src/services/redis.js';
import { SlidingWindowRateLimiter } from '../server/src/utils/rateLimiter.js';

async function main() {
  await initRedis({ logger: console });
  const client = getRedisClient();
  if (!client) {
    console.error('Redis client not ready.');
    process.exit(1);
  }

  const limiter = new SlidingWindowRateLimiter({ windowMs: 2000, max: 2 });
  const key = 'im:rate:user:smoke';
  const first = await limiter.check(key);
  const second = await limiter.check(key);
  const third = await limiter.check(key);
  const ttl = await client.pttl(key);

  console.log({ first, second, third, ttlMs: ttl });
  await client.del(key);
  await client.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

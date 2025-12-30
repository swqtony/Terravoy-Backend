# IM Redis Preflight

## Single Instance
- Presence: gateway writes `im:online:{user_id}` with TTL 75s and refreshes every 30s.
- Rate limit: API/gateway uses Redis sliding window (zset) per user/thread.
- Restart behavior: presence may drop briefly; TTL converges after reconnect.

## Multi Instance
- Presence: each gateway instance refreshes per-connection; presence is shared by Redis.
- Rate limit: global enforcement across instances (no per-instance drift).
- Failure mode: Redis outage falls back to in-memory limiter in API (best-effort).

## Local Verification
1) Start stack: `docker compose up -d`
2) Run smoke check: `node tools/redis_rate_limit_smoke.js`
3) Expected: first two allowed, third blocked, TTL > 0

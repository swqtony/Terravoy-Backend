# IM Migration Summary

## Removed Node IM Files
- `server/src/routes/chat.js`
- `server/src/routes/push.js`
- `server/src/workers/push_worker.js`
- `server/src/services/redis.js`
- `server/src/services/metrics.js`
- `server/src/services/pushQueue.js`
- `server/src/services/pushService.js`
- `server/src/utils/rateLimiter.js` (IM Redis variant removed; reverted to in-memory)
- `tools/redis_rate_limit_smoke.js`

## Added Go IM Files
- `im/im-api/main.go`
- `im/im-api/go.mod`
- `im/im-api/Dockerfile`
- `im/im-worker/main.go`
- `im/im-worker/go.mod`
- `im/im-worker/Dockerfile`
- `im/docker-compose.im.yml`
- `im/scripts/migrate.sh`
- `im-gateway/main.go` (updated to use Go im-api)

## Updated Files
- `docker-compose.yml` (Node stack trimmed)
- `Makefile` (im-up/im-down/im-migrate)
- IM docs migrated to Go

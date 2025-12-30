# IM Migration Audit

## Node IM Files (current)
- `server/src/routes/chat.js`
- `server/src/routes/push.js`
- `server/src/workers/push_worker.js`
- `server/src/services/redis.js`
- `server/src/utils/rateLimiter.js`
- `server/src/routes/media.js` (im_message scope)
- `server/src/services/metrics.js`

## Go Gateway Files (current)
- `im-gateway/main.go`
- `im-gateway/go.mod`
- `im-gateway/Dockerfile`

## DB Migrations
- `db/migrations/0021_chat_threads.sql`
  - `chat_threads`, `chat_thread_members`
- `db/migrations/0022_chat_messages.sql`
  - `chat_messages` + sender/client idempotency
- `db/migrations/0023_device_tokens.sql`
  - `device_tokens`

## IM Docs
- `docs/IM_THREAD_MODEL.md`
- `docs/IM_MESSAGE_SEMANTICS.md`
- `docs/IM_MEDIA_FLOW.md`
- `docs/IM_GATEWAY.md`
- `docs/IM_REDIS_PREFLIGHT.md`
- `docs/REDIS_KEYS.md`
- `docs/PUSH_FCM_SETUP.md`
- `docs/OBSERVABILITY.md`
- `IM_IMPLEMENTATION_GUIDE.md`
- `IM_PREFLIGHT_TO_PROD_REPORT.md`

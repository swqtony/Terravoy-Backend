# IM Implementation Guide

## Architecture
- API server (Node): threads/messages/media/push token APIs
- Postgres: thread/message storage + idempotency
- Redis: presence + rate limit + push queue
- Push worker (Node): FCM delivery + retries + DLQ
- IM Gateway (Go): WebSocket, auth, rate limit, fanout

## Auth Model
- IM APIs and gateway accept Bearer access token only (`AUTH_JWT_SECRET`)
- Legacy LeanCloud session token is not supported for IM

## Local Startup
1) `docker compose up -d --build`
2) `docker compose exec api npm run db:migrate`
3) Optional Redis smoke: `node tools/redis_rate_limit_smoke.js`

## Gateway Access
- WS: `ws://localhost:8081/ws`
- Metrics: `http://localhost:8081/metrics`

## API Access
- Threads: `POST /chat/threads/ensure`, `GET /chat/threads`
- Messages: `POST /chat/messages`, `GET /chat/threads/:id/messages`
- Media: `POST /v1/media/upload-url`, `POST /v1/media/complete`
- Push token: `POST /push/token`
- Metrics: `GET /metrics`

## Acceptance Use Cases
1) Ensure thread (match or order) and confirm idempotency
2) Gateway auth → sub → msg → ack
3) Offline user push triggered (check push worker logs)
4) Image message flow: upload-url → complete → send `type=image`
5) Read state update: `read` event → unread count decreases

## Troubleshooting
- Redis down: rate limit/presence falls back (API) or disabled (gateway)
- Gateway send failures: check `/metrics` + logs
- Push failures: inspect Redis stream `im:push:dlq`

# IM Implementation Guide (Go)

## Architecture
- im-api (Go): threads/messages/media/push token APIs
- im-worker (Go): FCM push + retention cleanup
- im-gateway (Go): WebSocket realtime gateway
- Postgres: message storage + sequencing + idempotency
- Redis: presence + rate limit + push stream

## Auth Model
- IM accepts Bearer access token only (`AUTH_JWT_SECRET`)
- Legacy LeanCloud session tokens are not accepted

## Local Startup
1) `make im-up`
2) `make im-migrate`

## Endpoints
- im-api health: `http://localhost:8090/health`
- im-api metrics: `http://localhost:8090/metrics`
- gateway WS: `ws://localhost:8081/ws`
- gateway metrics: `http://localhost:8081/metrics`

## Core APIs (im-api)
- `POST /v1/threads/ensure`
- `GET /v1/threads` (includes `unread_count`, `last_message_preview`)
- `GET /v1/threads/{id}/messages?afterSeq&beforeSeq&limit`
- `POST /v1/threads/{id}/read`
- `POST /v1/messages`
- `POST /v1/push/token`
- `POST /v1/media/upload-url` (scope=im_message)

## Acceptance Use Cases
1) Ensure thread (match + order) and confirm idempotency
2) Gateway auth → sub → msg → ack
3) Offline push: enqueue stream + worker consumes
4) Image message: upload-url → send `type=image`
5) Read state update: `read` event → unread decreases

## Troubleshooting
- Redis down: presence/rate limit/push disabled
- FCM failure: check `im:push:dlq`
- Metrics: check `/metrics` on im-api and im-gateway

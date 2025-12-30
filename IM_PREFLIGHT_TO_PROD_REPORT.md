# IM Preflight to Prod Report (Go)

## Covered Items
- Go im-api for threads/messages/media/push tokens
- Go im-gateway for realtime WS + presence + rate limit
- Go im-worker for FCM push + retention cleanup
- Redis streams for push queue + DLQ
- Postgres sequencing + idempotency
- Prometheus metrics on im-api and gateway

## Remaining Risks
- Go module dependencies not verified in this environment (no Go toolchain here)
- FCM delivery depends on valid service account

## Start
- `make im-up`
- `make im-migrate`

## E2E
- Ensure match/order thread
- Send message + idempotency retry
- Fetch afterSeq and confirm truncation flags
- Read update
- Push stream enqueue and worker consumption

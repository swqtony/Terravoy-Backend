# IM Preflight to Prod Report

## Covered NEEDS_FIXES
- Redis-based rate limit and presence keys
- Explicit chat thread model and membership
- Message storage with seq + idempotency
- IM media upload scope
- FCM push worker + device tokens
- Gateway skeleton (auth/sub/msg/read/presence/limit/metrics)
- Observability (JSON logs in prod, traceId, metrics)

## Deferred / Risks
- Go module dependencies not verified locally (Go toolchain missing in environment)
- Multi-instance fanout uses Redis presence only (no cross-gateway routing)
- Push payload is data-only; client routing behavior TBD

## One-Click Start
- `docker compose up -d --build`
- `docker compose exec api npm run db:migrate`

## E2E Acceptance
1) Match thread:
   - `POST /chat/threads/ensure` with `type=match`
2) Order thread:
   - `POST /chat/threads/ensure` with `type=order`
3) Offline push:
   - Register token → send message → verify worker log or DLQ
4) Image message:
   - `/v1/media/upload-url` → upload → `/v1/media/complete` → send `type=image`

## Deployment Notes
- Single instance: gateway + api + redis + db
- Multi-instance: keep Redis shared for presence/limits; add LB for gateway

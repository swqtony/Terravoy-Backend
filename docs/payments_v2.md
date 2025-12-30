Payments v2 (Webhook-first)
===========================

Goals
-----
- Payment/Refund final state is updated only via webhook or reconciliation.
- End-to-end idempotency across client, server, and database.
- Mock provider now, real provider later with a switch.

State model
-----------
- orders.payment_status: UNPAID | PAID | REFUNDING | REFUNDED
- orders.last_payment_attempt_status: processing | failed | requires_action | succeeded
- orders.refund_status: requested | processing | succeeded | failed

Core endpoints
--------------
- POST /payments/create_intent
  - Request: { orderId, amount, currency, idempotencyKey, metadata? }
  - Response: { intentId, status, amount, currency, clientSecret }

- POST /payments/confirm
  - Request: { intentId, idempotencyKey, method?, simulate? }
  - Response: { status: processing | failed | requires_action, attemptId }
  - Behavior: write payment_attempts, call provider, do not update orders.payment_status.

- POST /payments/refund
  - Request: { orderId, amount?, reason?, idempotencyKey }
  - Response: { refundId, status: requested | processing }
  - Behavior: create refund record, update orders.payment_status=REFUNDING and refund_status.

- POST /payments/refund/retry
  - Request: { refundId, idempotencyKey? }
  - Response: { refundId, status }
  - Behavior: retry provider refund for failed/processing refunds.

- POST /payments/webhook
  - Request: provider webhook payload + signature
  - Response: { ok: true }
  - Behavior: verify signature, insert webhook_events (idempotent), update intents/payments/refunds/orders.

- GET /orders/{id}/payments
  - Response: { attempts: [], payments: [], refunds: [] }

Webhook event schema (normalized)
---------------------------------
{
  event_id: string,
  type: string,
  provider: string,
  created_at: string,
  data: {
    order_id: number,
    intent_id: number,
    amount: number,
    currency: string,
    status: string,
    provider_txn_id?: string,
    refund_id?: string
  }
}

Idempotency rules
-----------------
- payment_intents: unique (order_id, idempotency_key)
- payment_attempts: unique (intent_id, idempotency_key)
- refunds: unique (order_id, idempotency_key)
- webhook_events: unique (provider, event_id)

Webhook-only toggle
-------------------
- `PAYMENTS_WEBHOOK_ONLY=1` keeps order/payment/refund finalization webhook-first.
- Set to `0` to allow synchronous finalization when providers return immediate success/failure.

Mock provider behavior
----------------------
- create_intent returns a mock provider intent id and client secret.
- confirm returns status=processing and can auto-fire a webhook event.
- refund returns status=processing and can auto-fire a webhook event.

Provider switch (placeholder)
-----------------------------
- Set `PAYMENT_PROVIDER=wechat` or `PAYMENT_PROVIDER=alipay` to switch.
- Fill env vars in `.env` (see `.env.example` placeholders).
- Real provider methods are stubbed and must be implemented before production use.

Metrics (log-based)
-------------------
- payments.webhook.processed / payments.webhook.failed
- payments.status.succeeded / payments.status.failed
- payments.refund.succeeded / payments.refund.failed

Reconciliation jobs
-------------------
- Replay failed webhook_events.
- Repair: if payment succeeded but order.payment_status != PAID, update via event handler.

Production rollout checklist
----------------------------
- Run migrations: `0009_payments_v2.sql` and `0010_payments_idx.sql`.
- Run preflight queries: `tools/payments_preflight.sql`.
- Configure jobs and intent expiry in `.env` (see `.env.example`).
- Set `PAYMENTS_WEBHOOK_ONLY=1` for webhook-first rollout.
- Monitor logs for `payments.jobs` and webhook processing errors.

Rollback notes
--------------
- Disable jobs by setting `PAYMENTS_JOB_REPLAY_INTERVAL_MIN=0`,
  `PAYMENTS_JOB_RECONCILE_INTERVAL_MIN=0`, and `PAYMENTS_JOB_CLEANUP_INTERVAL_MIN=0`.
- Keep `PAYMENTS_WEBHOOK_ONLY=1` to avoid sync finalization.
- Investigate and fix failed webhook events before re-enabling jobs.

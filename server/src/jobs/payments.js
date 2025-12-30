import { initPaymentsService } from '../services/payments/index.js';
import { WebhookEventTypes } from '../services/payments/providerInterface.js';

const DEFAULT_LIMIT = 100;

function createReconcileEvent(payment) {
  return {
    eventId: `reconcile_payment_${payment.id}`,
    type: WebhookEventTypes.PAYMENT_SUCCEEDED,
    provider: payment.provider,
    createdAt: payment.created_at || new Date().toISOString(),
    data: {
      providerIntentId: payment.provider_intent_id,
      providerTxnId: payment.provider_txn_id,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: 'succeeded',
      metadata: payment.intent_metadata || {},
    },
  };
}

async function storeWebhookEvent(pool, provider, event) {
  const payload = { ...event.data, _originalCreatedAt: event.createdAt };
  const result = await pool.query(
    `INSERT INTO webhook_events
     (provider, event_id, event_type, payload, status, received_at)
     VALUES ($1, $2, $3, $4, 'received', now())
     ON CONFLICT (provider, event_id) DO NOTHING
     RETURNING id`,
    [provider, event.eventId, event.type, JSON.stringify(payload)]
  );

  if (result.rows.length > 0) {
    return { id: result.rows[0].id, isNew: true };
  }

  const { rows } = await pool.query(
    `SELECT id, status FROM webhook_events WHERE provider = $1 AND event_id = $2`,
    [provider, event.eventId]
  );
  return { id: rows[0]?.id, isNew: false, status: rows[0]?.status };
}

async function markWebhookEvent(pool, eventId, status, errorMessage = null) {
  await pool.query(
    `UPDATE webhook_events
     SET status = $2, processed_at = now(), last_error = $3
     WHERE id = $1`,
    [eventId, status, errorMessage]
  );
}

export async function replayFailedWebhooks({ pool, logger, maxRetries = 3, limit = DEFAULT_LIMIT }) {
  const paymentsService = initPaymentsService({ pool, logger });
  const result = await paymentsService.retryFailedEvents(maxRetries, limit);
  if (result.processed || result.failed) {
    logger.info({ event: 'payments.webhook.retry', ...result }, 'Retried failed webhook events');
  }
  return result;
}

export async function reconcileSucceededPayments({ pool, logger, limit = DEFAULT_LIMIT }) {
  const paymentsService = initPaymentsService({ pool, logger });
  const { rows } = await pool.query(
    `SELECT p.*, pi.provider_intent_id, pi.metadata as intent_metadata
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     LEFT JOIN payment_intents pi ON pi.id = p.intent_id
     WHERE p.status = 'succeeded' AND o.payment_status <> 'PAID'
     ORDER BY p.created_at ASC
     LIMIT $1`,
    [limit]
  );

  let processed = 0;
  let failed = 0;

  for (const payment of rows) {
    const event = createReconcileEvent(payment);
    const stored = await storeWebhookEvent(pool, event.provider, event);
    if (!stored.id) {
      failed += 1;
      continue;
    }
    if (!stored.isNew && stored.status === 'processed') {
      continue;
    }

    try {
      await paymentsService.eventProcessor.processEvent(event, stored.id);
      await markWebhookEvent(pool, stored.id, 'processed');
      await pool.query(
        `UPDATE webhook_events SET payment_id = $2 WHERE id = $1 AND payment_id IS NULL`,
        [stored.id, payment.id]
      );
      processed += 1;
    } catch (err) {
      await markWebhookEvent(pool, stored.id, 'failed', err.message);
      failed += 1;
    }
  }

  if (processed || failed) {
    logger.info({ event: 'payments.reconcile.succeeded', processed, failed }, 'Reconciled succeeded payments');
  }

  return { processed, failed };
}

export async function cleanupExpiredIntents({
  pool,
  logger,
  cutoffMinutes = 60,
  limit = DEFAULT_LIMIT,
}) {
  const { rows: intents } = await pool.query(
    `SELECT pi.*, o.payment_status
     FROM payment_intents pi
     JOIN orders o ON o.id = pi.order_id
     WHERE pi.status IN ('requires_confirmation', 'processing', 'requires_action')
       AND pi.updated_at < now() - ($1::text || ' minutes')::interval
       AND o.payment_status <> 'PAID'
     ORDER BY pi.updated_at ASC
     LIMIT $2`,
    [cutoffMinutes, limit]
  );

  let cleaned = 0;

  for (const intent of intents) {
    await pool.query(
      `UPDATE payment_intents
       SET status = 'failed', last_error = 'INTENT_EXPIRED', updated_at = now()
       WHERE id = $1`,
      [intent.id]
    );

    await pool.query(
      `INSERT INTO payment_attempts
       (order_id, intent_id, provider, status, amount, currency, error_code, error_message, actor_role)
       VALUES ($1, $2, $3, 'failed', $4, $5, 'INTENT_EXPIRED', 'Intent expired', 'SYSTEM')`,
      [intent.order_id, intent.id, intent.provider, intent.amount, intent.currency]
    );

    await pool.query(
      `UPDATE orders
       SET last_payment_attempt_status = 'failed',
           last_payment_attempt_at = now()
       WHERE id = $1`,
      [intent.order_id]
    );

    cleaned += 1;
  }

  if (cleaned) {
    logger.info({ event: 'payments.intent.cleanup', cleaned }, 'Cleaned expired payment intents');
  }

  return { cleaned };
}

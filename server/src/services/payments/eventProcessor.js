/**
 * Event Processor
 * 
 * Processes normalized webhook events and updates database state:
 * - payment_intents
 * - payments
 * - refunds
 * - orders
 */

import { WebhookEventTypes } from './providerInterface.js';

/**
 * EventProcessor handles state updates from webhook events.
 */
export class EventProcessor {
    /**
     * @param {Object} deps
     * @param {import('pg').Pool} deps.pool - Database pool
     * @param {Object} [deps.logger] - Logger instance
     */
    constructor({ pool, logger }) {
        this.pool = pool;
        this.logger = logger || console;
    }

    /**
     * Process a normalized webhook event.
     * 
     * @param {import('./providerInterface.js').NormalizedWebhookEvent} event
     * @param {number} webhookEventId - DB ID of the webhook_events record
     */
    async processEvent(event, webhookEventId) {
        const { type, data, provider } = event;

        this.logger.info(`[EventProcessor] Processing ${type} from ${provider}`);

        switch (type) {
            case WebhookEventTypes.PAYMENT_SUCCEEDED:
                await this._handlePaymentSucceeded(event, webhookEventId);
                break;
            case WebhookEventTypes.PAYMENT_FAILED:
                await this._handlePaymentFailed(event, webhookEventId);
                break;
            case WebhookEventTypes.PAYMENT_REQUIRES_ACTION:
                await this._handlePaymentRequiresAction(event, webhookEventId);
                break;
            case WebhookEventTypes.REFUND_SUCCEEDED:
                await this._handleRefundSucceeded(event, webhookEventId);
                break;
            case WebhookEventTypes.REFUND_FAILED:
                await this._handleRefundFailed(event, webhookEventId);
                break;
            default:
                this.logger.warn(`[EventProcessor] Unknown event type: ${type}`);
        }
    }

    /**
     * Handle successful payment.
     * @private
     */
    async _handlePaymentSucceeded(event, webhookEventId) {
        const { data, provider } = event;
        const { providerIntentId, providerTxnId, amount, currency, metadata } = data;

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Find the intent by provider_intent_id
            const { rows: intents } = await client.query(
                `SELECT pi.*, o.id as order_id, o.status as order_status, o.payment_status
         FROM payment_intents pi
         JOIN orders o ON o.id = pi.order_id
         WHERE pi.provider_intent_id = $1`,
                [providerIntentId]
            );

            if (intents.length === 0) {
                // Try to find by looking up recent intents with matching provider
                const { rows: fallback } = await client.query(
                    `SELECT pi.*, o.id as order_id, o.status as order_status, o.payment_status
           FROM payment_intents pi
           JOIN orders o ON o.id = pi.order_id
           WHERE pi.provider = $1 AND pi.status = 'processing'
           ORDER BY pi.created_at DESC
           LIMIT 1`,
                    [provider]
                );
                if (fallback.length === 0) {
                    throw new Error(`Intent not found for provider_intent_id: ${providerIntentId}`);
                }
                intents.push(fallback[0]);
            }

            const intent = intents[0];
            const orderId = intent.order_id;

            // 2. Update payment_intent
            await client.query(
                `UPDATE payment_intents 
         SET status = 'succeeded', confirmed_at = now(), updated_at = now()
         WHERE id = $1`,
                [intent.id]
            );

            // 3. Insert payment record
            const { rows: payments } = await client.query(
                `INSERT INTO payments 
         (order_id, intent_id, provider, provider_txn_id, status, amount, currency, raw_payload)
         VALUES ($1, $2, $3, $4, 'succeeded', $5, $6, $7)
         ON CONFLICT (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL DO NOTHING
         RETURNING id`,
                [orderId, intent.id, provider, providerTxnId, amount, currency, JSON.stringify(data)]
            );

            const paymentId = payments[0]?.id;

            // 4. Update order
            const nextStatus = intent.order_status === 'PENDING_PAYMENT'
                ? 'PENDING_HOST_CONFIRM'
                : intent.order_status;

            await client.query(
                `UPDATE orders 
         SET payment_status = 'PAID', 
             status = $2,
             paid_at = now(),
             payment_intent_id = $3,
             payment_provider = $4,
             last_payment_attempt_status = 'succeeded',
             last_payment_attempt_at = now()
         WHERE id = $1`,
                [orderId, nextStatus, intent.id, provider]
            );

            // 5. Log status change if needed
            if (nextStatus !== intent.order_status) {
                await client.query(
                    `INSERT INTO order_status_logs 
           (order_id, from_status, to_status, actor_role, reason)
           VALUES ($1, $2, $3, 'SYSTEM', 'PAYMENT_WEBHOOK_CONFIRMED')`,
                    [orderId, intent.order_status, nextStatus]
                );
            }

            // 6. Update webhook_events with references
            await client.query(
                `UPDATE webhook_events 
         SET order_id = $2, intent_id = $3, payment_id = $4
         WHERE id = $1`,
                [webhookEventId, orderId, intent.id, paymentId]
            );

            await client.query('COMMIT');
            this.logger.info(`[EventProcessor] Payment succeeded for order ${orderId}`);
            this.logger.info({
                event: 'payments.status.succeeded',
                provider,
                orderId,
                paymentId,
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * Handle failed payment.
     * @private
     */
    async _handlePaymentFailed(event, webhookEventId) {
        const { data, provider } = event;
        const { providerIntentId, errorCode, errorMessage } = data;

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Find the intent
            const { rows: intents } = await client.query(
                `SELECT pi.*, o.id as order_id
         FROM payment_intents pi
         JOIN orders o ON o.id = pi.order_id
         WHERE pi.provider_intent_id = $1
         OR (pi.provider = $2 AND pi.status = 'processing')
         ORDER BY pi.created_at DESC
         LIMIT 1`,
                [providerIntentId, provider]
            );

            if (intents.length === 0) {
                throw new Error(`Intent not found for failed payment: ${providerIntentId}`);
            }

            const intent = intents[0];

            // Update intent
            await client.query(
                `UPDATE payment_intents 
         SET status = 'failed', last_error = $2, updated_at = now()
         WHERE id = $1`,
                [intent.id, errorMessage || errorCode]
            );

            // Update order
            await client.query(
                `UPDATE orders 
         SET last_payment_attempt_status = 'failed',
             last_payment_attempt_at = now()
         WHERE id = $1`,
                [intent.order_id]
            );

            // Record payment attempt
            await client.query(
                `INSERT INTO payment_attempts 
         (order_id, intent_id, provider, status, amount, currency, error_code, error_message)
         VALUES ($1, $2, $3, 'failed', $4, $5, $6, $7)`,
                [intent.order_id, intent.id, provider, intent.amount, intent.currency, errorCode, errorMessage]
            );

            // Update webhook_events
            await client.query(
                `UPDATE webhook_events 
         SET order_id = $2, intent_id = $3
         WHERE id = $1`,
                [webhookEventId, intent.order_id, intent.id]
            );

            await client.query('COMMIT');
            this.logger.info(`[EventProcessor] Payment failed for order ${intent.order_id}`);
            this.logger.info({
                event: 'payments.status.failed',
                provider,
                orderId: intent.order_id,
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * Handle payment requiring additional action.
     * @private
     */
    async _handlePaymentRequiresAction(event, webhookEventId) {
        const { data, provider } = event;
        const { providerIntentId } = data;

        const { rows: intents } = await this.pool.query(
            `SELECT id, order_id FROM payment_intents 
       WHERE provider_intent_id = $1
       OR (provider = $2 AND status = 'processing')
       ORDER BY created_at DESC LIMIT 1`,
            [providerIntentId, provider]
        );

        if (intents.length > 0) {
            const intent = intents[0];
            await this.pool.query(
                `UPDATE payment_intents SET status = 'requires_action', updated_at = now() WHERE id = $1`,
                [intent.id]
            );
            await this.pool.query(
                `UPDATE orders SET last_payment_attempt_status = 'requires_action' WHERE id = $1`,
                [intent.order_id]
            );
        }
    }

    /**
     * Handle successful refund.
     * @private
     */
    async _handleRefundSucceeded(event, webhookEventId) {
        const { data, provider } = event;
        const { providerRefundId, providerTxnId, amount } = data;

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Find the refund by provider_refund_id or recent processing refund
            const { rows: refunds } = await client.query(
                `SELECT r.*, o.id as order_id
         FROM refunds r
         JOIN orders o ON o.id = r.order_id
         WHERE r.provider_refund_id = $1 
         OR (r.provider = $2 AND r.status = 'processing')
         ORDER BY r.created_at DESC
         LIMIT 1`,
                [providerRefundId, provider]
            );

            if (refunds.length === 0) {
                throw new Error(`Refund not found: ${providerRefundId}`);
            }

            const refund = refunds[0];

            // Update refund
            await client.query(
                `UPDATE refunds 
         SET status = 'succeeded', processed_at = now(), provider_refund_id = $2
         WHERE id = $1`,
                [refund.id, providerRefundId]
            );

            // Update order
            await client.query(
                `UPDATE orders 
         SET payment_status = 'REFUNDED',
             refund_status = 'succeeded',
             refund_amount = $2,
             refund_at = now()
         WHERE id = $1`,
                [refund.order_id, amount || refund.amount]
            );

            // Update webhook_events
            await client.query(
                `UPDATE webhook_events SET order_id = $2, refund_id = $3 WHERE id = $1`,
                [webhookEventId, refund.order_id, refund.id]
            );

            await client.query('COMMIT');
            this.logger.info(`[EventProcessor] Refund succeeded for order ${refund.order_id}`);
            this.logger.info({
                event: 'payments.refund.succeeded',
                provider,
                orderId: refund.order_id,
                refundId: refund.id,
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * Handle failed refund.
     * @private
     */
    async _handleRefundFailed(event, webhookEventId) {
        const { data, provider } = event;
        const { providerRefundId, errorCode, errorMessage } = data;

        const { rows: refunds } = await this.pool.query(
            `SELECT id, order_id FROM refunds 
       WHERE provider_refund_id = $1 
       OR (provider = $2 AND status = 'processing')
       ORDER BY created_at DESC LIMIT 1`,
            [providerRefundId, provider]
        );

        if (refunds.length > 0) {
            const refund = refunds[0];
            await this.pool.query(
                `UPDATE refunds SET status = 'failed', last_error = $2 WHERE id = $1`,
                [refund.id, errorMessage || errorCode]
            );
            await this.pool.query(
                `UPDATE orders SET refund_status = 'failed' WHERE id = $1`,
                [refund.order_id]
            );
            this.logger.info({
                event: 'payments.refund.failed',
                provider,
                orderId: refund.order_id,
                refundId: refund.id,
                error: errorMessage || errorCode || 'unknown',
            });
        }
    }
}

export default EventProcessor;

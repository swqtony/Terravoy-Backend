/**
 * Webhook Handler
 * 
 * Handles incoming webhooks from payment providers:
 * 1. Verifies signature
 * 2. Stores event idempotently in webhook_events
 * 3. Dispatches to event processor
 */

import { WebhookEventTypes } from './providerInterface.js';

/**
 * WebhookHandler manages webhook reception and idempotent processing.
 */
export class WebhookHandler {
    /**
     * @param {Object} deps
     * @param {import('pg').Pool} deps.pool - Database pool
     * @param {Object} deps.providers - Map of provider name -> provider instance
     * @param {import('./eventProcessor.js').EventProcessor} deps.eventProcessor
     * @param {Object} [deps.logger] - Logger instance
     */
    constructor({ pool, providers, eventProcessor, logger }) {
        this.pool = pool;
        this.providers = providers;
        this.eventProcessor = eventProcessor;
        this.logger = logger || console;
    }

    /**
     * Handle an incoming webhook.
     * 
     * @param {Object} params
     * @param {string} params.providerName - Provider name (e.g., 'mock', 'stripe')
     * @param {string|Buffer} params.rawPayload - Raw request body
     * @param {string} params.signature - Signature from header
     * @returns {Promise<{ok: boolean, error?: string, eventId?: string}>}
     */
    async handleWebhook({ providerName, rawPayload, signature }) {
        const provider = this.providers[providerName];
        if (!provider) {
            this.logger.warn(`[WebhookHandler] Unknown provider: ${providerName}`);
            return { ok: false, error: 'Unknown provider' };
        }

        // 1. Verify signature
        const verification = provider.parseWebhook
            ? await provider.parseWebhook({ payload: rawPayload, signature })
            : await provider.verifyWebhook({ payload: rawPayload, signature });
        if (!verification.valid) {
            this.logger.warn(`[WebhookHandler] Invalid signature for ${providerName}: ${verification.error}`);
            this.logger.info({
                event: 'payments.webhook.invalid',
                provider: providerName,
                error: verification.error || 'invalid_signature',
            });
            return { ok: false, error: verification.error || 'Invalid signature' };
        }

        const event = verification.normalizedEvent;
        if (!event || !event.eventId) {
            return { ok: false, error: 'Missing eventId in webhook payload' };
        }

        // 2. Store event idempotently
        const stored = await this._storeEvent(providerName, event, signature);
        if (!stored.isNew) {
            // Already processed
            this.logger.info(`[WebhookHandler] Duplicate event ${event.eventId}, skipping`);
            return { ok: true, eventId: event.eventId, duplicate: true };
        }

        // 3. Process the event
        try {
            await this.eventProcessor.processEvent(event, stored.dbEventId);

            // Mark as processed
            await this._markProcessed(stored.dbEventId, 'processed');

            this.logger.info({
                event: 'payments.webhook.processed',
                provider: providerName,
                eventId: event.eventId,
                type: event.type,
            });
            return { ok: true, eventId: event.eventId };
        } catch (err) {
            this.logger.error(`[WebhookHandler] Error processing event ${event.eventId}:`, err);

            // Mark as failed for retry
            await this._markProcessed(stored.dbEventId, 'failed', err.message);

            this.logger.info({
                event: 'payments.webhook.failed',
                provider: providerName,
                eventId: event.eventId,
                type: event.type,
                error: err.message,
            });
            return { ok: false, error: 'Processing failed' };
        }
    }

    /**
     * Store webhook event idempotently.
     * @private
     */
    async _storeEvent(providerName, event, signature) {
        const { eventId, type, createdAt, data } = event;

        // Try to insert, ON CONFLICT returns nothing (already exists)
        const result = await this.pool.query(
            `INSERT INTO webhook_events 
       (provider, event_id, event_type, payload, signature, status, received_at)
       VALUES ($1, $2, $3, $4, $5, 'received', now())
       ON CONFLICT (provider, event_id) DO NOTHING
       RETURNING id`,
            [providerName, eventId, type, JSON.stringify({ ...data, _originalCreatedAt: createdAt }), signature || null]
        );

        if (result.rows.length > 0) {
            return { isNew: true, dbEventId: result.rows[0].id };
        }

        // Already exists, fetch the existing ID
        const existing = await this.pool.query(
            `SELECT id FROM webhook_events WHERE provider = $1 AND event_id = $2`,
            [providerName, eventId]
        );

        return { isNew: false, dbEventId: existing.rows[0]?.id };
    }

    /**
     * Mark event as processed or failed.
     * @private
     */
    async _markProcessed(dbEventId, status, errorMessage = null) {
        await this.pool.query(
            `UPDATE webhook_events 
       SET status = $2, processed_at = now(), last_error = $3
       WHERE id = $1`,
            [dbEventId, status, errorMessage]
        );
    }

    /**
     * Retry failed webhook events.
     * Called by reconciliation job.
     * 
     * @param {number} [maxRetries=3] - Max retry attempts
     * @param {number} [limit=100] - Max events to retry
     * @returns {Promise<{processed: number, failed: number}>}
     */
    async retryFailedEvents(maxRetries = 3, limit = 100) {
        const { rows: events } = await this.pool.query(
            `SELECT id, provider, event_id, event_type, payload 
       FROM webhook_events 
       WHERE status = 'failed' AND retry_count < $1
       ORDER BY received_at ASC
       LIMIT $2`,
            [maxRetries, limit]
        );

        let processed = 0;
        let failed = 0;

        for (const row of events) {
            try {
                // Reconstruct normalized event
                const payload = row.payload || {};
                const event = {
                    eventId: row.event_id,
                    type: row.event_type,
                    provider: row.provider,
                    createdAt: payload._originalCreatedAt || new Date().toISOString(),
                    data: payload,
                };

                await this.eventProcessor.processEvent(event, row.id);
                await this._markProcessed(row.id, 'processed');
                processed++;
            } catch (err) {
                this.logger.error(`[WebhookHandler] Retry failed for event ${row.event_id}:`, err);
                await this.pool.query(
                    `UPDATE webhook_events 
           SET retry_count = retry_count + 1, last_error = $2
           WHERE id = $1`,
                    [row.id, err.message]
                );
                failed++;
            }
        }

        return { processed, failed };
    }
}

export default WebhookHandler;

/**
 * Mock Payment Provider
 * 
 * Simulates payment processing for development and testing.
 * Supports automatic webhook firing for testing the full flow.
 */

import { PaymentProvider, WebhookEventTypes } from './providerInterface.js';

/**
 * Generate a random ID string
 */
function randomId(prefix = '') {
    return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Mock provider for development and testing.
 */
export class MockProvider extends PaymentProvider {
    /**
     * @param {Object} config
     * @param {boolean} [config.autoWebhook=true] - Auto-fire webhooks after confirm/refund
     * @param {number} [config.webhookDelayMs=500] - Delay before firing webhook
     * @param {Function} [config.onWebhook] - Callback when webhook should fire
     * @param {string} [config.webhookSecret='mock_secret'] - Secret for webhook signing
     * @param {string} [config.defaultResult='succeeded'] - Default result: 'succeeded' | 'failed'
     */
    constructor(config = {}) {
        super(config);
        this.name = 'mock';
        this.autoWebhook = config.autoWebhook !== false;
        this.webhookDelayMs = config.webhookDelayMs ?? 500;
        this.onWebhook = config.onWebhook || null;
        this.webhookSecret = config.webhookSecret || 'mock_secret';
        this.defaultResult = config.defaultResult || 'succeeded';

        // In-memory state for mock intents
        this._intents = new Map();
        this._refunds = new Map();
    }

    /**
     * Create a mock payment intent.
     */
    async createIntent({ amount, currency, idempotencyKey, metadata }) {
        const providerIntentId = randomId('pi_mock_');
        const clientSecret = randomId('cs_mock_');

        const intent = {
            providerIntentId,
            clientSecret,
            amount,
            currency,
            metadata: metadata || {},
            status: 'requires_confirmation',
            createdAt: new Date().toISOString(),
        };

        this._intents.set(providerIntentId, intent);

        return {
            providerIntentId,
            clientSecret,
            status: 'requires_confirmation',
        };
    }

    /**
     * Confirm a mock payment intent.
     * Returns 'processing' immediately, then fires webhook after delay.
     */
    async confirmIntent({ providerIntentId, idempotencyKey, paymentMethod, simulate }) {
        const intent = this._intents.get(providerIntentId);
        if (!intent) {
            return {
                status: 'failed',
                errorCode: 'INTENT_NOT_FOUND',
                errorMessage: 'Payment intent not found',
            };
        }

        // Already processed?
        if (intent.status === 'succeeded' || intent.status === 'failed') {
            return {
                status: intent.status,
                providerTxnId: intent.providerTxnId,
            };
        }

        // Determine result based on simulate param or default
        const result = simulate === 'failed' ? 'failed' :
            simulate === 'requires_action' ? 'requires_action' :
                this.defaultResult;

        // Mark as processing
        intent.status = 'processing';
        intent.paymentMethod = paymentMethod || 'mock_card';

        // Schedule webhook if auto-webhook enabled
        if (this.autoWebhook && this.onWebhook) {
            setTimeout(() => {
                this._firePaymentWebhook(intent, result);
            }, this.webhookDelayMs);
        }

        return {
            status: 'processing',
        };
    }

    /**
     * Request a mock refund.
     */
    async refund({ providerTxnId, amount, currency, idempotencyKey, reason }) {
        const providerRefundId = randomId('rf_mock_');

        const refund = {
            providerRefundId,
            providerTxnId,
            amount,
            currency,
            reason,
            status: 'processing',
            createdAt: new Date().toISOString(),
        };

        this._refunds.set(providerRefundId, refund);

        // Schedule webhook if auto-webhook enabled
        if (this.autoWebhook && this.onWebhook) {
            setTimeout(() => {
                this._fireRefundWebhook(refund, 'succeeded');
            }, this.webhookDelayMs);
        }

        return {
            providerRefundId,
            status: 'processing',
        };
    }

    /**
     * Verify mock webhook signature.
     */
    async verifyWebhook({ payload, signature }) {
        // Mock verification: signature should be 'mock_sig_' + first 8 chars of JSON
        const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const expectedPrefix = 'mock_sig_';

        if (!signature || !signature.startsWith(expectedPrefix)) {
            return { valid: false, error: 'Invalid mock signature format' };
        }

        try {
            const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
            return { valid: true, normalizedEvent: parsed };
        } catch (err) {
            return { valid: false, error: 'Invalid JSON payload' };
        }
    }

    /**
     * Query intent status.
     */
    async queryStatus(providerIntentId) {
        const intent = this._intents.get(providerIntentId);
        if (!intent) {
            return { status: 'not_found' };
        }
        return {
            status: intent.status,
            providerTxnId: intent.providerTxnId,
        };
    }

    /**
     * Fire a payment webhook event.
     * @private
     */
    _firePaymentWebhook(intent, result) {
        const providerTxnId = result === 'succeeded' ? randomId('txn_mock_') : null;

        if (result === 'succeeded') {
            intent.status = 'succeeded';
            intent.providerTxnId = providerTxnId;
        } else if (result === 'failed') {
            intent.status = 'failed';
        } else if (result === 'requires_action') {
            intent.status = 'requires_action';
        }

        const eventType = result === 'succeeded' ? WebhookEventTypes.PAYMENT_SUCCEEDED :
            result === 'failed' ? WebhookEventTypes.PAYMENT_FAILED :
                WebhookEventTypes.PAYMENT_REQUIRES_ACTION;

        /** @type {import('./providerInterface.js').NormalizedWebhookEvent} */
        const event = {
            eventId: randomId('evt_mock_'),
            type: eventType,
            provider: 'mock',
            createdAt: new Date().toISOString(),
            data: {
                providerIntentId: intent.providerIntentId,
                providerTxnId,
                amount: intent.amount,
                currency: intent.currency,
                status: result,
                metadata: intent.metadata,
                ...(result === 'failed' && {
                    errorCode: 'MOCK_DECLINED',
                    errorMessage: 'Payment was declined (simulated)',
                }),
            },
        };

        // Generate mock signature
        const signature = 'mock_sig_' + event.eventId.slice(0, 8);

        if (this.onWebhook) {
            this.onWebhook(event, signature);
        }
    }

    /**
     * Fire a refund webhook event.
     * @private
     */
    _fireRefundWebhook(refund, result) {
        refund.status = result;

        const eventType = result === 'succeeded'
            ? WebhookEventTypes.REFUND_SUCCEEDED
            : WebhookEventTypes.REFUND_FAILED;

        /** @type {import('./providerInterface.js').NormalizedWebhookEvent} */
        const event = {
            eventId: randomId('evt_mock_'),
            type: eventType,
            provider: 'mock',
            createdAt: new Date().toISOString(),
            data: {
                providerRefundId: refund.providerRefundId,
                providerTxnId: refund.providerTxnId,
                amount: refund.amount,
                currency: refund.currency,
                status: result,
                ...(result === 'failed' && {
                    errorCode: 'MOCK_REFUND_FAILED',
                    errorMessage: 'Refund failed (simulated)',
                }),
            },
        };

        const signature = 'mock_sig_' + event.eventId.slice(0, 8);

        if (this.onWebhook) {
            this.onWebhook(event, signature);
        }
    }

    /**
     * Manually trigger a webhook for testing.
     * @param {string} providerIntentId
     * @param {'succeeded'|'failed'} result
     */
    triggerManualWebhook(providerIntentId, result = 'succeeded') {
        const intent = this._intents.get(providerIntentId);
        if (intent && this.onWebhook) {
            this._firePaymentWebhook(intent, result);
        }
    }
}

export default MockProvider;

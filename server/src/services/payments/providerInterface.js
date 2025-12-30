/**
 * Payment Provider Interface
 * 
 * Abstract interface for payment providers (mock, Stripe, Alipay, etc.)
 * All providers must implement these methods.
 */

/**
 * @typedef {Object} CreateIntentResult
 * @property {string} providerIntentId - Provider-specific intent ID
 * @property {string} clientSecret - Client secret for frontend SDK
 * @property {string} status - 'requires_confirmation' | 'requires_action' | 'processing'
 */

/**
 * @typedef {Object} ConfirmResult
 * @property {string} status - 'processing' | 'succeeded' | 'failed' | 'requires_action'
 * @property {string} [providerTxnId] - Provider transaction ID (if available)
 * @property {string} [errorCode] - Error code if failed
 * @property {string} [errorMessage] - Error message if failed
 * @property {Object} [actionData] - Data for requires_action (e.g., redirect URL)
 */

/**
 * @typedef {Object} RefundResult
 * @property {string} providerRefundId - Provider-specific refund ID
 * @property {string} status - 'processing' | 'succeeded' | 'failed'
 * @property {string} [errorCode]
 * @property {string} [errorMessage]
 */

/**
 * @typedef {Object} WebhookVerifyResult
 * @property {boolean} valid - Whether signature is valid
 * @property {Object} [normalizedEvent] - Normalized event if valid
 * @property {string} [error] - Error message if invalid
 */

/**
 * Base class for payment providers.
 * Subclasses must implement all abstract methods.
 */
export class PaymentProvider {
    /**
     * @param {Object} config - Provider-specific configuration
     */
    constructor(config = {}) {
        this.config = config;
        this.name = 'base';
    }

    /**
     * Create a payment intent with the provider.
     * 
     * @param {Object} params
     * @param {number} params.amount - Amount in smallest currency unit (e.g., cents)
     * @param {string} params.currency - ISO currency code
     * @param {string} params.idempotencyKey - Idempotency key
     * @param {Object} [params.metadata] - Additional metadata
     * @returns {Promise<CreateIntentResult>}
     */
    async createIntent(params) {
        throw new Error('createIntent must be implemented by subclass');
    }

    /**
     * Confirm/capture a payment intent.
     * For webhook-first design, this should return 'processing' status
     * and the actual result comes via webhook.
     * 
     * @param {Object} params
     * @param {string} params.providerIntentId - Provider intent ID
     * @param {string} params.idempotencyKey - Idempotency key
     * @param {string} [params.paymentMethod] - Payment method identifier
     * @returns {Promise<ConfirmResult>}
     */
    async confirmIntent(params) {
        throw new Error('confirmIntent must be implemented by subclass');
    }

    /**
     * Request a refund.
     * 
     * @param {Object} params
     * @param {string} params.providerTxnId - Original transaction ID
     * @param {number} params.amount - Refund amount
     * @param {string} params.currency - Currency
     * @param {string} params.idempotencyKey - Idempotency key
     * @param {string} [params.reason] - Refund reason
     * @returns {Promise<RefundResult>}
     */
    async refund(params) {
        throw new Error('refund must be implemented by subclass');
    }

    /**
     * Verify webhook signature and normalize the event.
     * 
     * @param {Object} params
     * @param {string|Buffer} params.payload - Raw webhook payload
     * @param {string} params.signature - Signature from header
     * @returns {Promise<WebhookVerifyResult>}
     */
    async verifyWebhook(params) {
        throw new Error('verifyWebhook must be implemented by subclass');
    }

    /**
     * Parse a webhook payload into a normalized event.
     * Default implementation reuses verifyWebhook for legacy providers.
     *
     * @param {Object} params
     * @param {string|Buffer} params.payload
     * @param {string} params.signature
     * @returns {Promise<WebhookVerifyResult>}
     */
    async parseWebhook(params) {
        return this.verifyWebhook(params);
    }

    /**
     * Query payment status from provider.
     * Used for reconciliation.
     * 
     * @param {string} providerIntentId - Provider intent ID
     * @returns {Promise<{status: string, providerTxnId?: string}>}
     */
    async queryStatus(providerIntentId) {
        throw new Error('queryStatus must be implemented by subclass');
    }
}

/**
 * Normalized webhook event structure.
 * All providers should convert their events to this format.
 */
export const WebhookEventTypes = {
    PAYMENT_SUCCEEDED: 'payment.succeeded',
    PAYMENT_FAILED: 'payment.failed',
    PAYMENT_REQUIRES_ACTION: 'payment.requires_action',
    REFUND_SUCCEEDED: 'refund.succeeded',
    REFUND_FAILED: 'refund.failed',
};

/**
 * @typedef {Object} NormalizedWebhookEvent
 * @property {string} eventId - Unique event ID from provider
 * @property {string} type - One of WebhookEventTypes
 * @property {string} provider - Provider name
 * @property {string} createdAt - ISO timestamp
 * @property {Object} data
 * @property {string} data.providerIntentId - Provider intent ID
 * @property {string} [data.providerTxnId] - Provider transaction ID
 * @property {string} [data.providerRefundId] - Provider refund ID
 * @property {number} data.amount - Amount
 * @property {string} data.currency - Currency
 * @property {string} data.status - Final status
 * @property {string} [data.errorCode] - Error code if failed
 * @property {string} [data.errorMessage] - Error message if failed
 * @property {Object} [data.metadata] - Original metadata from intent
 */

export default PaymentProvider;

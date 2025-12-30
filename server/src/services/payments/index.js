/**
 * Payments Service Module
 * 
 * Central entry point for the payments service layer.
 * Initializes providers, webhook handler, and event processor.
 */

import { config } from '../../config.js';
import { MockProvider } from './mockProvider.js';
import { WechatProvider } from './wechatProvider.js';
import { AlipayProvider } from './alipayProvider.js';
import { WebhookHandler } from './webhookHandler.js';
import { EventProcessor } from './eventProcessor.js';
import { WebhookEventTypes } from './providerInterface.js';

let paymentsService = null;

/**
 * Initialize the payments service with database pool.
 * 
 * @param {Object} deps
 * @param {import('pg').Pool} deps.pool - Database pool
 * @param {Object} [deps.logger] - Logger instance
 * @returns {Object} Payments service instance
 */
export function initPaymentsService({ pool, logger = console }) {
    if (paymentsService) {
        return paymentsService;
    }

    // Initialize event processor
    const eventProcessor = new EventProcessor({ pool, logger });

    // Initialize providers
    const providers = {};

    // Mock provider with webhook callback
    const mockProvider = new MockProvider({
        autoWebhook: config.payments.mockAutoWebhook,
        webhookDelayMs: 500,
        onWebhook: async (event, signature) => {
            // When mock provider fires a webhook, process it through the handler
            if (webhookHandler) {
                try {
                    await webhookHandler.handleWebhook({
                        providerName: 'mock',
                        rawPayload: event,
                        signature,
                    });
                } catch (err) {
                    logger.error('[MockProvider] Auto-webhook failed:', err);
                }
            }
        },
    });
    providers.mock = mockProvider;

    // Placeholder providers for future integration.
    providers.wechat = new WechatProvider(config.payments.wechat);
    providers.alipay = new AlipayProvider(config.payments.alipay);

    // Initialize webhook handler
    const webhookHandler = new WebhookHandler({
        pool,
        providers,
        eventProcessor,
        logger,
    });

    paymentsService = {
        providers,
        webhookHandler,
        eventProcessor,

        /**
         * Get the active provider based on config.
         */
        getActiveProvider() {
            const name = config.payments.provider || 'mock';
            return providers[name] || providers.mock;
        },

        /**
         * Get provider by name.
         */
        getProvider(name) {
            return providers[name];
        },

        /**
         * Handle incoming webhook.
         */
        async handleWebhook(providerName, rawPayload, signature) {
            return webhookHandler.handleWebhook({ providerName, rawPayload, signature });
        },

        /**
         * Retry failed webhook events (for job usage).
         */
        async retryFailedEvents(maxRetries = 3, limit = 100) {
            return webhookHandler.retryFailedEvents(maxRetries, limit);
        },
    };

    return paymentsService;
}

/**
 * Get the initialized payments service.
 * Throws if not initialized.
 */
export function getPaymentsService() {
    if (!paymentsService) {
        throw new Error('Payments service not initialized. Call initPaymentsService first.');
    }
    return paymentsService;
}

// Re-export types and constants
export { WebhookEventTypes } from './providerInterface.js';
export { MockProvider } from './mockProvider.js';
export { WebhookHandler } from './webhookHandler.js';
export { EventProcessor } from './eventProcessor.js';

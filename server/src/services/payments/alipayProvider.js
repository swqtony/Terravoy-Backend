/**
 * Alipay Provider (placeholder)
 *
 * This is a skeleton implementation so we can switch providers later
 * by setting PAYMENT_PROVIDER=alipay and filling env vars.
 */

import { PaymentProvider } from './providerInterface.js';

function assertConfigured(config) {
  if (!config?.appId || !config?.privateKey || !config?.publicKey) {
    const err = new Error('ALIPAY_NOT_CONFIGURED');
    err.code = 'ALIPAY_NOT_CONFIGURED';
    throw err;
  }
}

export class AlipayProvider extends PaymentProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'alipay';
  }

  async createIntent() {
    assertConfigured(this.config);
    throw new Error('ALIPAY_NOT_IMPLEMENTED');
  }

  async confirmIntent() {
    assertConfigured(this.config);
    throw new Error('ALIPAY_NOT_IMPLEMENTED');
  }

  async refund() {
    assertConfigured(this.config);
    throw new Error('ALIPAY_NOT_IMPLEMENTED');
  }

  async verifyWebhook() {
    return { valid: false, error: 'ALIPAY_NOT_IMPLEMENTED' };
  }

  async queryStatus() {
    assertConfigured(this.config);
    throw new Error('ALIPAY_NOT_IMPLEMENTED');
  }
}

export default AlipayProvider;

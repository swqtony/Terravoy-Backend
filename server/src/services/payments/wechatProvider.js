/**
 * WeChat Pay Provider (placeholder)
 *
 * This is a skeleton implementation so we can switch providers later
 * by setting PAYMENT_PROVIDER=wechat and filling env vars.
 */

import { PaymentProvider } from './providerInterface.js';

function assertConfigured(config) {
  if (!config?.appId || !config?.mchId || !config?.apiV3Key || !config?.privateKey) {
    const err = new Error('WECHAT_PAY_NOT_CONFIGURED');
    err.code = 'WECHAT_PAY_NOT_CONFIGURED';
    throw err;
  }
}

export class WechatProvider extends PaymentProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'wechat';
  }

  async createIntent() {
    assertConfigured(this.config);
    throw new Error('WECHAT_PAY_NOT_IMPLEMENTED');
  }

  async confirmIntent() {
    assertConfigured(this.config);
    throw new Error('WECHAT_PAY_NOT_IMPLEMENTED');
  }

  async refund() {
    assertConfigured(this.config);
    throw new Error('WECHAT_PAY_NOT_IMPLEMENTED');
  }

  async verifyWebhook() {
    return { valid: false, error: 'WECHAT_PAY_NOT_IMPLEMENTED' };
  }

  async queryStatus() {
    assertConfigured(this.config);
    throw new Error('WECHAT_PAY_NOT_IMPLEMENTED');
  }
}

export default WechatProvider;

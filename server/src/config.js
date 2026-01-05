import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });
dotenv.config();

const config = {
  port: Number(process.env.PORT) || 3000,
  db: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT) || 5432,
    user: process.env.POSTGRES_USER || 'terravoy',
    password: process.env.POSTGRES_PASSWORD || 'terravoy_dev',
    database: process.env.POSTGRES_DB || 'terravoy',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379/0',
    connectTimeoutMs: Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 5000,
    maxRetries: Number(process.env.REDIS_MAX_RETRIES) || 50,
  },
  im: {
    apiBaseUrl: process.env.IM_API_BASE_URL || 'http://localhost:8090',
  },
  terra: {
    jwtSecret: process.env.TERRA_JWT_SECRET || 'dev_terra_secret_change_me',
    devToken: process.env.TERRA_DEV_TOKEN || 'dev_terra_token',
  },
  payments: {
    provider: process.env.PAYMENT_PROVIDER || 'mock',
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
    mockAutoWebhook: process.env.MOCK_WEBHOOK_AUTOFIRE !== '0',
    wechat: {
      appId: process.env.WECHAT_PAY_APP_ID || '',
      mchId: process.env.WECHAT_PAY_MCH_ID || '',
      apiV3Key: process.env.WECHAT_PAY_API_V3_KEY || '',
      certSerial: process.env.WECHAT_PAY_CERT_SERIAL || '',
      privateKey: process.env.WECHAT_PAY_PRIVATE_KEY || '',
      webhookSecret: process.env.WECHAT_PAY_WEBHOOK_SECRET || '',
    },
    alipay: {
      appId: process.env.ALIPAY_APP_ID || '',
      privateKey: process.env.ALIPAY_PRIVATE_KEY || '',
      publicKey: process.env.ALIPAY_PUBLIC_KEY || '',
      webhookSecret: process.env.ALIPAY_WEBHOOK_SECRET || '',
    },
    jobs: {
      replayIntervalMin: Number(process.env.PAYMENTS_JOB_REPLAY_INTERVAL_MIN) || 5,
      reconcileIntervalMin: Number(process.env.PAYMENTS_JOB_RECONCILE_INTERVAL_MIN) || 10,
      cleanupIntervalMin: Number(process.env.PAYMENTS_JOB_CLEANUP_INTERVAL_MIN) || 30,
      intentExpireMin: Number(process.env.PAYMENTS_INTENT_EXPIRE_MIN) || 60,
    },
  },
  auth: {
    localJwtSecret: process.env.LOCAL_JWT_SECRET || 'dev_local_jwt_secret',
    localJwtTtlMin: Number(process.env.LOCAL_JWT_TTL_MIN) || 10,
    jwtSecret: process.env.AUTH_JWT_SECRET || 'dev_auth_jwt_secret',
    accessTtlSeconds: Number(process.env.AUTH_ACCESS_TTL_SECONDS) || 3600,
    refreshTtlSeconds: Number(process.env.AUTH_REFRESH_TTL_SECONDS) || 2592000,
    smsExpiresSeconds: Number(process.env.AUTH_SMS_EXPIRES_SECONDS) || 300,
    smsCooldownSeconds: Number(process.env.AUTH_SMS_COOLDOWN_SECONDS) || 60,
    debugSms: process.env.AUTH_DEBUG_SMS === 'true',
    smsMode: process.env.AUTH_SMS_MODE || 'mock',
    smsProvider: process.env.AUTH_SMS_PROVIDER || '',
    smsProviderKey: process.env.AUTH_SMS_PROVIDER_KEY || '',
    smsProviderSecret: process.env.AUTH_SMS_PROVIDER_SECRET || '',
    smsProviderSign: process.env.AUTH_SMS_PROVIDER_SIGN || '',
    smsProviderTemplateLogin:
      process.env.AUTH_SMS_PROVIDER_TEMPLATE_LOGIN || '',
    smsProviderTemplateRegister:
      process.env.AUTH_SMS_PROVIDER_TEMPLATE_REGISTER || '',
  },
  lean: {
    appId: process.env.LEAN_APP_ID || '',
    appKey: process.env.LEAN_APP_KEY || '',
    server: process.env.LEAN_SERVER || '',
    masterKey: process.env.LEAN_MASTER_KEY || '',
  },
  oss: {
    useOssUploader: process.env.USE_OSS_UPLOADER !== '0',
    endpoint: process.env.OSS_ENDPOINT || '',
    bucketPublic: process.env.OSS_BUCKET_PUBLIC || '',
    bucketPrivate: process.env.OSS_BUCKET_PRIVATE || '',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
    publicBaseUrl: process.env.OSS_PUBLIC_BASE_URL || '',
    uploadExpiresSeconds: Number(process.env.OSS_UPLOAD_EXPIRES_SECONDS) || 900,
  },
  media: {
    publicBaseUrl:
      process.env.PUBLIC_MEDIA_BASE_URL ||
      process.env.OSS_PUBLIC_BASE_URL ||
      '',
    adminReadKey: process.env.ADMIN_READ_URL_KEY || '',
  },
  safety: {
    checkRateUserPerMin: Number(process.env.SAFETY_CHECK_RL_USER_PER_MIN) || 120,
    checkRateIpUserPerMin:
      Number(process.env.SAFETY_CHECK_RL_IP_USER_PER_MIN) || 240,
  },
  admin: {
    apiKey: process.env.ADMIN_API_KEY || '',
  },
  adminAuth: {
    jwtSecret: process.env.ADMIN_JWT_SECRET || '',
    accessTtlMin: Number(process.env.ADMIN_ACCESS_TOKEN_TTL_MIN) || 30,
    refreshTtlDays: Number(process.env.ADMIN_REFRESH_TOKEN_TTL_DAYS) || 30,
    cookieName: process.env.ADMIN_COOKIE_NAME || 'admin_refresh_token',
    cookieSecure:
      (process.env.ADMIN_COOKIE_SECURE || '').toLowerCase() === 'true' ||
      (process.env.ADMIN_COOKIE_SECURE === undefined &&
        process.env.NODE_ENV === 'production'),
    cookieSameSite: process.env.ADMIN_COOKIE_SAMESITE || 'lax',
  },
  flags: {
    devAuthBypass: process.env.DEV_AUTH_BYPASS === '1',
    paymentsWebhookOnly: process.env.PAYMENTS_WEBHOOK_ONLY !== '0',
    allowLegacyStorage: process.env.ALLOW_LEGACY_STORAGE === 'true',
    hostCertAutoApprove: process.env.HOST_CERT_AUTO_APPROVE === '1',
  },
};

if (
  process.env.NODE_ENV === 'production' &&
  config.auth.smsMode !== 'gateway'
) {
  throw new Error(
    'AUTH_SMS_MODE must be "gateway" when NODE_ENV=production.'
  );
}

if (process.env.NODE_ENV === 'production' && !config.adminAuth.jwtSecret) {
  throw new Error('ADMIN_JWT_SECRET must be set when NODE_ENV=production.');
}

export { config };

import fs from 'fs';
import admin from 'firebase-admin';
import { config } from '../config.js';

let app = null;

function loadServiceAccount() {
  if (config.push.fcmServiceAccountJson) {
    try {
      return JSON.parse(config.push.fcmServiceAccountJson);
    } catch (_err) {
      return null;
    }
  }
  if (config.push.fcmServiceAccountPath && fs.existsSync(config.push.fcmServiceAccountPath)) {
    const raw = fs.readFileSync(config.push.fcmServiceAccountPath, 'utf8');
    return JSON.parse(raw);
  }
  return null;
}

export function initPushService({ logger } = {}) {
  if (app) return app;
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    if (logger?.warn) {
      logger.warn({ event: 'push.fcm.disabled' }, 'FCM service account missing');
    }
    return null;
  }
  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  return app;
}

export async function sendPushToTokens({ tokens, payload }) {
  if (!app) return { ok: false, error: 'FCM_NOT_READY' };
  if (!tokens || tokens.length === 0) return { ok: true, sent: 0 };
  const message = {
    tokens,
    data: payload,
  };
  const resp = await admin.messaging().sendEachForMulticast(message);
  return {
    ok: true,
    sent: resp.successCount,
    failed: resp.failureCount,
    responses: resp.responses,
  };
}

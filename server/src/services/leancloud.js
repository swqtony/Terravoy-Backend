import fetch from 'node-fetch';
import { config } from '../config.js';

const isDev = (process.env.NODE_ENV || '').toLowerCase() !== 'production';

export class LeancloudMisconfigError extends Error {
  constructor(message) {
    super(message);
    this.code = 'MISCONFIG_LEAN';
  }
}

export function maskToken(token, { head = 6, tail = 4 } = {}) {
  if (!token) return '';
  if (token.length <= head + tail) return token;
  return `${token.slice(0, head)}...${token.slice(-tail)}`;
}

function maskKey(key) {
  if (!key) return '';
  return `${key.slice(0, 4)}...`;
}

function devLog(logger, level, payload, message) {
  if (!isDev || !logger || typeof logger[level] !== 'function') return;
  logger[level](payload, message);
}

function redactBody(body) {
  if (!body || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map(redactBody);
  const result = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string' && ['sessionToken', 'token', 'access_token'].includes(k)) {
      result[k] = maskToken(v);
    } else {
      result[k] = redactBody(v);
    }
  }
  return result;
}

function ensureLeanConfig(logger, context = {}) {
  const missing = [];
  if (!config.lean.server) missing.push('LEAN_SERVER');
  if (!config.lean.appId) missing.push('LEAN_APP_ID');
  if (!config.lean.appKey) missing.push('LEAN_APP_KEY');
  if (missing.length > 0) {
    devLog(logger, 'error', {
      event: 'leancloud.users.me.misconfig',
      missing,
      ...context,
    }, 'LeanCloud config missing');
    throw new LeancloudMisconfigError(`Missing ${missing.join(', ')}`);
  }
}

export async function verifySessionToken(leanUserId, sessionToken, { logger, context = {} } = {}) {
  if (!sessionToken || !leanUserId) return null;
  ensureLeanConfig(logger, context);
  const server = (config.lean.server || '').replace(/\/+$/, '');
  const url = `${server}/1.1/users/me`;
  const headers = {
    'X-LC-Id': config.lean.appId,
    'X-LC-Key': config.lean.appKey,
    'X-LC-Session': sessionToken,
  };

  devLog(logger, 'info', {
    event: 'leancloud.users.me.request',
    leanUserId,
    sessionToken: maskToken(sessionToken),
    leancloudConfig: {
      appIdPrefix: (config.lean.appId || '').slice(0, 8),
      appKeyPrefix: maskKey(config.lean.appKey),
      server,
    },
    request: { method: 'GET', url },
    ...context,
  }, 'Verifying LeanCloud session via users/me');

  try {
    const resp = await fetch(url, { headers });
    let body = null;
    if (!resp.ok) {
      try {
        const text = await resp.text();
        try {
          body = redactBody(JSON.parse(text));
        } catch (_jsonErr) {
          body = text;
        }
      } catch (_err) {
        body = '[unavailable]';
      }
    }

    devLog(logger, 'info', {
      event: 'leancloud.users.me.response',
      request: { method: 'GET', url },
      statusCode: resp.status,
      body: resp.ok ? undefined : body,
      ...context,
    }, 'LeanCloud users/me response');

    if (!resp.ok) {
      return null;
    }

    const json = await resp.json();
    if (!json || json.objectId !== leanUserId) {
      devLog(logger, 'warn', {
        event: 'leancloud.users.me.mismatch',
        expectedUserId: leanUserId,
        receivedUserId: json?.objectId,
        ...context,
      }, 'LeanCloud users/me userId mismatch');
      return null;
    }

    devLog(logger, 'info', {
      event: 'leancloud.users.me.verified',
      userId: leanUserId,
      statusCode: 200,
      ...context,
    }, 'LeanCloud session verified');
    return json;
  } catch (err) {
    devLog(logger, 'error', {
      event: 'leancloud.users.me.error',
      error: err.message,
      ...context,
    }, 'Error verifying LeanCloud session');
    return null;
  }
}

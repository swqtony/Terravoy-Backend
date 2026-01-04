import fetch from 'node-fetch';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const DEFAULT_TIMEOUT_MS = 8000;

function buildBearer(userId) {
  if (!userId) {
    throw new Error('imApi requires userId');
  }
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (5 * 60);
  return jwt.sign({ sub: userId, iat: now, exp }, config.auth.jwtSecret);
}

async function requestJson(url, { method = 'GET', body, token, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await resp.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (_err) {
      payload = text;
    }
    if (!resp.ok) {
      const err = new Error(`im-api ${resp.status}`);
      err.statusCode = resp.status;
      err.detail = payload;
      throw err;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function stableMatchSessionId(memberA, memberB) {
  const [first, second] = [String(memberA), String(memberB)].sort();
  const hash = crypto.createHash('sha1').update(`${first}:${second}`).digest();
  const bytes = Array.from(hash.slice(0, 16));
  // RFC 4122 v5
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function ensureMatchThread({
  sessionId,
  memberA,
  memberB,
  roleA = 'traveler',
  roleB = 'traveler',
  actorUserId,
}) {
  if (!sessionId || !memberA || !memberB) return null;
  const reuseSessionId = stableMatchSessionId(memberA, memberB);
  const token = buildBearer(actorUserId || memberA);
  const base = config.im.apiBaseUrl.replace(/\/+$/, '');
  const url = `${base}/v1/threads/ensure`;
  const payload = {
    type: 'match',
    match_session_id: reuseSessionId,
    members: [
      { user_id: memberA, role: roleA },
      { user_id: memberB, role: roleB },
    ],
  };
  const data = await requestJson(url, { method: 'POST', body: payload, token });
  return data?.thread_id || data?.data?.thread_id || null;
}

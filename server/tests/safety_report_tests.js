import fetch from 'node-fetch';
import { logBlockedContent, buildTextPreview } from '../src/services/safetyAuditLogger.js';

const HOST = process.env.HOST || 'http://localhost:3000';
const TRAVELER = 'contract_traveler';
const HOST_USER = 'contract_host';
const TRAVELER_SESSION = process.env.TRAVELER_SESSION_TOKEN || 'contract_traveler_session';
const HOST_SESSION = process.env.HOST_SESSION_TOKEN || 'contract_host_session';
const RATE_USER = 'rate_limit_user';
const RATE_SESSION = process.env.RATE_SESSION_TOKEN || 'rate_limit_session';

function headers(userId, sessionToken, role = 'traveler') {
  return {
    'Content-Type': 'application/json',
    'x-leancloud-user-id': userId,
    'x-leancloud-sessiontoken': sessionToken,
    'x-terra-role': role,
  };
}

async function post(pathname, body, userId = TRAVELER, sessionToken = TRAVELER_SESSION, role = 'traveler') {
  const resp = await fetch(`${HOST}${pathname}`, {
    method: 'POST',
    headers: headers(userId, sessionToken, role),
    body: JSON.stringify(body || {}),
  });
  const json = await resp.json();
  return { status: resp.status, json };
}

async function put(pathname, body, userId = HOST_USER, sessionToken = HOST_SESSION, role = 'host') {
  const resp = await fetch(`${HOST}${pathname}`, {
    method: 'PUT',
    headers: headers(userId, sessionToken, role),
    body: JSON.stringify(body || {}),
  });
  const json = await resp.json();
  return { status: resp.status, json };
}

function assertStatus(resp, expected, label) {
  if (resp.status !== expected) {
    throw new Error(`${label} expected ${expected}, got ${resp.status}`);
  }
}

function assertReason(resp, reason, label) {
  const reasons = resp.json?.reasons || resp.json?.detail?.reasons || [];
  if (!Array.isArray(reasons) || !reasons.includes(reason)) {
    throw new Error(`${label} missing reason ${reason}`);
  }
}

function assertContentBlocked(resp, label) {
  if (resp.json?.ok !== false || resp.json?.message !== 'content_not_allowed') {
    throw new Error(`${label} response missing ok/message`);
  }
}

function testAuditLogger() {
  let called = false;
  let payload = null;
  const req = {
    id: 'trace_1',
    ip: '127.0.0.1',
    headers: {},
    log: {
      info: (data) => {
        called = true;
        payload = data;
      },
    },
  };
  logBlockedContent({
    req,
    scene: 'chat',
    reasons: ['URL'],
    textPreview: buildTextPreview('http://example.com'),
    source: 'check-text',
    userId: 'user_1',
  });
  if (!called) throw new Error('audit logger not called');
  if (payload?.textPreview !== 'http://example.com') {
    throw new Error('audit logger missing text preview');
  }
  console.log('PASS safety audit logger');
}

async function testCheckText() {
  let resp = await post('/v1/safety/check-text', {
    scene: 'chat',
    text: 'visit http://example.com',
  });
  assertStatus(resp, 422, 'check-text URL');
  assertReason(resp, 'URL', 'check-text URL');
  assertContentBlocked(resp, 'check-text URL');

  resp = await post('/v1/safety/check-text', {
    scene: 'chat',
    text: 'call me 13800138000',
  });
  assertStatus(resp, 422, 'check-text PHONE');
  assertReason(resp, 'PHONE', 'check-text PHONE');
  assertContentBlocked(resp, 'check-text PHONE');

  resp = await post('/v1/safety/check-text', {
    scene: 'chat',
    text: '加微信 abcdefg',
  });
  assertStatus(resp, 422, 'check-text WECHAT');
  assertReason(resp, 'WECHAT', 'check-text WECHAT');
  assertContentBlocked(resp, 'check-text WECHAT');

  resp = await post('/v1/safety/check-text', {
    scene: 'chat',
    text: 'this contains illegal',
  });
  assertStatus(resp, 422, 'check-text SENSITIVE');
  assertReason(resp, 'SENSITIVE_WORD', 'check-text SENSITIVE');
  assertContentBlocked(resp, 'check-text SENSITIVE');
  console.log('PASS safety check-text');
}

async function testCheckTextRateLimit() {
  let blocked = null;
  for (let idx = 0; idx < 130; idx += 1) {
    // eslint-disable-next-line no-await-in-loop
    const resp = await post(
      '/v1/safety/check-text',
      { scene: 'chat', text: `rate test ${idx}` },
      RATE_USER,
      RATE_SESSION
    );
    if (resp.status === 429) {
      blocked = resp;
      break;
    }
  }
  if (!blocked) {
    throw new Error('check-text rate limit not triggered');
  }
  if (blocked.json?.message !== 'rate_limited') {
    throw new Error('rate limit response missing message');
  }
  console.log('PASS safety rate limit');
}

async function testPostBlocked() {
  const resp = await post('/functions/v1/discover/posts', {
    content: 'check http://example.com',
    images: [],
  });
  assertStatus(resp, 422, 'post blocked');
  assertContentBlocked(resp, 'post blocked');
  console.log('PASS post blocked');
}

async function testExperienceBlocked() {
  const created = await post('/functions/v1/host/experiences', {}, HOST_USER, HOST_SESSION, 'host');
  assertStatus(created, 200, 'experience draft create');
  const id = created.json?.data?.id || created.json?.id;
  if (!id) throw new Error('missing experience id');
  const update = await put(`/functions/v1/host/experiences/${id}`, {
    title: 'Test',
    description: '加微信 abcdefg',
  });
  assertStatus(update, 422, 'experience blocked');
  assertContentBlocked(update, 'experience blocked');
  console.log('PASS experience blocked');
}

async function testReport() {
  const resp = await post('/v1/reports', {
    targetType: 'chat',
    targetId: 'conv_1',
    reasonCode: 'spam',
    description: 'test report',
  });
  assertStatus(resp, 200, 'report create');
  const data = resp.json?.data || resp.json;
  if (!data?.id || data?.status !== 'pending') {
    throw new Error('report response missing id/status');
  }
  console.log('PASS report create');
}

async function main() {
  testAuditLogger();
  await testCheckText();
  await testCheckTextRateLimit();
  await testPostBlocked();
  await testExperienceBlocked();
  await testReport();
  console.log('ALL SAFETY/REPORT TESTS PASS');
}

main().catch((err) => {
  console.error('Safety/report tests FAILED', err);
  process.exit(1);
});

import crypto from 'crypto';
import fetch from 'node-fetch';

const HOST = process.env.HOST || 'http://localhost:3000';
const USER = 'contract_media_user';
const SESSION = process.env.TRAVELER_SESSION_TOKEN || 'contract_traveler_session';

function baseHeaders(role = 'traveler') {
  return {
    'Content-Type': 'application/json',
    'x-leancloud-user-id': USER,
    'x-leancloud-sessiontoken': SESSION,
    'x-terra-role': role,
  };
}

async function post(pathname, body, role = 'traveler', extraHeaders = {}) {
  const resp = await fetch(`${HOST}${pathname}`, {
    method: 'POST',
    headers: { ...baseHeaders(role), ...extraHeaders },
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

function assertCode(resp, expected, label) {
  const code = resp.json?.code || resp.json?.data?.code;
  if (code !== expected) {
    throw new Error(`${label} expected code ${expected}, got ${code}`);
  }
}

function buildObjectKey({ visibility, scope, ownerId, ext }) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const id = crypto.randomUUID();
  return `${visibility}/${scope}/${ownerId}/${year}/${month}/${id}.${ext}`;
}

async function testUploadValidation() {
  const base = {
    scope: 'post',
    visibility: 'public',
    ext: 'jpg',
    size: 1024,
    mime: 'image/jpeg',
  };

  let resp = await post('/v1/media/upload-url', { ...base, scope: 'nope' });
  assertStatus(resp, 400, 'invalid scope');
  assertCode(resp, 'INVALID_SCOPE', 'invalid scope');

  resp = await post('/v1/media/upload-url', { ...base, visibility: 'open' });
  assertStatus(resp, 400, 'invalid visibility');
  assertCode(resp, 'INVALID_VISIBILITY', 'invalid visibility');

  resp = await post('/v1/media/upload-url', { ...base, ext: 'bmp' });
  assertStatus(resp, 400, 'invalid ext');
  assertCode(resp, 'INVALID_EXT', 'invalid ext');

  resp = await post('/v1/media/upload-url', {
    ...base,
    scope: 'avatar',
    visibility: 'private',
  });
  assertStatus(resp, 400, 'avatar visibility');
  assertCode(resp, 'INVALID_VISIBILITY', 'avatar visibility');

  resp = await post('/v1/media/upload-url', {
    scope: 'avatar',
    visibility: 'public',
    ext: 'mp4',
    size: 1024,
    mime: 'video/mp4',
  });
  assertStatus(resp, 400, 'avatar ext');
  assertCode(resp, 'INVALID_EXT', 'avatar ext');

  resp = await post('/v1/media/upload-url', {
    ...base,
    scope: 'kyc',
    visibility: 'public',
  });
  assertStatus(resp, 400, 'kyc visibility');
  assertCode(resp, 'INVALID_VISIBILITY', 'kyc visibility');

  resp = await post('/v1/media/upload-url', {
    scope: 'kyc',
    visibility: 'private',
    ext: 'gif',
    size: 1024,
    mime: 'image/gif',
  });
  assertStatus(resp, 400, 'kyc gif');
  assertCode(resp, 'INVALID_EXT', 'kyc gif');

  console.log('PASS upload-url validation');
}

async function testLegacyStorageGone() {
  if (process.env.ALLOW_LEGACY_STORAGE === 'true') {
    console.log('SKIP legacy storage gone (ALLOW_LEGACY_STORAGE=true)');
    return;
  }
  const resp1 = await post('/storage/upload-url', {});
  assertStatus(resp1, 410, 'legacy upload-url gone');
  const resp2 = await post('/storage/complete', {});
  assertStatus(resp2, 410, 'legacy complete gone');
  const resp3 = await post('/storage/read-url', {});
  assertStatus(resp3, 410, 'legacy read-url gone');
  console.log('PASS legacy storage gone');
}

async function testCompleteValidation() {
  const otherKey = buildObjectKey({
    visibility: 'public',
    scope: 'post',
    ownerId: 'someone_else',
    ext: 'jpg',
  });
  let resp = await post('/v1/media/complete', {
    objectKey: otherKey,
    declaredSize: 1024,
    declaredMime: 'image/jpeg',
  });
  assertStatus(resp, 403, 'complete owner mismatch');
  assertCode(resp, 'FORBIDDEN', 'complete owner mismatch');

  const badKey = buildObjectKey({
    visibility: 'public',
    scope: 'kyc',
    ownerId: USER,
    ext: 'jpg',
  });
  resp = await post('/v1/media/complete', {
    objectKey: badKey,
    declaredSize: 1024,
    declaredMime: 'image/jpeg',
  });
  assertStatus(resp, 400, 'complete kyc visibility');

  const missingKey = buildObjectKey({
    visibility: 'public',
    scope: 'post',
    ownerId: USER,
    ext: 'jpg',
  });
  resp = await post('/v1/media/complete', {
    objectKey: missingKey,
    declaredSize: 1024,
    declaredMime: 'image/jpeg',
  });
  assertStatus(resp, 400, 'complete object missing');

  resp = await post('/v1/media/complete', {
    objectKey: missingKey,
    declaredSize: 1024,
    declaredMime: 'image/jpeg',
    bucket: 'should-not-be-here',
  });
  assertStatus(resp, 400, 'complete bucket rejected');
  assertCode(resp, 'INVALID_REQUEST', 'complete bucket rejected');

  console.log('PASS complete validation');
}

async function testRateLimit() {
  const payload = {
    scope: 'post',
    visibility: 'public',
    ext: 'jpg',
    size: 1024,
    mime: 'image/jpeg',
  };
  let last = null;
  for (let i = 0; i < 31; i += 1) {
    last = await post('/v1/media/upload-url', payload);
  }
  if (last.status !== 429) {
    throw new Error(`rate limit expected 429, got ${last.status}`);
  }
  console.log('PASS upload-url rate limit');
}

async function testAdminReadUrl() {
  const objectKey = buildObjectKey({
    visibility: 'private',
    scope: 'kyc',
    ownerId: USER,
    ext: 'jpg',
  });
  let resp = await post('/v1/admin/media/read-url', { objectKey });
  assertStatus(resp, 403, 'admin read-url forbidden');

  if (process.env.ADMIN_READ_URL_KEY) {
    resp = await post(
      '/v1/admin/media/read-url',
      { objectKey },
      'traveler',
      { 'x-admin-key': process.env.ADMIN_READ_URL_KEY }
    );
    assertStatus(resp, 200, 'admin read-url');
    console.log('PASS admin read-url');
  } else {
    resp = await post('/v1/admin/media/read-url', { objectKey }, 'admin');
    assertStatus(resp, 403, 'admin read-url (no admin key)');
    console.log('SKIP admin read-url (ADMIN_READ_URL_KEY not set)');
  }
}

async function main() {
  await testLegacyStorageGone();
  await testUploadValidation();
  await testCompleteValidation();
  await testRateLimit();
  await testAdminReadUrl();
  console.log('ALL MEDIA CONTRACT TESTS PASS');
}

main().catch((err) => {
  console.error('Media contract tests FAILED', err);
  process.exit(1);
});

import fetch from 'node-fetch';
import crypto from 'crypto';
import { Pool } from 'pg';
import { config } from '../src/config.js';

const HOST = process.env.HOST || 'http://localhost:3000';
const USER_ID = process.env.HOST_CERT_USER || 'cert_host';
const SESSION = process.env.HOST_CERT_SESSION || 'cert_host_session';
const ADMIN_KEY = process.env.ADMIN_API_KEY || '';

const pool = new Pool(config.db);

function headers(role = 'host') {
  return {
    'Content-Type': 'application/json',
    'x-leancloud-user-id': USER_ID,
    'x-leancloud-sessiontoken': SESSION,
    'x-terra-role': role,
  };
}

async function request(path, options = {}) {
  const resp = await fetch(`${HOST}${path}`, options);
  const json = await resp.json();
  return { status: resp.status, json };
}

async function testGetEmpty() {
  const { json, status } = await request('/v1/host-certifications/me', {
    method: 'GET',
    headers: headers(),
  });
  const state = json.data?.state || json.state || {};
  if (status !== 200 || state.status !== 'not_submitted') {
    throw new Error(`expected not_submitted, got ${status} ${state.status}`);
  }
  console.log('PASS host-certifications me empty');
}

async function testDraftUpsert() {
  const { json, status } = await request('/v1/host-certifications/draft', {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({
      profile: {
        credentials: { licenseNumber: 'LIC-001' },
        compliance: { acceptServiceTerms: true },
      },
      documents: [],
    }),
  });
  const state = json.data?.state || json.state || {};
  if (status !== 200 || state.status !== 'draft') {
    throw new Error(`draft upsert failed: ${status} ${state.status}`);
  }
  console.log('PASS host-certifications draft upsert');
}

async function testSubmitMissingDocs() {
  const { json, status } = await request('/v1/host-certifications/submit', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ agree: true }),
  });
  const code = json.code || json.data?.code;
  if (status !== 422 || code !== 'MISSING_DOCUMENTS') {
    throw new Error(`expected MISSING_DOCUMENTS, got ${status} ${code}`);
  }
  console.log('PASS host-certifications submit missing docs');
}

async function seedMediaAsset() {
  const objectKey = `private/kyc/${USER_ID}/2025/01/${crypto.randomUUID()}.jpg`;
  const id = crypto.randomUUID();
  await pool.query(
    `insert into media_assets
     (id, url, mime_type, size, owner_user_id, scope, visibility, provider, object_key, bucket, ext, mime, size_bytes, status)
     values ($1, '', 'image/jpeg', 123, $2, 'kyc', 'private', 'oss', $3, 'test-bucket', 'jpg', 'image/jpeg', 123, 'active')`,
    [id, USER_ID, objectKey]
  );
  return { id, objectKey };
}

async function testSubmitSuccess(document) {
  const { json: draftJson, status: draftStatus } = await request('/v1/host-certifications/draft', {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({
      profile: {
        credentials: { licenseNumber: 'LIC-001' },
        compliance: { acceptServiceTerms: true, acceptPrivacy: true, noIllegalContent: true },
      },
      documents: [
        {
          mediaAssetId: document.id,
          objectKey: document.objectKey,
          docType: 'license',
          name: 'license.jpg',
          sizeBytes: 123,
          contentType: 'image/jpeg',
        },
      ],
    }),
  });
  const draftState = draftJson.data?.state || draftJson.state || {};
  if (draftStatus !== 200 || draftState.status !== 'draft') {
    throw new Error('draft update failed before submit');
  }

  const { json, status } = await request('/v1/host-certifications/submit', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ agree: true }),
  });
  const state = json.data?.state || json.state || {};
  if (status !== 200 || state.status !== 'submitted') {
    throw new Error(`submit failed: ${status} ${state.status}`);
  }
  console.log('PASS host-certifications submit success');
  return state.draftId;
}

async function testAdminReview(certId) {
  if (!ADMIN_KEY) {
    console.log('SKIP admin review tests (ADMIN_API_KEY missing)');
    return;
  }
  const adminHeaders = {
    ...headers(),
    'x-admin-key': ADMIN_KEY,
  };

  const reviewing = await request(`/v1/admin/host-certifications/${certId}/review`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ action: 'reviewing' }),
  });
  const reviewingState = reviewing.json.data?.state || reviewing.json.state || {};
  if (reviewing.status !== 200 || reviewingState.status !== 'reviewing') {
    throw new Error('reviewing action failed');
  }

  const rejected = await request(`/v1/admin/host-certifications/${certId}/review`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ action: 'reject', rejectReason: 'photo blurry' }),
  });
  const rejectedState = rejected.json.data?.state || rejected.json.state || {};
  if (rejected.status !== 200 || rejectedState.status !== 'rejected') {
    throw new Error('reject action failed');
  }

  console.log('PASS host-certifications admin reject');
}

async function testApproveAfterResubmit(document) {
  if (!ADMIN_KEY) return;
  const { json: draftJson } = await request('/v1/host-certifications/draft', {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({
      documents: [
        {
          mediaAssetId: document.id,
          objectKey: document.objectKey,
          docType: 'license',
          name: 'license.jpg',
          sizeBytes: 123,
          contentType: 'image/jpeg',
        },
      ],
    }),
  });
  const draftState = draftJson.data?.state || draftJson.state || {};
  const certId = draftState.draftId;

  await request('/v1/host-certifications/submit', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ agree: true }),
  });

  const adminHeaders = { ...headers(), 'x-admin-key': ADMIN_KEY };
  const approved = await request(`/v1/admin/host-certifications/${certId}/review`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ action: 'approve' }),
  });
  const approvedState = approved.json.data?.state || approved.json.state || {};
  if (approved.status !== 200 || approvedState.status !== 'approved') {
    throw new Error('approve action failed');
  }

  const { rows } = await pool.query(
    `select action from host_certification_audit_logs
     where certification_id = $1 order by created_at asc`,
    [certId]
  );
  const actions = rows.map((r) => r.action);
  if (!actions.includes('submitted') || !actions.includes('approved')) {
    throw new Error('audit logs missing expected actions');
  }

  console.log('PASS host-certifications admin approve');
}

async function testGating() {
  const denied = await request('/functions/v1/host/experiences', {
    method: 'POST',
    headers: headers('host'),
    body: JSON.stringify({}),
  });
  const deniedCode = denied.json.code || denied.json.data?.code;
  if (denied.status !== 403 || deniedCode !== 'HOST_CERT_REQUIRED') {
    throw new Error('expected HOST_CERT_REQUIRED before approval');
  }
  console.log('PASS host-certifications gating denied');
}

async function testGatingAfterApproval() {
  if (!ADMIN_KEY) {
    console.log('SKIP gating approval test (ADMIN_API_KEY missing)');
    return;
  }
  const allowed = await request('/functions/v1/host/experiences', {
    method: 'POST',
    headers: headers('host'),
    body: JSON.stringify({}),
  });
  if (allowed.status !== 200) {
    throw new Error(`expected create draft after approval, got ${allowed.status}`);
  }
  console.log('PASS host-certifications gating approved');
}

async function run() {
  try {
    await testGetEmpty();
    await testDraftUpsert();
    await testSubmitMissingDocs();
    await testGating();
    const document = await seedMediaAsset();
    const certId = await testSubmitSuccess(document);
    await testAdminReview(certId);
    await testApproveAfterResubmit(document);
    await testGatingAfterApproval();
    console.log('ALL HOST CERTIFICATION TESTS PASSED');
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

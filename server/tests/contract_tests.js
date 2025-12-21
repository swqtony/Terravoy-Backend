import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.HOST || 'http://localhost:3000';
const TRAVELER = 'contract_traveler';
const HOST_USER = 'contract_host';
const TRAVELER_SESSION = process.env.TRAVELER_SESSION_TOKEN || 'contract_traveler_session';
const HOST_SESSION = process.env.HOST_SESSION_TOKEN || 'contract_host_session';
const MATCH_PREFS = {
  preferredGender: 'female',
  preferredAgeMin: 20,
  preferredAgeMax: 35,
  preferredLanguages: ['en'],
  cityScopeMode: 'Strict',
  note: 'keep_for_reuse',
};

function loadGolden(name) {
  const p = path.resolve(__dirname, '..', '..', 'tests', 'golden', `${name}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function post(pathname, body, headers = {}, useHost = false) {
  const baseHeaders = {
    'Content-Type': 'application/json',
    'x-leancloud-user-id': useHost ? HOST_USER : TRAVELER,
    'x-leancloud-sessiontoken': useHost ? HOST_SESSION : TRAVELER_SESSION,
  };
  const resp = await fetch(`${HOST}${pathname}`, {
    method: 'POST',
    headers: { ...baseHeaders, ...headers },
    body: JSON.stringify(body || {}),
  });
  const json = await resp.json();
  return { status: resp.status, json };
}

async function putPreferences(prefs, headers = {}) {
  const baseHeaders = {
    'Content-Type': 'application/json',
    'x-leancloud-user-id': TRAVELER,
    'x-leancloud-sessiontoken': TRAVELER_SESSION,
  };
  const resp = await fetch(`${HOST}/api/v1/preferences/match`, {
    method: 'PUT',
    headers: { ...baseHeaders, ...headers },
    body: JSON.stringify(prefs || {}),
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(`preferences PUT failed ${resp.status}: ${json.message || ''}`);
  }
  return json;
}

function assertKeys(obj, keys, label) {
  for (const k of keys) {
    if (!(k in obj)) {
      throw new Error(`${label} missing key ${k}`);
    }
  }
}

async function testProfileBootstrap() {
  const g = loadGolden('profile_bootstrap');
  const { json } = await post('/functions/v1/profile-bootstrap', { leancloudUserId: TRAVELER });
  assertKeys(json.data || json, g.requiredKeys, 'profile-bootstrap');
  console.log('PASS profile-bootstrap');
  return json.data.profileId || json.data.id || json.profileId;
}

async function testTripCardCreate(profileId) {
  const g = loadGolden('trip_card_create');
  const { json } = await post('/functions/v1/trip-card-create', {
    profileId,
    destinationCity: 'shanghai',
    startDate: '2025-12-20',
    endDate: '2025-12-21',
  });
  const data = json.data || json;
  assertKeys(data, g.requiredKeys, 'trip-card-create');
  console.log('PASS trip-card-create');
  return data.id;
}

async function testMatchStart(profileId, tripCardId) {
  const g = loadGolden('match_start');
  await putPreferences(MATCH_PREFS);
  const { json } = await post(
    '/functions/v1/match-start',
    { tripCardId }
  );
  const data = json.data || json;
  if (!g.allowedStatus.includes(data.status)) {
    throw new Error(`match-start unexpected status ${data.status}`);
  }
  if (data.status === 'matched') {
    assertKeys(data, g.requiredKeysWhenMatched, 'match-start matched');
  } else {
    assertKeys(data, g.requiredKeysWhenWaiting, 'match-start waiting');
  }
  const prefs = data.preferences || {};
  if (prefs.preferredGender !== MATCH_PREFS.preferredGender) {
    throw new Error('match-start did not reuse saved preferences');
  }
  const applied = data.appliedPreferences || {};
  if (applied.preferredGender !== MATCH_PREFS.preferredGender) {
    throw new Error('appliedPreferences missing preferredGender');
  }
  if (!Array.isArray(applied.preferredLanguages) || applied.preferredLanguages[0] !== MATCH_PREFS.preferredLanguages[0]) {
    throw new Error('appliedPreferences missing preferredLanguages');
  }
  console.log('PASS match-start');
}

async function testOrderCreate(hostProfileId, travelerProfileId) {
  const g = loadGolden('order_create');
  const start = new Date().toISOString();
  const end = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const { json } = await post(
    '/functions/v1/orders',
    {
      travelerId: travelerProfileId,
      experienceId: 'exp_contract',
      hostId: hostProfileId,
      startTime: start,
      endTime: end,
      peopleCount: 1,
      totalAmount: 88,
    },
    { 'x-route': '/orders/create', 'x-terra-role': 'traveler' }
  );
  const data = json.data || json;
  assertKeys(data, g.requiredKeys, 'order-create');
  console.log('PASS order-create');
  return data.id;
}

async function main() {
  const travelerProfile = await testProfileBootstrap();
  await post('/functions/v1/profile-update', {
    profileId: travelerProfile,
    gender: 'male',
    age: 30,
    firstLanguage: 'en',
    secondLanguage: 'en',
    homeCity: 'shanghai',
  });

  const tripCardId = await testTripCardCreate(travelerProfile);
  await testMatchStart(travelerProfile, tripCardId);

  // Host prep
  const { json: hostJson } = await post('/functions/v1/profile-bootstrap', { leancloudUserId: HOST_USER }, {}, true);
  const hostProfile = (hostJson.data || hostJson).profileId;
  await post('/functions/v1/profile-update', {
    profileId: hostProfile,
    gender: 'female',
    age: 28,
    firstLanguage: 'en',
    secondLanguage: 'en',
    homeCity: 'shanghai',
  }, {}, true);

  await testOrderCreate(hostProfile, travelerProfile);

  console.log('ALL CONTRACT TESTS PASS');
}

main().catch((err) => {
  console.error('Contract tests FAILED', err);
  process.exit(1);
});

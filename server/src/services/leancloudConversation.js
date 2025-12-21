import fetch from 'node-fetch';
import { config } from '../config.js';

function normalizeMembers(memberLeanIds) {
  if (!Array.isArray(memberLeanIds)) return [];
  return memberLeanIds
    .filter((id) => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim());
}

function uniquePair(memberLeanIds) {
  const members = Array.from(new Set(memberLeanIds));
  if (members.length !== 2) return null;
  return members.sort();
}

function leanHeaders({ useMaster }) {
  const headers = {
    'Content-Type': 'application/json',
    'X-LC-Id': config.lean.appId,
  };
  if (useMaster && config.lean.masterKey) {
    headers['X-LC-Key'] = `${config.lean.masterKey},master`;
  } else {
    headers['X-LC-Key'] = config.lean.appKey;
  }
  return headers;
}

function ensureLeanConfig() {
  const missing = [];
  if (!config.lean.server) missing.push('LEAN_SERVER');
  if (!config.lean.appId) missing.push('LEAN_APP_ID');
  if (!config.lean.appKey && !config.lean.masterKey) missing.push('LEAN_APP_KEY/LEAN_MASTER_KEY');
  if (missing.length > 0) {
    throw new Error(`LeanCloud config missing: ${missing.join(', ')}`);
  }
}

async function fetchJson(url, options) {
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LeanCloud request failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

async function findExistingConversation(memberLeanIds, { logger, context } = {}) {
  const members = uniquePair(normalizeMembers(memberLeanIds));
  if (!members) return null;
  ensureLeanConfig();
  const server = (config.lean.server || '').replace(/\/+$/, '');
  const where = { m: { $all: members } };
  const query = new URLSearchParams({
    where: JSON.stringify(where),
    limit: '10',
    order: '-updatedAt',
  });
  const url = `${server}/1.1/classes/_Conversation?${query.toString()}`;
  const json = await fetchJson(url, {
    method: 'GET',
    headers: leanHeaders({ useMaster: true }),
  });
  const results = Array.isArray(json?.results) ? json.results : [];
  const matched = results.find((row) => {
    const rowMembers = Array.isArray(row?.m) ? row.m : [];
    return rowMembers.length === 2 && members.every((m) => rowMembers.includes(m));
  });
  if (matched?.objectId && logger?.info) {
    logger.info(
      {
        event: 'conversation.reused',
        conversationId: matched.objectId,
        members,
        ...context,
      },
      'LeanCloud conversation reused'
    );
  }
  return matched?.objectId || null;
}

async function createConversation(memberLeanIds, { logger, context } = {}) {
  const members = uniquePair(normalizeMembers(memberLeanIds));
  if (!members) {
    throw new Error('LeanCloud conversation requires exactly 2 members');
  }
  ensureLeanConfig();
  const server = (config.lean.server || '').replace(/\/+$/, '');
  const body = {
    m: members,
    name: 'Match Chat',
    attr: { type: 'matchChat', category: 'matchChat' },
    tr: false,
    sys: false,
    unique: true,
  };
  const json = await fetchJson(`${server}/1.1/classes/_Conversation`, {
    method: 'POST',
    headers: leanHeaders({ useMaster: true }),
    body: JSON.stringify(body),
  });
  const conversationId = json?.objectId || null;
  if (!conversationId) {
    throw new Error('LeanCloud conversation create missing objectId');
  }
  if (logger?.info) {
    logger.info(
      {
        event: 'conversation.created',
        conversationId,
        members,
        ...context,
      },
      'LeanCloud conversation created'
    );
  }
  return conversationId;
}

export async function createOrReuseConversation(memberLeanIds, { logger, context } = {}) {
  const existingId = await findExistingConversation(memberLeanIds, { logger, context });
  if (existingId) return { conversationId: existingId, reused: true };
  const createdId = await createConversation(memberLeanIds, { logger, context });
  return { conversationId: createdId, reused: false };
}

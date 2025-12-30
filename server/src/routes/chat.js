import { ok, error } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';

const ALLOWED_TYPES = new Set(['match', 'order', 'support']);
const ALLOWED_ROLES = new Set(['traveler', 'host']);

async function requireImAuth(req, reply) {
  try {
    const auth = await requireAuth(req, reply);
    if (!auth) return null;
    if (auth.tokenType !== 'access') {
      error(reply, 'IM_AUTH_REQUIRED', 'IM requires access token', 401);
      return null;
    }
    return auth;
  } catch (err) {
    if (respondAuthError(err, reply)) return null;
    throw err;
  }
}

function normalizeUuid(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseEnsurePayload(body) {
  const type = (body?.type || '').toString().trim();
  const matchSessionId = normalizeUuid(body?.matchSessionId);
  const orderId = normalizeUuid(body?.orderId);
  const members = Array.isArray(body?.members) ? body.members : [];
  return { type, matchSessionId, orderId, members };
}

function validateMembers(members) {
  if (members.length < 2) {
    const err = new Error('members must include two users');
    err.code = 'INVALID_MEMBERS';
    err.statusCode = 400;
    throw err;
  }
  for (const member of members) {
    const userId = normalizeUuid(member?.userId);
    const role = (member?.role || '').toString().trim();
    if (!userId || !ALLOWED_ROLES.has(role)) {
      const err = new Error('invalid member');
      err.code = 'INVALID_MEMBERS';
      err.statusCode = 400;
      throw err;
    }
  }
}

function ensureAuthInMembers(auth, members) {
  const has = members.some((m) => normalizeUuid(m?.userId) === auth.userId);
  if (!has) {
    const err = new Error('forbidden');
    err.code = 'FORBIDDEN';
    err.statusCode = 403;
    throw err;
  }
}

async function fetchMember(pool, threadId, userId) {
  const { rows } = await pool.query(
    `select thread_id, user_id, last_read_seq
     from chat_thread_members
     where thread_id = $1 and user_id = $2`,
    [threadId, userId]
  );
  return rows[0] || null;
}

export default async function chatRoutes(app) {
  const pool = app.pg.pool;

  app.post('/chat/threads/ensure', async (req, reply) => {
    const auth = await requireImAuth(req, reply);
    if (!auth) return;

    const payload = parseEnsurePayload(req.body || {});
    if (!ALLOWED_TYPES.has(payload.type)) {
      return error(reply, 'INVALID_REQUEST', 'invalid type', 400);
    }
    if (payload.type === 'match' && !payload.matchSessionId) {
      return error(reply, 'INVALID_REQUEST', 'matchSessionId is required', 400);
    }
    if (payload.type === 'order' && !payload.orderId) {
      return error(reply, 'INVALID_REQUEST', 'orderId is required', 400);
    }
    if (payload.type !== 'support' && payload.members.length === 0) {
      return error(reply, 'INVALID_REQUEST', 'members are required', 400);
    }

    try {
      validateMembers(payload.members);
      ensureAuthInMembers(auth, payload.members);
      const client = await pool.connect();
      try {
        await client.query('begin');
        let thread = null;
        if (payload.type === 'match') {
          const { rows } = await client.query(
            `insert into chat_threads (type, match_session_id)
             values ($1, $2)
             on conflict (match_session_id)
             do update set updated_at = now()
             returning *`,
            [payload.type, payload.matchSessionId]
          );
          thread = rows[0];
        } else if (payload.type === 'order') {
          const { rows } = await client.query(
            `insert into chat_threads (type, order_id)
             values ($1, $2)
             on conflict (order_id)
             do update set updated_at = now()
             returning *`,
            [payload.type, payload.orderId]
          );
          thread = rows[0];
        } else {
          const { rows } = await client.query(
            `insert into chat_threads (type)
             values ($1)
             returning *`,
            [payload.type]
          );
          thread = rows[0];
        }

        for (const member of payload.members) {
          await client.query(
            `insert into chat_thread_members (thread_id, user_id, role)
             values ($1, $2, $3)
             on conflict do nothing`,
            [thread.id, normalizeUuid(member.userId), member.role]
          );
        }
        await client.query('commit');
        return ok(reply, {
          threadId: thread.id,
          type: thread.type,
          status: thread.status,
          matchSessionId: thread.match_session_id,
          orderId: thread.order_id,
          lastSeq: Number(thread.last_seq || 0),
          lastMessageAt: thread.last_message_at,
        });
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      if (err?.statusCode) {
        return error(reply, err.code || 'INVALID_REQUEST', err.message, err.statusCode);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to ensure thread', 500);
    }
  });

  app.get('/chat/threads', async (req, reply) => {
    const auth = await requireImAuth(req, reply);
    if (!auth) return;

    const limit = Math.min(Number(req.query?.limit || 50), 200);
    const offset = Math.max(Number(req.query?.offset || 0), 0);
    try {
      const { rows } = await pool.query(
        `select t.id,
                t.type,
                t.status,
                t.match_session_id,
                t.order_id,
                t.last_seq,
                t.last_message_at,
                m.last_read_seq,
                greatest(t.last_seq - m.last_read_seq, 0) as unread_count
         from chat_thread_members m
         join chat_threads t on t.id = m.thread_id
         where m.user_id = $1
         order by coalesce(t.last_message_at, t.updated_at) desc
         limit $2 offset $3`,
        [auth.userId, limit, offset]
      );
      return ok(reply, {
        threads: rows.map((row) => ({
          id: row.id,
          type: row.type,
          status: row.status,
          matchSessionId: row.match_session_id,
          orderId: row.order_id,
          lastSeq: Number(row.last_seq || 0),
          lastMessageAt: row.last_message_at,
          lastReadSeq: Number(row.last_read_seq || 0),
          unreadCount: Number(row.unread_count || 0),
          lastMessage: null,
        })),
      });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch threads', 500);
    }
  });

  app.post('/chat/threads/:id/read', async (req, reply) => {
    const auth = await requireImAuth(req, reply);
    if (!auth) return;

    const threadId = normalizeUuid(req.params?.id);
    const lastReadSeq = Number(req.body?.lastReadSeq);
    if (!threadId) {
      return error(reply, 'INVALID_REQUEST', 'thread id is required', 400);
    }
    if (!Number.isFinite(lastReadSeq) || lastReadSeq < 0) {
      return error(reply, 'INVALID_REQUEST', 'lastReadSeq is required', 400);
    }

    try {
      const member = await fetchMember(pool, threadId, auth.userId);
      if (!member) {
        return error(reply, 'FORBIDDEN', 'Not a member', 403);
      }
      const { rows } = await pool.query(
        `update chat_thread_members
         set last_read_seq = greatest(last_read_seq, $1),
             updated_at = now()
         where thread_id = $2 and user_id = $3
         returning last_read_seq`,
        [lastReadSeq, threadId, auth.userId]
      );
      return ok(reply, { lastReadSeq: Number(rows[0]?.last_read_seq || 0) });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to update read state', 500);
    }
  });
}

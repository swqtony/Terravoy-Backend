import { ok, error } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';
import { config } from '../config.js';

const TARGET_TYPES = new Set(['chat', 'post', 'experience', 'user']);
const REASON_CODES = new Set(['spam', 'scam', 'harassment', 'illegal', 'other']);
const STATUSES = new Set(['pending', 'reviewing', 'resolved', 'rejected']);

function isAdmin(auth, req) {
  const adminKey = (req.headers['x-admin-key'] || '').toString();
  if (config.admin.apiKey && adminKey === config.admin.apiKey) return true;
  return auth.tokenType === 'terra' && auth.role === 'admin';
}

export default async function reportsRoutes(app) {
  const pool = app.pg.pool;

  app.post('/v1/reports', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    if (!auth) return;

    const targetType = (req.body?.targetType || '').toString().trim();
    const targetId = (req.body?.targetId || '').toString().trim();
    const reasonCode = (req.body?.reasonCode || '').toString().trim();
    const description = (req.body?.description || '').toString().trim() || null;

    if (!TARGET_TYPES.has(targetType) || !targetId || !REASON_CODES.has(reasonCode)) {
      return error(reply, 'INVALID_REQUEST', 'Invalid report payload', 400);
    }

    try {
      const { rows } = await pool.query(
        `insert into reports (reporter_id, target_type, target_id, reason_code, description)
         values ($1, $2, $3, $4, $5) returning id, status`,
        [auth.userId, targetType, targetId, reasonCode, description]
      );
      return ok(reply, rows[0]);
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to create report', 500);
    }
  });

  app.get('/v1/admin/reports', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    if (!auth) return;
    if (!isAdmin(auth, req)) {
      return error(reply, 'FORBIDDEN', 'Admin role required', 403);
    }

    const status = (req.query?.status || 'pending').toString().trim();
    const limit = Number(req.query?.limit || 20);
    const offset = Number(req.query?.offset || 0);
    if (!STATUSES.has(status)) {
      return error(reply, 'INVALID_REQUEST', 'Invalid status', 400);
    }
    try {
      const { rows } = await pool.query(
        `select * from reports where status = $1 order by created_at desc limit $2 offset $3`,
        [status, limit, offset]
      );
      return ok(reply, { items: rows, limit, offset });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch reports', 500);
    }
  });

  app.patch('/v1/admin/reports/:id', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    if (!auth) return;
    if (!isAdmin(auth, req)) {
      return error(reply, 'FORBIDDEN', 'Admin role required', 403);
    }

    const id = req.params?.id;
    const status = (req.body?.status || '').toString().trim();
    if (!id || !STATUSES.has(status)) {
      return error(reply, 'INVALID_REQUEST', 'Invalid status', 400);
    }

    try {
      const { rows } = await pool.query(
        `update reports set status = $1 where id = $2 returning id, status`,
        [status, id]
      );
      if (!rows[0]) {
        return error(reply, 'NOT_FOUND', 'Report not found', 404);
      }
      return ok(reply, rows[0]);
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to update report', 500);
    }
  });
}

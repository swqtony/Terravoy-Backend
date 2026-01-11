import { ok, error } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';
const TARGET_TYPES = new Set(['chat', 'post', 'experience', 'user', 'discover_comment']);
const REASON_CODES = new Set(['spam', 'scam', 'harassment', 'illegal', 'other']);

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

}

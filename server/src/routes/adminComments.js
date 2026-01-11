import { ok, error } from '../utils/responses.js';
import { requirePermission } from '../middlewares/adminPermissions.js';
import { logAdminAudit } from '../services/adminAuditService.js';

const STATUS_SET = new Set(['hidden', 'published', 'deleted']);

function normalizeString(value) {
  return (value || '').toString().trim();
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].split(',')[0].trim();
  }
  return req.ip || '';
}

export default async function adminCommentsRoutes(app) {
  const pool = app.pg.pool;
  const requirePostsWrite = requirePermission('posts.write', pool);

  app.patch('/functions/v1/admin/comments/:id', async (req, reply) => {
    const admin = await requirePostsWrite(req, reply);
    if (!admin) return;

    const id = normalizeString(req.params?.id);
    const status = normalizeString(req.body?.status || '');
    const reason = normalizeString(req.body?.reason || '');

    if (!id) {
      return error(reply, 'INVALID_REQUEST', 'Invalid comment id', 400);
    }
    if (!status || !STATUS_SET.has(status)) {
      return error(reply, 'INVALID_REQUEST', 'Invalid status', 400);
    }
    if (!reason) {
      return error(reply, 'INVALID_REQUEST', 'reason is required', 400);
    }

    try {
      const beforeResult = await pool.query(
        'select * from discover_comments where id = $1',
        [id]
      );
      const before = beforeResult.rows[0];
      if (!before) {
        return error(reply, 'NOT_FOUND', 'Comment not found', 404);
      }

      const { rows } = await pool.query(
        `update discover_comments
         set status = $1,
             updated_at = now()
         where id = $2
         returning *`,
        [status, id]
      );

      const after = rows[0];
      await logAdminAudit({
        pool,
        adminUserId: admin.sub,
        action: 'comments.update',
        resourceType: 'comment',
        resourceId: id,
        before,
        after,
        reason,
        ip: getClientIp(req),
        ua: req.headers['user-agent'] || null,
      });

      return ok(reply, after);
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to update comment', 500);
    }
  });
}

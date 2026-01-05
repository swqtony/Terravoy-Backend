import { ok, error } from '../utils/responses.js';
import { requirePermission } from '../middlewares/adminPermissions.js';
import { logAdminAudit } from '../services/adminAuditService.js';

const STATUS_SET = new Set(['published', 'hidden', 'removed']);

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

function parsePagination(query) {
  const page = Math.max(1, Number(query?.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(query?.pageSize || 20)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export default async function adminPostsRoutes(app) {
  const pool = app.pg.pool;
  const requirePostsRead = requirePermission('posts.read', pool);
  const requirePostsWrite = requirePermission('posts.write', pool);

  app.get('/functions/v1/admin/posts', async (req, reply) => {
    const admin = await requirePostsRead(req, reply);
    if (!admin) return;

    const status = normalizeString(req.query?.status || '');
    const q = normalizeString(req.query?.q || '');
    const dateFrom = normalizeString(req.query?.dateFrom || '');
    const dateTo = normalizeString(req.query?.dateTo || '');
    const { page, pageSize, offset } = parsePagination(req.query || {});

    if (status && !STATUS_SET.has(status)) {
      return error(reply, 'INVALID_REQUEST', 'Invalid status', 400);
    }

    const where = [];
    const params = [];

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(
        `(id::text ilike $${params.length} or author_id ilike $${params.length} or author_name ilike $${params.length} or content ilike $${params.length})`
      );
    }
    if (dateFrom) {
      params.push(dateFrom);
      where.push(`created_at >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      where.push(`created_at <= $${params.length}`);
    }

    const whereClause = where.length ? `where ${where.join(' and ')}` : '';

    try {
      const countResult = await pool.query(
        `select count(*)::int as total from discover_posts ${whereClause}`,
        params
      );
      const total = countResult.rows[0]?.total || 0;

      params.push(pageSize, offset);
      const { rows } = await pool.query(
        `select * from discover_posts ${whereClause}
         order by created_at desc
         limit $${params.length - 1} offset $${params.length}`,
        params
      );

      return ok(reply, { items: rows, page, pageSize, total });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch posts', 500);
    }
  });

  app.get('/functions/v1/admin/posts/:id', async (req, reply) => {
    const admin = await requirePostsRead(req, reply);
    if (!admin) return;

    const id = normalizeString(req.params?.id);
    if (!id) {
      return error(reply, 'INVALID_REQUEST', 'Invalid post id', 400);
    }

    try {
      const { rows } = await pool.query('select * from discover_posts where id = $1', [id]);
      if (!rows[0]) {
        return error(reply, 'NOT_FOUND', 'Post not found', 404);
      }
      return ok(reply, rows[0]);
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch post', 500);
    }
  });

  app.patch('/functions/v1/admin/posts/:id', async (req, reply) => {
    const admin = await requirePostsWrite(req, reply);
    if (!admin) return;

    const id = normalizeString(req.params?.id);
    const status = normalizeString(req.body?.status || '');
    const adminNote = normalizeString(req.body?.admin_note || '');
    const reason = normalizeString(req.body?.reason || '');

    if (!id) {
      return error(reply, 'INVALID_REQUEST', 'Invalid post id', 400);
    }
    if (!status || !STATUS_SET.has(status)) {
      return error(reply, 'INVALID_REQUEST', 'Invalid status', 400);
    }
    if (!reason) {
      return error(reply, 'INVALID_REQUEST', 'reason is required', 400);
    }

    try {
      const beforeResult = await pool.query('select * from discover_posts where id = $1', [id]);
      const before = beforeResult.rows[0];
      if (!before) {
        return error(reply, 'NOT_FOUND', 'Post not found', 404);
      }

      const { rows } = await pool.query(
        `update discover_posts
         set status = $1,
             admin_note = $2,
             updated_at = now()
         where id = $3
         returning *`,
        [status, adminNote || null, id]
      );

      const after = rows[0];
      await logAdminAudit({
        pool,
        adminUserId: admin.sub,
        action: 'posts.update',
        resourceType: 'post',
        resourceId: id,
        before,
        after,
        reason,
        ip: getClientIp(req),
        ua: req.headers['user-agent'] || null,
      });

      return ok(reply, after);
    } catch (err) {
      if (err?.statusCode === 400 && err.code === 'REASON_REQUIRED') {
        return error(reply, 'INVALID_REQUEST', 'reason is required', 400);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to update post', 500);
    }
  });
}

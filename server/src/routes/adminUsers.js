import { ok, error } from '../utils/responses.js';
import { requirePermission } from '../middlewares/adminPermissions.js';
import { logAdminAudit } from '../services/adminAuditService.js';

const STATUS_SET = new Set([0, 1]);

function normalizeString(value) {
  return (value || '').toString().trim();
}

function normalizeInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

export default async function adminUsersRoutes(app) {
  const pool = app.pg.pool;
  const requireUsersRead = requirePermission('users.read', pool);
  const requireUsersWrite = requirePermission('users.write', pool);

  app.get('/functions/v1/admin/users', async (req, reply) => {
    const admin = await requireUsersRead(req, reply);
    if (!admin) return;

    const keyword = normalizeString(req.query?.q || '');
    const status = normalizeInt(req.query?.status, -1);
    const { page, pageSize, offset } = parsePagination(req.query || {});

    const where = [];
    const params = [];
    if (keyword) {
      params.push(`%${keyword}%`);
      where.push(`(id::text ilike $${params.length} or phone ilike $${params.length})`);
    }
    if (STATUS_SET.has(status)) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    const whereClause = where.length ? `where ${where.join(' and ')}` : '';

    try {
      const countResult = await pool.query(
        `select count(*)::int as total from auth_users ${whereClause}`,
        params
      );
      const total = countResult.rows[0]?.total || 0;

      params.push(pageSize, offset);
      const { rows } = await pool.query(
        `select id, phone, created_at, status
         from auth_users ${whereClause}
         order by created_at desc
         limit $${params.length - 1} offset $${params.length}`,
        params
      );

      return ok(reply, { items: rows, page, pageSize, total });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch users', 500);
    }
  });

  app.patch('/functions/v1/admin/users/:id/status', async (req, reply) => {
    const admin = await requireUsersWrite(req, reply);
    if (!admin) return;

    const id = normalizeString(req.params?.id);
    const status = normalizeInt(req.body?.status, -1);
    const reason = normalizeString(req.body?.reason || '');

    if (!id) {
      return error(reply, 'INVALID_REQUEST', 'Invalid user id', 400);
    }
    if (!STATUS_SET.has(status)) {
      return error(reply, 'INVALID_REQUEST', 'Invalid status', 400);
    }
    if (!reason) {
      return error(reply, 'INVALID_REQUEST', 'reason is required', 400);
    }

    try {
      const beforeResult = await pool.query(
        'select id, phone, created_at, status from auth_users where id = $1',
        [id]
      );
      const before = beforeResult.rows[0];
      if (!before) {
        return error(reply, 'NOT_FOUND', 'User not found', 404);
      }

      const { rows } = await pool.query(
        `update auth_users set status = $1 where id = $2 returning id, phone, created_at, status`,
        [status, id]
      );
      const after = rows[0];

      await logAdminAudit({
        pool,
        adminUserId: admin.sub,
        action: 'users.update_status',
        resourceType: 'user',
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
      return error(reply, 'SERVER_ERROR', 'Failed to update user', 500);
    }
  });
}

import { ok, error } from '../utils/responses.js';
import { requirePermission } from '../middlewares/adminPermissions.js';
import { logAdminAudit } from '../services/adminAuditService.js';

const STATUS_SET = new Set(['active', 'disabled']);

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

async function loadRoles(pool, adminUserId) {
  const { rows } = await pool.query(
    `select r.key
     from admin_user_roles ur
     join admin_roles r on r.id = ur.role_id
     where ur.admin_user_id = $1`,
    [adminUserId]
  );
  return rows.map((row) => row.key);
}

export default async function adminAdminUsersRoutes(app) {
  const pool = app.pg.pool;
  const requireAdminUsersRead = requirePermission('admin_users.read', pool);
  const requireAdminUsersWrite = requirePermission('admin_users.write', pool);

  app.get('/functions/v1/admin/admin-users', async (req, reply) => {
    const admin = await requireAdminUsersRead(req, reply);
    if (!admin) return;

    const keyword = normalizeString(req.query?.q || '');
    const status = normalizeString(req.query?.status || '');
    const { page, pageSize, offset } = parsePagination(req.query || {});

    const where = [];
    const params = [];
    if (keyword) {
      params.push(`%${keyword}%`);
      where.push(`(email ilike $${params.length} or id::text ilike $${params.length})`);
    }
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    const whereClause = where.length ? `where ${where.join(' and ')}` : '';

    try {
      const countResult = await pool.query(
        `select count(*)::int as total from admin_users ${whereClause}`,
        params
      );
      const total = countResult.rows[0]?.total || 0;

      params.push(pageSize, offset);
      const { rows } = await pool.query(
        `select id, email, status, created_at, last_login_at
         from admin_users ${whereClause}
         order by created_at desc
         limit $${params.length - 1} offset $${params.length}`,
        params
      );

      const items = [];
      for (const row of rows) {
        const roles = await loadRoles(pool, row.id);
        items.push({ ...row, roles });
      }

      return ok(reply, { items, page, pageSize, total });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch admin users', 500);
    }
  });

  app.patch('/functions/v1/admin/admin-users/:id/status', async (req, reply) => {
    const admin = await requireAdminUsersWrite(req, reply);
    if (!admin) return;

    if (!admin.isSuperAdmin) {
      return error(reply, 'FORBIDDEN', 'Super admin required', 403);
    }

    const id = normalizeString(req.params?.id);
    const status = normalizeString(req.body?.status || '');
    const reason = normalizeString(req.body?.reason || '');

    if (!id) {
      return error(reply, 'INVALID_REQUEST', 'Invalid admin id', 400);
    }
    if (!STATUS_SET.has(status)) {
      return error(reply, 'INVALID_REQUEST', 'Invalid status', 400);
    }
    if (!reason) {
      return error(reply, 'INVALID_REQUEST', 'reason is required', 400);
    }

    try {
      const beforeResult = await pool.query(
        'select id, email, status, created_at, last_login_at from admin_users where id = $1',
        [id]
      );
      const before = beforeResult.rows[0];
      if (!before) {
        return error(reply, 'NOT_FOUND', 'Admin user not found', 404);
      }

      const { rows } = await pool.query(
        `update admin_users set status = $1 where id = $2
         returning id, email, status, created_at, last_login_at`,
        [status, id]
      );
      const after = rows[0];

      await logAdminAudit({
        pool,
        adminUserId: admin.sub,
        action: 'admin_users.update',
        resourceType: 'admin_user',
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
      return error(reply, 'SERVER_ERROR', 'Failed to update admin user', 500);
    }
  });

  app.patch('/functions/v1/admin/admin-users/:id/role', async (req, reply) => {
    const admin = await requireAdminUsersWrite(req, reply);
    if (!admin) return;

    if (!admin.isSuperAdmin) {
      return error(reply, 'FORBIDDEN', 'Super admin required', 403);
    }

    const id = normalizeString(req.params?.id);
    const roleKey = normalizeString(req.body?.role || req.body?.role_key);
    const reason = normalizeString(req.body?.reason || '');

    if (!id) {
      return error(reply, 'INVALID_REQUEST', 'Invalid admin id', 400);
    }
    if (!roleKey) {
      return error(reply, 'INVALID_REQUEST', 'role is required', 400);
    }
    if (!reason) {
      return error(reply, 'INVALID_REQUEST', 'reason is required', 400);
    }

    try {
      const beforeResult = await pool.query(
        'select id, email, status, created_at, last_login_at from admin_users where id = $1',
        [id]
      );
      const before = beforeResult.rows[0];
      if (!before) {
        return error(reply, 'NOT_FOUND', 'Admin user not found', 404);
      }

      const roleResult = await pool.query('select id, key from admin_roles where key = $1', [roleKey]);
      const role = roleResult.rows[0];
      if (!role) {
        return error(reply, 'INVALID_REQUEST', 'Invalid role', 400);
      }

      await pool.query('delete from admin_user_roles where admin_user_id = $1', [id]);
      await pool.query(
        'insert into admin_user_roles (admin_user_id, role_id) values ($1, $2)',
        [id, role.id]
      );

      const roles = await loadRoles(pool, id);

      await logAdminAudit({
        pool,
        adminUserId: admin.sub,
        action: 'admin_users.update',
        resourceType: 'admin_user',
        resourceId: id,
        before,
        after: { ...before, roles },
        reason,
        ip: getClientIp(req),
        ua: req.headers['user-agent'] || null,
      });

      return ok(reply, { id, roles });
    } catch (err) {
      if (err?.statusCode === 400 && err.code === 'REASON_REQUIRED') {
        return error(reply, 'INVALID_REQUEST', 'reason is required', 400);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to update admin role', 500);
    }
  });
}

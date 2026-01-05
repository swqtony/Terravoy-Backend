import { ok, error } from '../utils/responses.js';
import { requirePermission } from '../middlewares/adminPermissions.js';

function normalizeString(value) {
  return (value || '').toString().trim();
}

function parsePagination(query) {
  const page = Math.max(1, Number(query?.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(query?.pageSize || 20)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export default async function adminAuditLogsRoutes(app) {
  const pool = app.pg.pool;
  const requireAuditRead = requirePermission('audit.read', pool);

  app.get('/functions/v1/admin/audit-logs', async (req, reply) => {
    const admin = await requireAuditRead(req, reply);
    if (!admin) return;

    const adminUserId = normalizeString(req.query?.adminUserId || '');
    const action = normalizeString(req.query?.action || '');
    const resourceType = normalizeString(req.query?.resourceType || '');
    const dateFrom = normalizeString(req.query?.dateFrom || '');
    const dateTo = normalizeString(req.query?.dateTo || '');
    const { page, pageSize, offset } = parsePagination(req.query || {});

    const where = [];
    const params = [];
    if (adminUserId) {
      params.push(adminUserId);
      where.push(`admin_user_id = $${params.length}`);
    }
    if (action) {
      params.push(action);
      where.push(`action = $${params.length}`);
    }
    if (resourceType) {
      params.push(resourceType);
      where.push(`resource_type = $${params.length}`);
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
        `select count(*)::int as total from admin_audit_logs ${whereClause}`,
        params
      );
      const total = countResult.rows[0]?.total || 0;

      params.push(pageSize, offset);
      const { rows } = await pool.query(
        `select * from admin_audit_logs ${whereClause}
         order by created_at desc
         limit $${params.length - 1} offset $${params.length}`,
        params
      );

      return ok(reply, { items: rows, page, pageSize, total });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch audit logs', 500);
    }
  });
}

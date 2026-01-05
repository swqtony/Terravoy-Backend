import { ok, error } from '../utils/responses.js';
import { requirePermission } from '../middlewares/adminPermissions.js';
import { logAdminAudit } from '../services/adminAuditService.js';

const STATUSES = new Set(['pending', 'reviewing', 'resolved', 'rejected']);
const TARGET_TYPES = new Set(['chat', 'post', 'experience', 'user']);

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

function registerRoutes(app, basePath) {
  const pool = app.pg.pool;
  const requireReportsRead = requirePermission('reports.read', pool);
  const requireReportsWrite = requirePermission('reports.write', pool);

  app.get(`${basePath}/reports`, async (req, reply) => {
    const admin = await requireReportsRead(req, reply);
    if (!admin) return;

    const status = normalizeString(req.query?.status || 'pending');
    const type = normalizeString(req.query?.type || '');
    const q = normalizeString(req.query?.q || '');
    const dateFrom = normalizeString(req.query?.dateFrom || '');
    const dateTo = normalizeString(req.query?.dateTo || '');
    const { page, pageSize, offset } = parsePagination(req.query || {});

    if (status && !STATUSES.has(status)) {
      return error(reply, 'INVALID_REQUEST', 'Invalid status', 400);
    }
    if (type && !TARGET_TYPES.has(type)) {
      return error(reply, 'INVALID_REQUEST', 'Invalid type', 400);
    }

    const where = [];
    const params = [];
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (type) {
      params.push(type);
      where.push(`target_type = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(target_id ilike $${params.length} or description ilike $${params.length})`);
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
        `select count(*)::int as total from reports ${whereClause}`,
        params
      );
      const total = countResult.rows[0]?.total || 0;

      params.push(pageSize, offset);
      const { rows } = await pool.query(
        `select * from reports ${whereClause}
         order by created_at desc
         limit $${params.length - 1} offset $${params.length}`,
        params
      );

      return ok(reply, { items: rows, page, pageSize, total });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch reports', 500);
    }
  });

  app.get(`${basePath}/reports/:id`, async (req, reply) => {
    const admin = await requireReportsRead(req, reply);
    if (!admin) return;

    const id = normalizeString(req.params?.id);
    if (!id) {
      return error(reply, 'INVALID_REQUEST', 'Invalid report id', 400);
    }

    try {
      const { rows } = await pool.query('select * from reports where id = $1', [id]);
      if (!rows[0]) {
        return error(reply, 'NOT_FOUND', 'Report not found', 404);
      }
      return ok(reply, rows[0]);
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch report', 500);
    }
  });

  app.patch(`${basePath}/reports/:id`, async (req, reply) => {
    const admin = await requireReportsWrite(req, reply);
    if (!admin) return;

    const id = normalizeString(req.params?.id);
    const status = normalizeString(req.body?.status || '');
    const resolution = normalizeString(req.body?.resolution || '');
    const handlingNote = normalizeString(req.body?.handling_note || '');
    const reason = normalizeString(req.body?.reason || '');

    if (!id) {
      return error(reply, 'INVALID_REQUEST', 'Invalid report id', 400);
    }
    if (!status || !STATUSES.has(status)) {
      return error(reply, 'INVALID_REQUEST', 'Invalid status', 400);
    }
    if (!reason) {
      return error(reply, 'INVALID_REQUEST', 'reason is required', 400);
    }

    try {
      const beforeResult = await pool.query('select * from reports where id = $1', [id]);
      const before = beforeResult.rows[0];
      if (!before) {
        return error(reply, 'NOT_FOUND', 'Report not found', 404);
      }

      const { rows } = await pool.query(
        `update reports
         set status = $1,
             resolution = $2,
             handling_note = $3,
             updated_at = now()
         where id = $4
         returning *`,
        [status, resolution || null, handlingNote || null, id]
      );

      const after = rows[0];
      await logAdminAudit({
        pool,
        adminUserId: admin.sub,
        action: 'reports.update',
        resourceType: 'report',
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
      return error(reply, 'SERVER_ERROR', 'Failed to update report', 500);
    }
  });
}

export default async function adminReportsRoutes(app) {
  registerRoutes(app, '/functions/v1/admin');
  registerRoutes(app, '/v1/admin');
}

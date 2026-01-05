import { ok, error } from '../utils/responses.js';
import { requirePermission } from '../middlewares/adminPermissions.js';
import { logAdminAudit } from '../services/adminAuditService.js';

const DISPUTE_STATUSES = new Set(['none', 'open', 'resolved']);

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

export default async function adminOrdersRoutes(app) {
  const pool = app.pg.pool;
  const requireOrdersRead = requirePermission('orders.read', pool);
  const requireOrdersWrite = requirePermission('orders.write', pool);

  app.get('/functions/v1/admin/orders', async (req, reply) => {
    const admin = await requireOrdersRead(req, reply);
    if (!admin) return;

    const status = normalizeString(req.query?.status || '');
    const q = normalizeString(req.query?.q || '');
    const dateFrom = normalizeString(req.query?.dateFrom || '');
    const dateTo = normalizeString(req.query?.dateTo || '');
    const { page, pageSize, offset } = parsePagination(req.query || {});

    const where = [];
    const params = [];

    if (status) {
      params.push(status);
      where.push(`o.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(
        `(o.order_no ilike $${params.length} or o.id::text ilike $${params.length} or o.traveler_id::text ilike $${params.length} or o.host_id::text ilike $${params.length} or t.phone ilike $${params.length} or h.phone ilike $${params.length})`
      );
    }
    if (dateFrom) {
      params.push(dateFrom);
      where.push(`o.created_at >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      where.push(`o.created_at <= $${params.length}`);
    }

    const whereClause = where.length ? `where ${where.join(' and ')}` : '';

    try {
      const countResult = await pool.query(
        `select count(*)::int as total
         from orders o
         left join auth_users t on t.id = o.traveler_id
         left join auth_users h on h.id = o.host_id
         ${whereClause}`,
        params
      );
      const total = countResult.rows[0]?.total || 0;

      params.push(pageSize, offset);
      const { rows } = await pool.query(
        `select o.*, t.phone as traveler_phone, h.phone as host_phone
         from orders o
         left join auth_users t on t.id = o.traveler_id
         left join auth_users h on h.id = o.host_id
         ${whereClause}
         order by o.created_at desc
         limit $${params.length - 1} offset $${params.length}`,
        params
      );

      return ok(reply, { items: rows, page, pageSize, total });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch orders', 500);
    }
  });

  app.get('/functions/v1/admin/orders/:id', async (req, reply) => {
    const admin = await requireOrdersRead(req, reply);
    if (!admin) return;

    const id = normalizeString(req.params?.id);
    if (!id) {
      return error(reply, 'INVALID_REQUEST', 'Invalid order id', 400);
    }

    try {
      const { rows } = await pool.query(
        `select o.*, t.phone as traveler_phone, h.phone as host_phone
         from orders o
         left join auth_users t on t.id = o.traveler_id
         left join auth_users h on h.id = o.host_id
         where o.id = $1`,
        [id]
      );
      if (!rows[0]) {
        return error(reply, 'NOT_FOUND', 'Order not found', 404);
      }
      const logs = await pool.query(
        `select * from order_status_logs where order_id = $1 order by created_at desc`,
        [id]
      );
      return ok(reply, { order: rows[0], status_logs: logs.rows || [] });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch order', 500);
    }
  });

  app.patch('/functions/v1/admin/orders/:id', async (req, reply) => {
    const admin = await requireOrdersWrite(req, reply);
    if (!admin) return;

    const id = normalizeString(req.params?.id);
    const disputeStatus = normalizeString(req.body?.dispute_status || '');
    const csNote = normalizeString(req.body?.cs_note || '');
    const reason = normalizeString(req.body?.reason || '');

    if (!id) {
      return error(reply, 'INVALID_REQUEST', 'Invalid order id', 400);
    }
    if (!reason) {
      return error(reply, 'INVALID_REQUEST', 'reason is required', 400);
    }
    if (disputeStatus && !DISPUTE_STATUSES.has(disputeStatus)) {
      return error(reply, 'INVALID_REQUEST', 'Invalid dispute status', 400);
    }
    if (!disputeStatus && !csNote) {
      return error(reply, 'INVALID_REQUEST', 'No updates provided', 400);
    }

    try {
      const beforeResult = await pool.query('select * from orders where id = $1', [id]);
      const before = beforeResult.rows[0];
      if (!before) {
        return error(reply, 'NOT_FOUND', 'Order not found', 404);
      }

      const { rows } = await pool.query(
        `update orders
         set dispute_status = $1,
             cs_note = $2
         where id = $3
         returning *`,
        [disputeStatus || before.dispute_status || 'none', csNote || null, id]
      );

      const after = rows[0];
      await logAdminAudit({
        pool,
        adminUserId: admin.sub,
        action: 'orders.update',
        resourceType: 'order',
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
      return error(reply, 'SERVER_ERROR', 'Failed to update order', 500);
    }
  });
}

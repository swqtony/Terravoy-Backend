import { ok, error } from '../utils/responses.js';
import { requirePermission } from '../middlewares/adminPermissions.js';
import { logAdminAudit } from '../services/adminAuditService.js';
import { clearApprovedHostCache } from '../middlewares/requireApprovedHost.js';

const LIST_ALLOWED = new Set(['pending', 'approved', 'rejected']);
const PENDING_STATUSES = new Set(['submitted', 'reviewing']);

function normalizeString(value) {
  return (value || '').toString().trim();
}

function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
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

function buildListItem(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status,
    submitted_at: row.submitted_at ? row.submitted_at.toISOString() : null,
    reviewed_at: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    created_at: row.created_at ? row.created_at.toISOString() : null,
    profile: row.profile || {},
    documents: safeArray(row.documents),
    reject_reason: row.reject_reason || null,
  };
}

export default async function adminHostCertificationsRoutes(app) {
  const pool = app.pg.pool;
  const requireRead = requirePermission('host_certification.read', pool);
  const requireWrite = requirePermission('host_certification.write', pool);

  app.get('/functions/v1/admin/host-certifications', async (req, reply) => {
    const admin = await requireRead(req, reply);
    if (!admin) return;

    const status = normalizeString(req.query?.status || 'pending');
    if (status && !LIST_ALLOWED.has(status)) {
      return error(reply, 'INVALID_REQUEST', 'Invalid status', 400);
    }

    const { page, pageSize, offset } = parsePagination(req.query || {});
    const where = [];
    const params = [];

    if (status) {
      if (status === 'pending') {
        params.push([...PENDING_STATUSES]);
        where.push(`status = any($${params.length})`);
      } else {
        params.push(status);
        where.push(`status = $${params.length}`);
      }
    }

    const whereClause = where.length ? `where ${where.join(' and ')}` : '';

    try {
      const countResult = await pool.query(
        `select count(*)::int as total from host_certifications ${whereClause}`,
        params
      );
      const total = countResult.rows[0]?.total || 0;

      params.push(pageSize, offset);
      const { rows } = await pool.query(
        `select * from host_certifications ${whereClause}
         order by created_at desc
         limit $${params.length - 1} offset $${params.length}`,
        params
      );

      return ok(reply, { items: rows.map(buildListItem), page, pageSize, total });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch host certifications', 500);
    }
  });

  app.get('/functions/v1/admin/host-certifications/:id', async (req, reply) => {
    const admin = await requireRead(req, reply);
    if (!admin) return;

    const id = normalizeString(req.params?.id);
    if (!id) {
      return error(reply, 'INVALID_REQUEST', 'Invalid certification id', 400);
    }

    try {
      const { rows } = await pool.query('select * from host_certifications where id = $1', [id]);
      if (!rows[0]) {
        return error(reply, 'NOT_FOUND', 'Certification not found', 404);
      }
      return ok(reply, buildListItem(rows[0]));
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch certification', 500);
    }
  });

  app.patch('/functions/v1/admin/host-certifications/:id', async (req, reply) => {
    const admin = await requireWrite(req, reply);
    if (!admin) return;

    const id = normalizeString(req.params?.id);
    const nextStatus = normalizeString(req.body?.status || '').toLowerCase();
    const reason = normalizeString(req.body?.reason || '');

    if (!id) {
      return error(reply, 'INVALID_REQUEST', 'Invalid certification id', 400);
    }
    if (!nextStatus || !['approved', 'rejected'].includes(nextStatus)) {
      return error(reply, 'INVALID_REQUEST', 'Invalid status', 400);
    }
    if (!reason) {
      return error(reply, 'INVALID_REQUEST', 'reason is required', 400);
    }

    try {
      const { rows } = await pool.query('select * from host_certifications where id = $1', [id]);
      const before = rows[0];
      if (!before) {
        return error(reply, 'NOT_FOUND', 'Certification not found', 404);
      }
      if (!PENDING_STATUSES.has(before.status)) {
        return error(reply, 'INVALID_STATUS', 'Certification is not pending', 409);
      }

      const { rows: updatedRows } = await pool.query(
        `update host_certifications
         set status = $1,
             reviewed_at = now(),
             reviewer_id = $2,
             reject_reason = $3,
             updated_at = now()
         where id = $4
         returning *`,
        [nextStatus, admin.sub, nextStatus === 'rejected' ? reason : null, id]
      );
      const after = updatedRows[0];

      await pool.query(
        'update experiences set host_cert_status = $1 where host_user_id = $2',
        [nextStatus, before.user_id]
      );

      await logAdminAudit({
        pool,
        adminUserId: admin.sub,
        action: 'host_certification.update',
        resourceType: 'host_certification',
        resourceId: id,
        before,
        after,
        reason,
        ip: getClientIp(req),
        ua: req.headers['user-agent'] || null,
      });

      clearApprovedHostCache(before.user_id);
      return ok(reply, buildListItem(after));
    } catch (err) {
      if (err?.statusCode === 400 && err.code === 'REASON_REQUIRED') {
        return error(reply, 'INVALID_REQUEST', 'reason is required', 400);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to update certification', 500);
    }
  });
}

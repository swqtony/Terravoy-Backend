import { ok, error } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';
import { clearApprovedHostCache } from '../middlewares/requireApprovedHost.js';
import { config } from '../config.js';

const ALLOWED_UPDATE_STATUSES = new Set(['draft', 'rejected']);
const SUBMIT_ALLOWED_STATUSES = new Set(['draft', 'rejected']);
const REVIEW_ALLOWED_STATUSES = new Set(['submitted']);
const DECISION_ALLOWED_STATUSES = new Set(['submitted', 'reviewing']);
const REQUIRED_DOC_TYPES = new Set(['license']);

function normalizeString(value) {
  return (value || '').toString().trim();
}

function normalizeProfile(existing, incoming) {
  if (!incoming || typeof incoming !== 'object') return existing || {};
  const base = existing && typeof existing === 'object' ? existing : {};
  const merged = { ...base, ...incoming };
  if (incoming.credentials || base.credentials) {
    merged.credentials = {
      ...(base.credentials || {}),
      ...(incoming.credentials || {}),
    };
  }
  if (incoming.compliance || base.compliance) {
    merged.compliance = {
      ...(base.compliance || {}),
      ...(incoming.compliance || {}),
    };
  }
  return merged;
}

function normalizeDocuments(raw) {
  if (!Array.isArray(raw)) return [];
  const docs = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const mediaAssetId = normalizeString(item.media_asset_id || item.mediaAssetId || item.id);
    const objectKey = normalizeString(item.object_key || item.objectKey);
    const docType = normalizeString(item.doc_type || item.docType || item.category);
    const name = normalizeString(item.name || item.fileName || 'document');
    const sizeBytes = Number(item.sizeBytes || item.size || 0);
    const mime = normalizeString(item.mime || item.contentType);
    if (!mediaAssetId || !objectKey || !docType) continue;
    docs.push({
      media_asset_id: mediaAssetId,
      object_key: objectKey,
      doc_type: docType,
      name,
      size_bytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
      mime,
    });
  }
  return docs;
}

function serializeState(row) {
  if (!row) {
    return {
      status: 'not_submitted',
      version: 1,
      badgeLabel: null,
      updatedAt: null,
      submittedAt: null,
      approvedAt: null,
      rejectionReason: null,
      draftId: null,
      latestPayload: null,
    };
  }
  const latestPayload = {
    credentials: row.profile?.credentials || {},
    compliance: row.profile?.compliance || {},
    documents: (row.documents || []).map((doc) => ({
      id: doc.media_asset_id || doc.id || '',
      mediaAssetId: doc.media_asset_id || doc.id || '',
      objectKey: doc.object_key || '',
      category: doc.doc_type || 'license',
      name: doc.name || 'document',
      url: '',
      sizeBytes: Number(doc.size_bytes || 0),
      contentType: doc.mime || 'application/octet-stream',
      clarityScore: Number(doc.clarity_score || 0),
    })),
  };
  return {
    status: row.status,
    version: row.version,
    badgeLabel: null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
    approvedAt: row.status === 'approved' && row.reviewed_at
      ? row.reviewed_at.toISOString()
      : null,
    rejectionReason: row.reject_reason || null,
    draftId: row.id,
    latestPayload,
  };
}

function buildAdminListItem(row) {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    profile: row.profile || {},
    documents: (row.documents || []).map((doc) => ({
      mediaAssetId: doc.media_asset_id,
      objectKey: doc.object_key,
      docType: doc.doc_type,
      name: doc.name || 'document',
      sizeBytes: Number(doc.size_bytes || 0),
      mime: doc.mime || null,
    })),
  };
}

async function insertAudit(pool, certificationId, actorId, action, payload = {}) {
  await pool.query(
    `insert into host_certification_audit_logs
     (certification_id, actor_id, action, payload)
     values ($1, $2, $3, $4)`,
    [certificationId, actorId || null, action, payload]
  );
}

function ensureAdmin(auth, req) {
  const adminKey = normalizeString(req.headers['x-admin-key']);
  if (config.admin.apiKey && adminKey === config.admin.apiKey) return true;
  return auth.tokenType === 'terra' && auth.role === 'admin';
}

async function validateDocuments(pool, userId, documents) {
  if (!documents.length) {
    const err = new Error('Missing required documents');
    err.statusCode = 422;
    err.code = 'MISSING_DOCUMENTS';
    throw err;
  }
  const docTypes = new Set(documents.map((doc) => doc.doc_type));
  for (const required of REQUIRED_DOC_TYPES) {
    if (!docTypes.has(required)) {
      const err = new Error(`Missing required document: ${required}`);
      err.statusCode = 422;
      err.code = 'MISSING_DOCUMENTS';
      throw err;
    }
  }

  const ids = documents.map((doc) => doc.media_asset_id);
  const { rows } = await pool.query(
    'select id, object_key, owner_user_id, scope, visibility, status from media_assets where id = ANY($1)',
    [ids]
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const doc of documents) {
    const asset = byId.get(doc.media_asset_id);
    if (!asset) {
      const err = new Error('Media asset not found');
      err.statusCode = 422;
      err.code = 'INVALID_DOCUMENT';
      throw err;
    }
    if (asset.owner_user_id !== userId) {
      const err = new Error('Media asset owner mismatch');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }
    if (asset.scope !== 'kyc' || asset.visibility !== 'private') {
      const err = new Error('Media asset scope/visibility mismatch');
      err.statusCode = 422;
      err.code = 'INVALID_DOCUMENT';
      throw err;
    }
    if (asset.status && asset.status !== 'active') {
      const err = new Error('Media asset not active');
      err.statusCode = 422;
      err.code = 'INVALID_DOCUMENT';
      throw err;
    }
    if (asset.object_key && asset.object_key !== doc.object_key) {
      const err = new Error('Media asset objectKey mismatch');
      err.statusCode = 422;
      err.code = 'INVALID_DOCUMENT';
      throw err;
    }
  }
}

export default async function hostCertificationRoutes(app) {
  const pool = app.pg.pool;

  app.get('/v1/host-certifications/me', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    if (!auth) return;

    try {
      const { rows } = await pool.query(
        'select * from host_certifications where user_id = $1 limit 1',
        [auth.userId]
      );
      const row = rows[0];
      return ok(reply, { state: serializeState(row) });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch host certification', 500);
    }
  });

  app.put('/v1/host-certifications/draft', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    if (!auth) return;

    const hasProfile = Object.prototype.hasOwnProperty.call(req.body || {}, 'profile');
    const hasDocuments = Object.prototype.hasOwnProperty.call(req.body || {}, 'documents');
    const incomingProfile = hasProfile ? req.body?.profile : null;
    const incomingDocuments = hasDocuments ? normalizeDocuments(req.body?.documents) : null;

    try {
      const { rows } = await pool.query(
        'select * from host_certifications where user_id = $1 limit 1',
        [auth.userId]
      );
      const existing = rows[0];
      let nextRow = null;

      if (!existing) {
        const profile = normalizeProfile({}, incomingProfile);
        const documents = Array.isArray(incomingDocuments) ? incomingDocuments : [];
        const insert = await pool.query(
          `insert into host_certifications
           (user_id, status, profile, documents, created_at, updated_at)
           values ($1, 'draft', $2, $3, now(), now())
           returning *`,
          [auth.userId, profile, documents]
        );
        nextRow = insert.rows[0];
        await insertAudit(pool, nextRow.id, auth.userId, 'draft_saved', {
          profile,
          documentsCount: documents.length,
        });
      } else {
        if (!ALLOWED_UPDATE_STATUSES.has(existing.status)) {
          return error(reply, 'INVALID_STATUS', 'Cannot edit certification in current status', 409);
        }
        const profile = normalizeProfile(existing.profile || {}, incomingProfile);
        const documents = Array.isArray(incomingDocuments)
          ? incomingDocuments
          : existing.documents || [];
        const update = await pool.query(
          `update host_certifications
           set status = 'draft', profile = $1, documents = $2,
               submitted_at = null, reviewed_at = null, reviewer_id = null,
               reject_reason = null, updated_at = now()
           where id = $3 returning *`,
          [profile, documents, existing.id]
        );
        nextRow = update.rows[0];
        await insertAudit(pool, existing.id, auth.userId, 'draft_saved', {
          profile,
          documentsCount: documents.length,
        });
      }

      clearApprovedHostCache(auth.userId);
      return ok(reply, { state: serializeState(nextRow) });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to save host certification draft', 500);
    }
  });

  app.post('/v1/host-certifications/submit', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    if (!auth) return;

    try {
      const { rows } = await pool.query(
        'select * from host_certifications where user_id = $1 limit 1',
        [auth.userId]
      );
      const existing = rows[0];
      if (!existing) {
        return error(reply, 'NOT_FOUND', 'Host certification not found', 404);
      }
      if (!SUBMIT_ALLOWED_STATUSES.has(existing.status)) {
        return error(reply, 'INVALID_STATUS', 'Certification already submitted', 409);
      }
      const documents = Array.isArray(existing.documents) ? existing.documents : [];
      await validateDocuments(pool, auth.userId, documents);

      const update = await pool.query(
        `update host_certifications
         set status = 'submitted', submitted_at = now(), updated_at = now(), reject_reason = null
         where id = $1 returning *`,
        [existing.id]
      );
      const nextRow = update.rows[0];
      await insertAudit(pool, existing.id, auth.userId, 'submitted', {
        documentsCount: documents.length,
      });
      await pool.query(
        'update experiences set host_cert_status = $1 where host_user_id = $2',
        ['submitted', auth.userId]
      );
      clearApprovedHostCache(auth.userId);
      return ok(reply, { state: serializeState(nextRow) });
    } catch (err) {
      if (err?.statusCode) {
        return error(reply, err.code || 'INVALID_REQUEST', err.message, err.statusCode);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to submit host certification', 500);
    }
  });

  app.get('/v1/admin/host-certifications', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    if (!auth) return;
    if (!ensureAdmin(auth, req)) {
      return error(reply, 'FORBIDDEN', 'Admin role required', 403);
    }

    const status = normalizeString(req.query?.status || 'submitted');
    const limit = Math.min(Number(req.query?.limit || 20), 100);
    const cursor = Number(req.query?.cursor || 0);

    try {
      const { rows } = await pool.query(
        `select * from host_certifications
         where status = $1
         order by submitted_at desc nulls last, created_at desc
         limit $2 offset $3`,
        [status, limit, cursor]
      );
      const items = rows.map(buildAdminListItem);
      const nextCursor = rows.length === limit ? cursor + limit : null;
      return ok(reply, { items, limit, cursor, nextCursor });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch host certifications', 500);
    }
  });

  app.post('/v1/admin/host-certifications/:id/review', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    if (!auth) return;
    if (!ensureAdmin(auth, req)) {
      return error(reply, 'FORBIDDEN', 'Admin role required', 403);
    }

    const id = req.params?.id;
    const action = normalizeString(req.body?.action).toLowerCase();
    const rejectReason = normalizeString(req.body?.rejectReason || req.body?.reject_reason);
    if (!id || !action) {
      return error(reply, 'INVALID_REQUEST', 'action is required', 400);
    }

    try {
      const { rows } = await pool.query(
        'select * from host_certifications where id = $1 limit 1',
        [id]
      );
      const existing = rows[0];
      if (!existing) {
        return error(reply, 'NOT_FOUND', 'Host certification not found', 404);
      }

      let nextRow = null;
      if (action === 'reviewing') {
        if (!REVIEW_ALLOWED_STATUSES.has(existing.status)) {
          return error(reply, 'INVALID_STATUS', 'Cannot mark reviewing', 409);
        }
        const update = await pool.query(
          `update host_certifications
           set status = 'reviewing', updated_at = now()
           where id = $1 returning *`,
          [id]
        );
        nextRow = update.rows[0];
        await insertAudit(pool, id, auth.userId, 'set_reviewing');
        await pool.query(
          'update experiences set host_cert_status = $1 where host_user_id = $2',
          ['reviewing', existing.user_id]
        );
      } else if (action === 'approve') {
        if (!DECISION_ALLOWED_STATUSES.has(existing.status)) {
          return error(reply, 'INVALID_STATUS', 'Cannot approve certification', 409);
        }
        const update = await pool.query(
          `update host_certifications
           set status = 'approved', reviewed_at = now(), reviewer_id = $2,
               reject_reason = null, updated_at = now()
           where id = $1 returning *`,
          [id, auth.userId]
        );
        nextRow = update.rows[0];
        await insertAudit(pool, id, auth.userId, 'approved');
        await pool.query(
          'update experiences set host_cert_status = $1 where host_user_id = $2',
          ['approved', existing.user_id]
        );
      } else if (action === 'reject') {
        if (!DECISION_ALLOWED_STATUSES.has(existing.status)) {
          return error(reply, 'INVALID_STATUS', 'Cannot reject certification', 409);
        }
        if (!rejectReason) {
          return error(reply, 'INVALID_REQUEST', 'rejectReason is required', 400);
        }
        const update = await pool.query(
          `update host_certifications
           set status = 'rejected', reviewed_at = now(), reviewer_id = $2,
               reject_reason = $3, updated_at = now()
           where id = $1 returning *`,
          [id, auth.userId, rejectReason]
        );
        nextRow = update.rows[0];
        await insertAudit(pool, id, auth.userId, 'rejected', { rejectReason });
        await pool.query(
          'update experiences set host_cert_status = $1 where host_user_id = $2',
          ['rejected', existing.user_id]
        );
      } else {
        return error(reply, 'INVALID_REQUEST', 'Invalid action', 400);
      }

      clearApprovedHostCache(existing.user_id);
      return ok(reply, { state: serializeState(nextRow) });
    } catch (err) {
      if (err?.statusCode) {
        return error(reply, err.code || 'INVALID_REQUEST', err.message, err.statusCode);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to review host certification', 500);
    }
  });
}

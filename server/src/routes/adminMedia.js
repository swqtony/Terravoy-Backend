import { ok, error } from '../utils/responses.js';
import { createReadUrl } from '../services/storage/ossStorageService.js';
import { config } from '../config.js';
import { requirePermission } from '../middlewares/adminPermissions.js';
import { logAdminAudit } from '../services/adminAuditService.js';

const ALLOWED_VISIBILITY = new Set(['public', 'private']);
const ALLOWED_SCOPES = new Set(['post', 'experience', 'avatar', 'kyc']);
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4']);

function fail(code, message, statusCode = 400) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  throw err;
}

function normalizeString(value) {
  return (value || '').toString().trim();
}

function parseObjectKey(objectKey) {
  const pattern =
    /^(public|private)\/(post|experience|avatar|kyc)\/([^/]+)\/(\d{4})\/(\d{2})\/([0-9a-f-]{36})\.([a-z0-9]+)$/i;
  const match = objectKey.match(pattern);
  if (!match) {
    fail('INVALID_OBJECT_KEY', 'Invalid objectKey format');
  }
  const visibility = match[1].toLowerCase();
  const scope = match[2].toLowerCase();
  const ext = match[7].toLowerCase();
  if (!ALLOWED_VISIBILITY.has(visibility)) {
    fail('INVALID_VISIBILITY', 'Invalid visibility');
  }
  if (!ALLOWED_SCOPES.has(scope)) {
    fail('INVALID_SCOPE', 'Invalid scope');
  }
  if (!ALLOWED_EXT.has(ext)) {
    fail('INVALID_EXT', 'Invalid extension');
  }
  return { visibility };
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

function registerRoutes(app, basePath) {
  const pool = app.pg.pool;
  const requireMediaRead = requirePermission('media.read_private', pool);

  app.post(`${basePath}/media/read-url`, async (req, reply) => {
    const admin = await requireMediaRead(req, reply);
    if (!admin) return;

    const objectKey = normalizeString(req.body?.objectKey);
    const reason = normalizeString(req.body?.reason);
    if (!objectKey) {
      return error(reply, 'INVALID_REQUEST', 'objectKey is required', 400);
    }
    if (!reason) {
      return error(reply, 'INVALID_REQUEST', 'reason is required', 400);
    }

    try {
      const parsed = parseObjectKey(objectKey);
      if (parsed.visibility !== 'private') {
        fail('INVALID_VISIBILITY', 'Only private assets are allowed');
      }
      const bucket = config.oss.bucketPrivate;
      if (!bucket) {
        fail('MISCONFIG', 'OSS bucket missing', 500);
      }
      const expiresIn = 120;
      const url = createReadUrl({ bucket, objectKey, expiresIn });
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      await logAdminAudit({
        pool,
        adminUserId: admin.sub,
        action: 'media.read_private',
        resourceType: 'media',
        resourceId: objectKey,
        before: null,
        after: { expiresAt },
        reason,
        ip: getClientIp(req),
        ua: req.headers['user-agent'] || null,
      });

      return ok(reply, { url, expiresAt });
    } catch (err) {
      if (err?.statusCode) {
        return error(reply, err.code || 'INVALID_REQUEST', err.message, err.statusCode);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to create read URL', 500);
    }
  });
}

export default async function adminMediaRoutes(app) {
  registerRoutes(app, '/functions/v1/admin');
  registerRoutes(app, '/v1/admin');
}

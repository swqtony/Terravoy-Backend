import { ok, error } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';
import {
  createUploadUrl,
  headObject,
  createReadUrl,
  buildFinalUrl,
  validateComplete,
} from '../services/storage/ossStorageService.js';
import { createMediaAsset, fetchMediaAsset } from '../services/mediaAssetsService.js';
import { config } from '../config.js';

const ALLOWED_SCOPE = new Set(['post', 'experience', 'kyc', 'avatar']);
const ALLOWED_VISIBILITY = new Set(['public', 'private']);

function parseUploadBody(body) {
  const scope = (body?.scope || '').toString();
  const visibility = (body?.visibility || '').toString() || 'public';
  const mime = body?.mime?.toString() || '';
  const ext = (body?.ext || '').toString().toLowerCase();
  const size = Number(body?.size || 0);
  return { scope, visibility, mime, ext, size };
}

function parseCompleteBody(body) {
  const scope = (body?.scope || '').toString();
  const visibility = (body?.visibility || '').toString() || 'public';
  const mime = body?.mime?.toString() || '';
  const size = Number(body?.size || 0);
  const objectKey = (body?.objectKey || '').toString();
  const bucket = (body?.bucket || '').toString();
  return { scope, visibility, mime, size, objectKey, bucket };
}

async function ensureAuth(req, reply) {
  try {
    return await requireAuth(req, reply);
  } catch (err) {
    if (respondAuthError(err, reply)) return null;
    if (err?.statusCode) {
      error(reply, err.code || 'UNAUTHORIZED', err.message, err.statusCode);
      return null;
    }
    throw err;
  }
}

export default async function storageRoutes(app) {
  const pool = app.pg.pool;
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  const allowLegacy = !isProd && config.flags.allowLegacyStorage;
  if (!allowLegacy) {
    const gone = async (_req, reply) =>
      error(reply, 'GONE', 'Legacy storage endpoints are deprecated', 410);
    app.post('/storage/upload-url', gone);
    app.post('/functions/v1/storage/upload-url', gone);
    app.post('/storage/complete', gone);
    app.post('/functions/v1/storage/complete', gone);
    app.post('/storage/read-url', gone);
    app.post('/functions/v1/storage/read-url', gone);
    return;
  }

  const uploadHandler = async (req, reply) => {
    const auth = await ensureAuth(req, reply);
    if (!auth) return;
    const { scope, visibility, mime, ext, size } = parseUploadBody(req.body || {});
    if (!ALLOWED_SCOPE.has(scope)) {
      return error(reply, 'INVALID_SCOPE', 'Invalid scope', 400);
    }
    if (!ALLOWED_VISIBILITY.has(visibility)) {
      return error(reply, 'INVALID_VISIBILITY', 'Invalid visibility', 400);
    }
    try {
      const result = createUploadUrl({
        userId: auth.userId,
        scope,
        visibility,
        mime,
        ext,
        size,
      });
      return ok(reply, result);
    } catch (err) {
      if (err?.statusCode) {
        return error(reply, err.code || 'INVALID_REQUEST', err.message, err.statusCode);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to create upload URL', 500);
    }
  };

  const completeHandler = async (req, reply) => {
    const auth = await ensureAuth(req, reply);
    if (!auth) return;
    const { scope, visibility, mime, size, objectKey, bucket } = parseCompleteBody(req.body || {});
    if (!objectKey || !bucket) {
      return error(reply, 'INVALID_REQUEST', 'objectKey and bucket are required', 400);
    }
    if (!ALLOWED_SCOPE.has(scope)) {
      return error(reply, 'INVALID_SCOPE', 'Invalid scope', 400);
    }
    if (!ALLOWED_VISIBILITY.has(visibility)) {
      return error(reply, 'INVALID_VISIBILITY', 'Invalid visibility', 400);
    }
    try {
      validateComplete({ scope, visibility, mime, size });
      const head = await headObject({ bucket, objectKey });
      const headers = head.headers || {};
      const contentLength = Number(headers['content-length'] || headers['Content-Length'] || 0);
      if (size && contentLength && size !== contentLength) {
        return error(reply, 'SIZE_MISMATCH', 'Uploaded file size mismatch', 400);
      }
      const contentType = headers['content-type'] || headers['Content-Type'] || '';
      if (mime && contentType && !contentType.startsWith(mime.split('/')[0])) {
        return error(reply, 'MIME_MISMATCH', 'Uploaded file mime mismatch', 400);
      }
      const ext = objectKey.includes('.') ? objectKey.split('.').pop()?.toLowerCase() : null;
      const url = buildFinalUrl({ bucket, objectKey, visibility });
      const asset = await createMediaAsset({
        pool,
        url,
        mimeType: mime || contentType,
        mime: mime || contentType,
        ext,
        size: contentLength || size,
        sizeBytes: contentLength || size,
        ownerUserId: auth.userId,
        scope,
        visibility,
        provider: 'oss',
        objectKey,
        bucket,
      });
      return ok(reply, {
        assetId: asset.id,
        url: asset.url,
        objectKey,
        bucket,
      });
    } catch (err) {
      if (err?.statusCode) {
        return error(reply, err.code || 'INVALID_REQUEST', err.message, err.statusCode);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to complete upload', 500);
    }
  };

  const readHandler = async (req, reply) => {
    const auth = await ensureAuth(req, reply);
    if (!auth) return;
    const objectKey = (req.body?.objectKey || '').toString();
    const bucket = (req.body?.bucket || '').toString();
    const expiresIn = Number(req.body?.expiresIn || 900);
    if (!objectKey || !bucket) {
      return error(reply, 'INVALID_REQUEST', 'objectKey and bucket are required', 400);
    }
    try {
      const asset = await fetchMediaAsset({ pool, objectKey, bucket });
      if (!asset) {
        return error(reply, 'NOT_FOUND', 'Media asset not found', 404);
      }
      if (asset.owner_user_id && asset.owner_user_id !== auth.userId) {
        return error(reply, 'FORBIDDEN', 'Access denied', 403);
      }
      const url = createReadUrl({ bucket, objectKey, expiresIn });
      return ok(reply, { url, expiresIn });
    } catch (err) {
      if (err?.statusCode) {
        return error(reply, err.code || 'INVALID_REQUEST', err.message, err.statusCode);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to create read URL', 500);
    }
  };

  app.post('/storage/upload-url', uploadHandler);
  app.post('/functions/v1/storage/upload-url', uploadHandler);

  app.post('/storage/complete', completeHandler);
  app.post('/functions/v1/storage/complete', completeHandler);

  app.post('/storage/read-url', readHandler);
  app.post('/functions/v1/storage/read-url', readHandler);
}

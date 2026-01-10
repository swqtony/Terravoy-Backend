import { ok, error } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';
import {
  createUploadUrl,
  headObject,
  buildFinalUrl,
} from '../services/storage/ossStorageService.js';
import { createMediaAsset } from '../services/mediaAssetsService.js';
import { logMediaAudit } from '../services/mediaAuditService.js';
import { SlidingWindowRateLimiter } from '../utils/rateLimiter.js';
import { config } from '../config.js';

const ALLOWED_SCOPES = new Set(['post', 'experience', 'avatar', 'kyc']);
const ALLOWED_VISIBILITY = new Set(['public', 'private']);
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const KYC_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
const SIZE_TOLERANCE_BYTES = 65536;

const userLimiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 30 });
const ipUserLimiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 60 });
const kycUserLimiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 10 });
const kycIpUserLimiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 10 });

function fail(code, message, statusCode = 400, detail = null) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  if (detail !== null) err.detail = detail;
  throw err;
}

function normalizeString(value) {
  return (value || '').toString().trim();
}

function parseUploadBody(body) {
  return {
    scope: normalizeString(body?.scope),
    visibility: normalizeString(body?.visibility),
    ext: normalizeString(body?.ext).toLowerCase(),
    size: Number(body?.size ?? 0),
    mime: normalizeString(body?.mime),
  };
}

function parseCompleteBody(body) {
  return {
    objectKey: normalizeString(body?.objectKey),
    declaredSize: Number(body?.declaredSize ?? 0),
    declaredMime: normalizeString(body?.declaredMime),
  };
}

function expectedMimeMajor(ext) {
  return ext === 'mp4' ? 'video' : 'image';
}

function validateUploadInput({ scope, visibility, ext, size, mime }) {
  if (!ALLOWED_SCOPES.has(scope)) {
    fail('INVALID_SCOPE', 'Invalid scope');
  }
  if (!ALLOWED_VISIBILITY.has(visibility)) {
    fail('INVALID_VISIBILITY', 'Invalid visibility');
  }
  if (!ALLOWED_EXT.has(ext)) {
    fail('INVALID_EXT', 'Invalid extension');
  }
  if (!Number.isFinite(size) || size <= 0) {
    fail('INVALID_SIZE', 'Invalid size');
  }

  const isVideo = ext === 'mp4';
  const max = isVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
  if (size > max) {
    fail('FILE_TOO_LARGE', 'File too large');
  }

  if (!mime) {
    fail('INVALID_MIME', 'Mime is required');
  }
  const major = expectedMimeMajor(ext);
  if (!mime.startsWith(`${major}/`)) {
    fail('INVALID_MIME', 'Mime does not match extension');
  }

  if (scope === 'avatar') {
    if (visibility !== 'public') {
      fail('INVALID_VISIBILITY', 'Avatar must be public');
    }
    if (!IMAGE_EXT.has(ext)) {
      fail('INVALID_EXT', 'Avatar must be an image');
    }
  }

  if (scope === 'kyc') {
    if (visibility !== 'private') {
      fail('INVALID_VISIBILITY', 'KYC must be private');
    }
    if (!KYC_IMAGE_EXT.has(ext)) {
      fail('INVALID_EXT', 'KYC must be a non-gif image');
    }
    if (!mime.startsWith('image/')) {
      fail('INVALID_MIME', 'KYC must be an image');
    }
  }
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
  const ownerId = match[3];
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
  return { visibility, scope, ownerId, ext };
}

function validateCompleteInput({ ext, declaredSize, declaredMime, scope, visibility }) {
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    fail('INVALID_SIZE', 'Invalid declaredSize');
  }
  if (!declaredMime) {
    fail('INVALID_MIME', 'declaredMime is required');
  }
  const major = expectedMimeMajor(ext);
  if (!declaredMime.startsWith(`${major}/`)) {
    fail('INVALID_MIME', 'declaredMime does not match extension');
  }
  if (scope === 'avatar' && visibility !== 'public') {
    fail('INVALID_VISIBILITY', 'Avatar must be public');
  }
  if (scope === 'kyc') {
    if (visibility !== 'private') {
      fail('INVALID_VISIBILITY', 'KYC must be private');
    }
    if (!KYC_IMAGE_EXT.has(ext)) {
      fail('INVALID_EXT', 'KYC must be a non-gif image');
    }
    if (!declaredMime.startsWith('image/')) {
      fail('INVALID_MIME', 'KYC must be an image');
    }
  }
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

function enforceRateLimit({ scope, userId, ip }) {
  const isKyc = scope === 'kyc';
  const userResult = (isKyc ? kycUserLimiter : userLimiter).check(userId);
  if (!userResult.allowed) {
    fail('RATE_LIMITED', 'Too many requests', 429, {
      retryAfterSeconds: userResult.retryAfterSeconds,
    });
  }
  const ipKey = `${ip || 'unknown'}:${userId}`;
  const ipResult = (isKyc ? kycIpUserLimiter : ipUserLimiter).check(ipKey);
  if (!ipResult.allowed) {
    fail('RATE_LIMITED', 'Too many requests', 429, {
      retryAfterSeconds: ipResult.retryAfterSeconds,
    });
  }
}

async function ensureAuth(req, reply) {
  try {
    return await requireAuth(req, reply);
  } catch (err) {
    if (respondAuthError(err, reply)) return null;
    if (err?.statusCode) {
      error(reply, err.code || 'UNAUTHORIZED', err.message, err.statusCode, err.detail);
      return null;
    }
    throw err;
  }
}

export default async function mediaRoutes(app) {
  const pool = app.pg.pool;

  const uploadHandler = async (req, reply) => {
    const auth = await ensureAuth(req, reply);
    if (!auth) return;
    const payload = parseUploadBody(req.body || {});
    try {
      validateUploadInput(payload);
      enforceRateLimit({ scope: payload.scope, userId: auth.userId, ip: getClientIp(req) });
      const result = createUploadUrl({
        userId: auth.userId,
        scope: payload.scope,
        visibility: payload.visibility,
        mime: payload.mime,
        ext: payload.ext,
        size: payload.size,
      });
      const expiresAt = new Date(Date.now() + result.expiresIn * 1000).toISOString();
      await logMediaAudit({
        pool,
        userId: auth.userId,
        ip: getClientIp(req),
        action: 'upload_url',
        objectKey: result.objectKey,
      });
      return ok(reply, {
        objectKey: result.objectKey,
        uploadUrl: result.uploadUrl,
        expiresAt,
        requiredHeaders: {
          'Content-Type': payload.mime,
        },
      });
    } catch (err) {
      if (err?.statusCode) {
        await logMediaAudit({
          pool,
          userId: auth.userId,
          ip: getClientIp(req),
          action: 'upload_url',
          reason: err.message,
        });
        return error(reply, err.code || 'INVALID_REQUEST', err.message, err.statusCode, err.detail);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to create upload URL', 500);
    }
  };

  const completeHandler = async (req, reply) => {
    const auth = await ensureAuth(req, reply);
    if (!auth) return;
    if (req.body && req.body.bucket !== undefined) {
      return error(reply, 'INVALID_REQUEST', 'bucket is not allowed', 400);
    }
    const payload = parseCompleteBody(req.body || {});
    if (!payload.objectKey) {
      return error(reply, 'INVALID_REQUEST', 'objectKey is required', 400);
    }
    let parsed = null;
    try {
      parsed = parseObjectKey(payload.objectKey);
      if (parsed.ownerId !== auth.userId) {
        fail('FORBIDDEN', 'objectKey owner mismatch', 403);
      }
      validateCompleteInput({
        ext: parsed.ext,
        declaredSize: payload.declaredSize,
        declaredMime: payload.declaredMime,
        scope: parsed.scope,
        visibility: parsed.visibility,
      });
      const bucket =
        parsed.visibility === 'private'
          ? config.oss.bucketPrivate
          : config.oss.bucketPublic;
      if (!bucket) {
        fail('MISCONFIG', 'OSS bucket missing', 500);
      }
      let head = null;
      try {
        head = await headObject({ bucket, objectKey: payload.objectKey });
      } catch (err) {
        const status = err?.status || err?.statusCode;
        const errCode = err?.code || err?.name || '';
        if (status === 404 || errCode === 'NoSuchKey') {
          fail('OBJECT_NOT_FOUND', 'Object not found');
        }
        req.log.error(err);
        fail('STORAGE_ERROR', 'Failed to verify object', 502);
      }
      const headers = head?.headers || {};
      const contentLength = Number(headers['content-length'] || headers['Content-Length'] || 0);
      if (!Number.isFinite(contentLength) || contentLength <= 0) {
        fail('INVALID_OBJECT', 'Missing content-length');
      }
      if (contentLength > payload.declaredSize + SIZE_TOLERANCE_BYTES) {
        fail('SIZE_MISMATCH', 'Uploaded size exceeds declared size');
      }
      const contentType = (headers['content-type'] || headers['Content-Type'] || '').toString();
      if (!contentType) {
        fail('INVALID_OBJECT', 'Missing content-type');
      }
      const expectedMajor = expectedMimeMajor(parsed.ext);
      if (!contentType.startsWith(`${expectedMajor}/`)) {
        fail('MIME_MISMATCH', 'Uploaded content-type does not match extension');
      }
      if (!contentType.startsWith(payload.declaredMime.split('/')[0] + '/')) {
        fail('MIME_MISMATCH', 'Uploaded content-type does not match declaredMime');
      }
      if (parsed.scope === 'kyc' && !contentType.startsWith('image/')) {
        fail('MIME_MISMATCH', 'KYC content-type must be image/*');
      }

      const resolvedMime = contentType || payload.declaredMime;
      // NOTE: Removed setObjectAcl call - OSS Block Public Access is enabled.
      // All public resources are now accessed via signed URLs (signUrlFromStoredUrl).
      const publicUrl = buildFinalUrl({
        bucket,
        objectKey: payload.objectKey,
        visibility: parsed.visibility,
      });
      const asset = await createMediaAsset({
        pool,
        url: parsed.visibility === 'public' ? publicUrl : '',
        mimeType: resolvedMime,
        mime: resolvedMime,
        ext: parsed.ext,
        size: contentLength,
        sizeBytes: contentLength,
        ownerUserId: auth.userId,
        scope: parsed.scope,
        visibility: parsed.visibility,
        provider: 'oss',
        objectKey: payload.objectKey,
        bucket,
      });
      await logMediaAudit({
        pool,
        userId: auth.userId,
        ip: getClientIp(req),
        action: 'complete',
        objectKey: payload.objectKey,
      });
      return ok(reply, {
        id: asset.id,
        objectKey: payload.objectKey,
        visibility: parsed.visibility,
        scope: parsed.scope,
        mime: resolvedMime,
        size: contentLength,
        publicUrl: parsed.visibility === 'public' ? publicUrl : undefined,
      });
    } catch (err) {
      if (err?.statusCode) {
        await logMediaAudit({
          pool,
          userId: auth.userId,
          ip: getClientIp(req),
          action: 'complete',
          objectKey: payload.objectKey,
          reason: err.message,
        });
        return error(reply, err.code || 'INVALID_REQUEST', err.message, err.statusCode, err.detail);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to complete upload', 500);
    }
  };


  app.post('/v1/media/upload-url', uploadHandler);
  app.post('/v1/media/complete', completeHandler);
}

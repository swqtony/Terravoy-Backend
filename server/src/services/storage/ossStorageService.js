import crypto from 'crypto';
import OSS from 'ali-oss';
import { config } from '../../config.js';

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
const ALLOWED_SCOPES = new Set(['post', 'experience', 'kyc', 'avatar']);
const ALLOWED_VISIBILITY = new Set(['public', 'private']);
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov']);

function ensureEnabled() {
  if (!config.oss.useOssUploader) {
    const err = new Error('OSS uploader disabled');
    err.code = 'OSS_DISABLED';
    err.statusCode = 501;
    throw err;
  }
}

function ensureValidScope(scope) {
  if (!ALLOWED_SCOPES.has(scope)) {
    const err = new Error('Invalid scope');
    err.code = 'INVALID_SCOPE';
    err.statusCode = 400;
    throw err;
  }
}

function ensureValidVisibility(visibility) {
  if (!ALLOWED_VISIBILITY.has(visibility)) {
    const err = new Error('Invalid visibility');
    err.code = 'INVALID_VISIBILITY';
    err.statusCode = 400;
    throw err;
  }
}

function ensureValidExt(ext) {
  if (!ALLOWED_EXT.has(ext)) {
    const err = new Error('Invalid extension');
    err.code = 'INVALID_EXT';
    err.statusCode = 400;
    throw err;
  }
}

function ensureSizeLimit(size, mime) {
  if (!Number.isFinite(size) || size <= 0) {
    const err = new Error('Invalid size');
    err.code = 'INVALID_SIZE';
    err.statusCode = 400;
    throw err;
  }
  const isVideo = mime?.startsWith('video/');
  const max = isVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
  if (size > max) {
    const err = new Error('File too large');
    err.code = 'FILE_TOO_LARGE';
    err.statusCode = 400;
    throw err;
  }
}

function buildClient(bucket) {
  const endpoint = config.oss.endpoint.startsWith('http')
    ? config.oss.endpoint
    : `https://${config.oss.endpoint}`;
  return new OSS({
    endpoint,
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
    bucket,
  });
}

function formatObjectKey({ scope, visibility, userId, ext }) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const id = crypto.randomUUID();
  const prefix = visibility === 'private' ? 'private' : 'public';
  return `${prefix}/${scope}/${userId}/${year}/${month}/${id}.${ext}`;
}

function publicBaseUrl(bucket) {
  if (config.media?.publicBaseUrl) return config.media.publicBaseUrl.replace(/\/$/, '');
  if (config.oss.publicBaseUrl) return config.oss.publicBaseUrl.replace(/\/$/, '');
  return `https://${bucket}.${config.oss.endpoint}`;
}

export function createUploadUrl({ userId, scope, visibility, mime, ext, size }) {
  ensureEnabled();
  ensureValidScope(scope);
  ensureValidVisibility(visibility);
  ensureValidExt(ext);
  ensureSizeLimit(size, mime);

  const bucket = visibility === 'private' ? config.oss.bucketPrivate : config.oss.bucketPublic;
  const objectKey = formatObjectKey({ scope, visibility, userId, ext });
  const client = buildClient(bucket);
  const expiresIn = config.oss.uploadExpiresSeconds;
  const uploadUrl = client.signatureUrl(objectKey, {
    method: 'PUT',
    expires: expiresIn,
    'Content-Type': mime || 'application/octet-stream',
  });

  const finalUrl = visibility === 'public'
    ? `${publicBaseUrl(bucket)}/${objectKey}`
    : '';

  return {
    objectKey,
    bucket,
    uploadUrl,
    finalUrl,
    expiresIn,
  };
}

export async function headObject({ bucket, objectKey }) {
  ensureEnabled();
  const client = buildClient(bucket);
  const result = await client.head(objectKey);
  const headers = result?.res?.headers || result?.headers || {};
  return {
    headers,
  };
}

export function createReadUrl({ bucket, objectKey, expiresIn }) {
  ensureEnabled();
  const client = buildClient(bucket);
  return client.signatureUrl(objectKey, {
    method: 'GET',
    expires: expiresIn || config.oss.uploadExpiresSeconds,
  });
}

export function buildFinalUrl({ bucket, objectKey, visibility }) {
  if (visibility !== 'public') return '';
  return `${publicBaseUrl(bucket)}/${objectKey}`;
}

export function validateComplete({ scope, visibility, mime, size, ext }) {
  ensureValidScope(scope);
  ensureValidVisibility(visibility);
  if (ext) ensureValidExt(ext);
  if (size) ensureSizeLimit(size, mime);
}

export async function setObjectAcl({ bucket, objectKey, acl }) {
  ensureEnabled();
  const client = buildClient(bucket);
  await client.putACL(objectKey, acl);
}

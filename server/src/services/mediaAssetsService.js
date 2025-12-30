import { config } from '../config.js';

function publicBaseUrl(bucket) {
  if (config.oss.publicBaseUrl) return config.oss.publicBaseUrl.replace(/\/$/, '');
  return `https://${bucket}.${config.oss.endpoint}`;
}

export async function createMediaAsset({
  pool,
  url,
  mimeType,
  mime,
  ext,
  size,
  sizeBytes,
  ownerUserId,
  scope,
  visibility,
  provider,
  objectKey,
  bucket,
  checksum = null,
  status = 'active',
}) {
  const resolvedUrl = url || (visibility === 'public' ? `${publicBaseUrl(bucket)}/${objectKey}` : '');
  const fields = [
    'url',
    'mime_type',
    'mime',
    'ext',
    'size',
    'size_bytes',
    'owner_user_id',
    'scope',
    'visibility',
    'provider',
    'object_key',
    'bucket',
    'checksum',
    'status',
  ];
  const values = [
    resolvedUrl,
    mimeType || null,
    mime || null,
    ext || null,
    size || null,
    sizeBytes || null,
    ownerUserId || null,
    scope || null,
    visibility || null,
    provider || null,
    objectKey || null,
    bucket || null,
    checksum,
    status,
  ];
  const placeholders = values.map((_, idx) => `$${idx + 1}`);
  const sql = `insert into media_assets (${fields.join(', ')}) values (${placeholders.join(', ')}) returning *`;
  const { rows } = await pool.query(sql, values);
  return rows[0];
}

export async function fetchMediaAsset({ pool, objectKey, bucket }) {
  const { rows } = await pool.query(
    'select * from media_assets where object_key = $1 and bucket = $2 limit 1',
    [objectKey, bucket]
  );
  return rows[0] || null;
}

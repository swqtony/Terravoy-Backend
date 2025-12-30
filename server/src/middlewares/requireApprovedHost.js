const CACHE_TTL_MS = 60_000;
const cache = new Map();

function cacheKey(userId) {
  return userId || '';
}

export async function requireApprovedHost(pool, userId) {
  if (!userId) {
    const err = new Error('Missing user');
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const key = cacheKey(userId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.status === 'approved') return;
    const err = new Error('Host certification required');
    err.statusCode = 403;
    err.code = 'HOST_CERT_REQUIRED';
    throw err;
  }

  const { rows } = await pool.query(
    'select status from host_certifications where user_id = $1 limit 1',
    [userId]
  );
  const status = rows[0]?.status || 'none';
  cache.set(key, { status, expiresAt: Date.now() + CACHE_TTL_MS });

  if (status !== 'approved') {
    const err = new Error('Host certification required');
    err.statusCode = 403;
    err.code = 'HOST_CERT_REQUIRED';
    throw err;
  }
}

export function clearApprovedHostCache(userId) {
  if (!userId) return;
  cache.delete(cacheKey(userId));
}

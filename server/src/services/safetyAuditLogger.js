function getClientIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].split(',')[0].trim();
  }
  return req?.ip || '';
}

function sanitizePreview(text) {
  const raw = (text || '').toString().replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.length > 80 ? raw.slice(0, 80) : raw;
}

function resolveTraceId(req) {
  return req?.id || req?.traceId || `req_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveUserId(req, fallback) {
  return (
    fallback ||
    req?.user?.userId ||
    req?.auth?.userId ||
    req?.auth?.sub ||
    null
  );
}

export function logBlockedContent({
  req,
  scene,
  reasons,
  textPreview,
  source,
  userId,
}) {
  const logger = req?.log;
  if (!logger || typeof logger.info !== 'function') {
    return;
  }
  logger.info(
    {
      event: 'content_blocked',
      traceId: resolveTraceId(req),
      userId: resolveUserId(req, userId),
      ip: getClientIp(req),
      scene,
      reasons: Array.isArray(reasons) ? reasons : [],
      source,
      textPreview: sanitizePreview(textPreview),
      path: req?.url || null,
      method: req?.method || null,
      ts: new Date().toISOString(),
    },
    'content_blocked'
  );
}

export function buildTextPreview(text) {
  return sanitizePreview(text);
}

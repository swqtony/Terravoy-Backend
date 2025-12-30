import { requireAuth, respondAuthError } from '../services/authService.js';
import { checkText } from '../services/contentSafetyService.js';
import { SlidingWindowRateLimiter } from '../utils/rateLimiter.js';
import { contentBlocked } from '../utils/responses.js';
import { logBlockedContent, buildTextPreview } from '../services/safetyAuditLogger.js';
import { config } from '../config.js';

const ALLOWED_SCENES = new Set(['chat', 'post', 'experience']);
const userLimiter = new SlidingWindowRateLimiter({
  windowMs: 60_000,
  max: config.safety.checkRateUserPerMin,
});
const ipUserLimiter = new SlidingWindowRateLimiter({
  windowMs: 60_000,
  max: config.safety.checkRateIpUserPerMin,
});

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

function enforceRateLimit({ userId, ip }) {
  const userResult = userLimiter.check(userId);
  if (!userResult.allowed) {
    return userResult;
  }
  const ipKey = `${ip || 'unknown'}:${userId}`;
  const ipResult = ipUserLimiter.check(ipKey);
  return ipResult;
}

export default async function safetyRoutes(app) {
  app.post('/v1/safety/check-text', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    if (!auth) return;

    const ip = getClientIp(req);
    const rate = enforceRateLimit({ userId: auth.userId, ip });
    if (!rate.allowed) {
      return reply.code(429).send({
        ok: false,
        message: 'rate_limited',
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    const scene = (req.body?.scene || '').toString().trim();
    const text = (req.body?.text || '').toString();
    const locale = (req.body?.locale || '').toString();
    if (!ALLOWED_SCENES.has(scene) || !text) {
      return reply.code(400).send({
        ok: false,
        message: 'invalid_request',
      });
    }

    try {
      const result = checkText({ scene, text, locale });
      if (result.ok) {
        return reply.code(200).send({ ok: true });
      }
      logBlockedContent({
        req,
        scene,
        reasons: result.reasons,
        textPreview: buildTextPreview(text),
        source: 'check-text',
        userId: auth.userId,
      });
      return contentBlocked(reply, result.reasons);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({
        ok: false,
        message: 'server_error',
      });
    }
  });
}

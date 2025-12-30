import { ok, error } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';

const ALLOWED_PLATFORMS = new Set(['android']);

async function requireImAuth(req, reply) {
  try {
    const auth = await requireAuth(req, reply);
    if (!auth) return null;
    if (auth.tokenType !== 'access') {
      error(reply, 'IM_AUTH_REQUIRED', 'IM requires access token', 401);
      return null;
    }
    return auth;
  } catch (err) {
    if (respondAuthError(err, reply)) return null;
    throw err;
  }
}

export default async function pushRoutes(app) {
  const pool = app.pg.pool;

  app.post('/push/token', async (req, reply) => {
    const auth = await requireImAuth(req, reply);
    if (!auth) return;

    const platform = (req.body?.platform || '').toString().trim();
    const token = (req.body?.token || '').toString().trim();
    if (!ALLOWED_PLATFORMS.has(platform) || !token) {
      return error(reply, 'INVALID_REQUEST', 'platform and token are required', 400);
    }

    try {
      await pool.query(
        `insert into device_tokens (user_id, platform, token, updated_at)
         values ($1, $2, $3, now())
         on conflict (user_id, platform)
         do update set token = excluded.token, updated_at = now()`,
        [auth.userId, platform, token]
      );
      return ok(reply, { ok: true });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to register token', 500);
    }
  });
}

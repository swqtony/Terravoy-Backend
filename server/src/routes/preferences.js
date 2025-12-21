import { requireAuth, respondAuthError } from '../services/authService.js';
import { ok, error } from '../utils/responses.js';
import { fetchPrefsForMatch, upsertPrefsForMatch } from '../services/preferencesService.js';

export default async function preferencesRoutes(app) {
  const pool = app.pg.pool;

  app.get('/preferences/match', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    const prefs = await fetchPrefsForMatch(pool, auth.userId);
    return ok(reply, prefs);
  });

  app.put('/preferences/match', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    const body = req.body || {};
    try {
      await upsertPrefsForMatch(pool, auth.userId, body);
      return ok(reply, body);
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to save preferences', 500);
    }
  });

  app.delete('/preferences/match', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    try {
      await upsertPrefsForMatch(pool, auth.userId, {});
      return ok(reply, {});
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to clear preferences', 500);
    }
  });
}

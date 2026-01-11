import { ok, error, contentBlocked } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';
import { requireApprovedHost } from '../middlewares/requireApprovedHost.js';
import { checkText } from '../services/contentSafetyService.js';
import { logBlockedContent, buildTextPreview } from '../services/safetyAuditLogger.js';
import { signUrlFromStoredUrl } from '../services/storage/ossStorageService.js';

function normalizeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function asStringArray(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((item) => typeof item === 'string' && item.length > 0);
  }
  return [];
}

function asJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  return [];
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const REVIEW_ROLE = {
  TRAVELER: 'TRAVELER',
  HOST: 'HOST',
};

const REVIEW_REVEAL_DAYS = 14;

function normalizeLimit(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function decodeReviewCursor(cursor) {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const [createdAtRaw, idRaw] = decoded.split('|');
    if (!createdAtRaw || !idRaw) return null;
    const createdAt = new Date(createdAtRaw);
    const id = Number(idRaw);
    if (Number.isNaN(createdAt.valueOf()) || !Number.isFinite(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function encodeReviewCursor(createdAt, id) {
  if (!createdAt || !id) return null;
  const iso = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  return Buffer.from(`${iso}|${id}`).toString('base64');
}

function resolveReviewRole(review, order) {
  if (review?.from_role) return review.from_role;
  if (review?.from_user_id === order?.traveler_id) return REVIEW_ROLE.TRAVELER;
  if (review?.from_user_id === order?.host_id) return REVIEW_ROLE.HOST;
  return null;
}

function resolveToRole(review, fromRole) {
  if (review?.to_role) return review.to_role;
  if (fromRole === REVIEW_ROLE.TRAVELER) return REVIEW_ROLE.HOST;
  if (fromRole === REVIEW_ROLE.HOST) return REVIEW_ROLE.TRAVELER;
  return null;
}

function displayAuthorLabel(fromRole) {
  if (fromRole === REVIEW_ROLE.HOST) return 'Host';
  return 'Traveler';
}

function mapExperience(row) {
  return {
    id: row.id,
    hostId: row.host_user_id,
    hostVerified: row.host_verified ?? false,
    title: row.title ?? '',
    summary: row.summary ?? '',
    description: row.description ?? '',
    city: row.city ?? '',
    meetingPoint: row.meeting_point ?? '',
    languages: asStringArray(row.languages),
    category: row.category ?? '',
    durationMinutes: row.duration_minutes ?? 0,
    availability: asJsonArray(row.availability),
    minGuests: row.min_guests ?? 1,
    maxGuests: row.max_guests ?? 1,
    minAdvanceHours: row.min_advance_hours ?? 0,
    cutoffHours: row.cutoff_hours ?? 0,
    pricePerGuest: row.price_per_guest ?? 0,
    currency: row.currency ?? 'CNY',
    cancellationPolicy: row.cancellation_policy ?? 'flexible',
    coverImageUrl: signUrlFromStoredUrl(row.cover_image_url ?? ''),
    gallery: asStringArray(row.gallery_urls).map(signUrlFromStoredUrl),
    safetyNotes: row.safety_notes ?? '',
    meetupNotes: row.meetup_notes ?? '',
    status: row.status ?? 'draft',
    completedOrders: row.completed_orders ?? 0,
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    rejectionReason: row.rejection_reason ?? null,
    ageRestriction: row.age_restriction ?? null,
    hasActiveOrders: row.has_active_orders ?? false,
  };
}

function mapExperienceBrief(row) {
  return {
    id: row.id,
    hostId: row.host_user_id ?? null,
    title: row.title ?? '',
    subtitle: row.summary ?? '',
    city: row.city ?? '',
    meetingPoint: row.meeting_point ?? '',
    category: row.category ?? '',
    languages: asStringArray(row.languages),
    durationMinutes: row.duration_minutes ?? 0,
    pricePerGuest: row.price_per_guest ?? 0,
    currency: row.currency ?? 'CNY',
    rating: Number(row.rating ?? 0),
    reviewCount: row.review_count ?? 0,
    completedOrders: row.completed_orders ?? 0,
    status: row.status ?? 'draft',
    coverImageUrl: signUrlFromStoredUrl(row.cover_image_url ?? ''),
    hostName: row.host_name ?? '',
    hostAvatarUrl: signUrlFromStoredUrl(row.host_avatar_url ?? ''),
    hostVerified: row.host_verified ?? false,
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    tags: asStringArray(row.tags),
    score: Number(row.score ?? 0),
    hostCertificationBadge: null,
    hostCertificationStatus: row.host_cert_status ?? null,
  };
}

function mapExperienceDetail(row) {
  return {
    brief: mapExperienceBrief(row),
    description: row.description ?? '',
    gallery: asStringArray(row.gallery_urls).map(signUrlFromStoredUrl),
    meetupNotes: row.meetup_notes ?? '',
    safetyNotes: row.safety_notes ?? '',
    cancellationPolicy: row.cancellation_policy ?? 'flexible',
    minGuests: row.min_guests ?? 1,
    maxGuests: row.max_guests ?? 1,
    availability: asJsonArray(row.availability),
    ageRestriction: row.age_restriction ?? null,
  };
}

function requireHostRole(auth) {
  if (!auth || auth.role !== 'host') {
    const err = new Error('Host role required');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

function buildExperienceUpdate(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const updates = {};
  const mapField = (key, column, transform = (value) => value) => {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      updates[column] = transform(payload[key]);
    }
  };
  const asJsonb = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  };

  mapField('title', 'title', (v) => (v ?? '').toString());
  mapField('summary', 'summary', (v) => (v ?? '').toString());
  mapField('description', 'description', (v) => (v ?? '').toString());
  mapField('city', 'city', (v) => (v ?? '').toString());
  mapField('meetingPoint', 'meeting_point', (v) => (v ?? '').toString());
  mapField('languages', 'languages', (v) => asJsonb(Array.isArray(v) ? v : []));
  mapField('category', 'category', (v) => (v ?? '').toString());
  mapField('durationMinutes', 'duration_minutes', (v) => Number(v ?? 0));
  mapField('availability', 'availability', (v) => asJsonb(Array.isArray(v) ? v : []));
  mapField('minGuests', 'min_guests', (v) => Number(v ?? 1));
  mapField('maxGuests', 'max_guests', (v) => Number(v ?? 1));
  mapField('minAdvanceHours', 'min_advance_hours', (v) => Number(v ?? 0));
  mapField('cutoffHours', 'cutoff_hours', (v) => Number(v ?? 0));
  mapField('pricePerGuest', 'price_per_guest', (v) => Number(v ?? 0));
  mapField('currency', 'currency', (v) => (v ?? 'CNY').toString());
  mapField('cancellationPolicy', 'cancellation_policy', (v) => (v ?? 'flexible').toString());
  mapField('coverImageUrl', 'cover_image_url', (v) => (v ?? '').toString());
  mapField('gallery', 'gallery_urls', (v) => asJsonb(Array.isArray(v) ? v : []));
  mapField('safetyNotes', 'safety_notes', (v) => (v ?? '').toString());
  mapField('meetupNotes', 'meetup_notes', (v) => (v ?? '').toString());
  mapField('ageRestriction', 'age_restriction', (v) => asJsonb(v ?? null));
  mapField('tags', 'tags', (v) => asJsonb(Array.isArray(v) ? v : []));

  return updates;
}

function buildSafetyTextFromExperience(row, updates = {}) {
  const data = {
    title: updates.title ?? row.title ?? '',
    summary: updates.summary ?? row.summary ?? '',
    description: updates.description ?? row.description ?? '',
    meetup_notes: updates.meetup_notes ?? row.meetup_notes ?? '',
    safety_notes: updates.safety_notes ?? row.safety_notes ?? '',
    meeting_point: updates.meeting_point ?? row.meeting_point ?? '',
    city: updates.city ?? row.city ?? '',
    tags: updates.tags ?? row.tags ?? [],
  };
  const parts = [
    data.title,
    data.summary,
    data.description,
    data.meetup_notes,
    data.safety_notes,
    data.meeting_point,
    data.city,
    Array.isArray(data.tags) ? data.tags.join(' ') : '',
  ];
  return parts.filter((v) => v && v.toString().trim()).join('\n');
}

export default async function experienceRoutes(app) {
  const pool = app.pg.pool;

  app.get('/functions/v1/host/experiences', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
      requireHostRole(auth);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      if (err?.statusCode) {
        return error(reply, err.code || 'FORBIDDEN', err.message, err.statusCode);
      }
      throw err;
    }

    const page = normalizeInt(req.query?.page, 1);
    const pageSize = normalizeInt(req.query?.pageSize, 20);
    const status = (req.query?.status || '').toString().trim();

    const params = [auth.userId];
    const where = ['host_user_id = $1'];
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    params.push(pageSize);
    params.push((page - 1) * pageSize);

    const sql = `select * from experiences where ${where.join(' and ')}
      order by updated_at desc, id desc
      limit $${params.length - 1} offset $${params.length}`;

    try {
      const { rows } = await pool.query(sql, params);
      return ok(reply, rows.map(mapExperience));
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch experiences', 500);
    }
  });

  app.get('/functions/v1/host/experiences/:id', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
      requireHostRole(auth);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      if (err?.statusCode) {
        return error(reply, err.code || 'FORBIDDEN', err.message, err.statusCode);
      }
      throw err;
    }

    const id = req.params?.id;
    try {
      const { rows } = await pool.query(
        'select * from experiences where id = $1 and host_user_id = $2 limit 1',
        [id, auth.userId]
      );
      if (!rows[0]) {
        return error(reply, 'NOT_FOUND', 'Experience not found', 404);
      }
      return ok(reply, mapExperience(rows[0]));
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch experience', 500);
    }
  });

  app.post('/functions/v1/host/experiences', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
      requireHostRole(auth);
      await requireApprovedHost(pool, auth.userId);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      if (err?.statusCode) {
        return error(reply, err.code || 'FORBIDDEN', err.message, err.statusCode);
      }
      throw err;
    }

    try {
      const { rows } = await pool.query(
        'insert into experiences (host_user_id) values ($1) returning *',
        [auth.userId]
      );
      return ok(reply, mapExperience(rows[0]));
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to create draft', 500);
    }
  });

  app.put('/functions/v1/host/experiences/:id', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
      requireHostRole(auth);
      await requireApprovedHost(pool, auth.userId);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      if (err?.statusCode) {
        return error(reply, err.code || 'FORBIDDEN', err.message, err.statusCode);
      }
      throw err;
    }

    const id = req.params?.id;
    const updates = buildExperienceUpdate(req.body || {});
    if (!updates || Object.keys(updates).length === 0) {
      return error(reply, 'INVALID_REQUEST', 'payload is empty', 400);
    }

    try {
      const exists = await pool.query(
        `select title, summary, description, meetup_notes, safety_notes,
         meeting_point, city, tags
         from experiences where id = $1 and host_user_id = $2 limit 1`,
        [id, auth.userId]
      );
      const existing = exists.rows[0];
      if (!existing) {
        return error(reply, 'NOT_FOUND', 'Experience not found', 404);
      }
      const text = buildSafetyTextFromExperience(existing, updates);
      if (text) {
        const check = checkText({ scene: 'experience', text, locale: req.headers['accept-language'] });
        if (!check.ok) {
          logBlockedContent({
            req,
            scene: 'experience',
            reasons: check.reasons,
            textPreview: buildTextPreview(text),
            source: 'experience',
            userId: auth.userId,
          });
          return contentBlocked(reply, check.reasons);
        }
      }

      const fields = Object.keys(updates);
      const values = fields.map((key) => updates[key]);
      values.push(auth.userId, id);
      const setClause = fields
        .map((key, idx) => `${key} = $${idx + 1}`)
        .concat('updated_at = now()')
        .join(', ');

      const sql = `update experiences set ${setClause} where host_user_id = $${fields.length + 1} and id = $${fields.length + 2} returning *`;
      const { rows } = await pool.query(sql, values);
      return ok(reply, mapExperience(rows[0]));
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to update experience', 500);
    }
  });

  app.delete('/functions/v1/host/experiences/:id', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
      requireHostRole(auth);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      if (err?.statusCode) {
        return error(reply, err.code || 'FORBIDDEN', err.message, err.statusCode);
      }
      throw err;
    }

    const id = req.params?.id;
    try {
      const { rows } = await pool.query(
        'select id, status, has_active_orders from experiences where id = $1 and host_user_id = $2 limit 1',
        [id, auth.userId]
      );
      const existing = rows[0];
      if (!existing) {
        return ok(reply, { deleted: false });
      }
      if (existing.has_active_orders) {
        return error(reply, 'HAS_ACTIVE_ORDERS', 'Cannot delete experience with active orders', 400);
      }
      if (!['draft', 'rejected', 'archived'].includes(existing.status)) {
        return error(reply, 'INVALID_STATUS', 'Experience cannot be deleted', 400);
      }
      await pool.query('delete from experiences where id = $1 and host_user_id = $2', [id, auth.userId]);
      return ok(reply, { deleted: true });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to delete experience', 500);
    }
  });

  app.post('/functions/v1/host/experiences/:id/duplicate', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
      requireHostRole(auth);
      await requireApprovedHost(pool, auth.userId);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      if (err?.statusCode) {
        return error(reply, err.code || 'FORBIDDEN', err.message, err.statusCode);
      }
      throw err;
    }

    const id = req.params?.id;
    try {
      const { rows } = await pool.query(
        'select * from experiences where id = $1 and host_user_id = $2 limit 1',
        [id, auth.userId]
      );
      const original = rows[0];
      if (!original) {
        return error(reply, 'NOT_FOUND', 'Experience not found', 404);
      }
      const title = original.title ? `${original.title} (Copy)` : 'New experience draft';
      const insertSql = `insert into experiences (
        host_user_id, title, summary, description, city, meeting_point, languages,
        category, duration_minutes, availability, min_guests, max_guests,
        min_advance_hours, cutoff_hours, price_per_guest, currency,
        cancellation_policy, cover_image_url, gallery_urls, safety_notes,
        meetup_notes, status, rejection_reason, completed_orders, has_active_orders,
        rating, review_count, score, tags, host_name, host_avatar_url, host_verified,
        host_cert_status, age_restriction, published_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19, $20,
        $21, 'draft', null, 0, false,
        $22, $23, $24, $25, $26, $27, $28,
        $29, $30, null
      ) returning *`;

      const values = [
        original.host_user_id,
        title,
        original.summary ?? '',
        original.description ?? '',
        original.city ?? '',
        original.meeting_point ?? '',
        original.languages ?? [],
        original.category ?? '',
        original.duration_minutes ?? 0,
        original.availability ?? [],
        original.min_guests ?? 1,
        original.max_guests ?? 1,
        original.min_advance_hours ?? 0,
        original.cutoff_hours ?? 0,
        original.price_per_guest ?? 0,
        original.currency ?? 'CNY',
        original.cancellation_policy ?? 'flexible',
        original.cover_image_url ?? '',
        original.gallery_urls ?? [],
        original.safety_notes ?? '',
        original.meetup_notes ?? '',
        Number(original.rating ?? 0),
        original.review_count ?? 0,
        Number(original.score ?? 0),
        original.tags ?? [],
        original.host_name ?? '',
        original.host_avatar_url ?? '',
        original.host_verified ?? false,
        original.host_cert_status ?? null,
        original.age_restriction ?? null,
      ];

      const inserted = await pool.query(insertSql, values);
      return ok(reply, mapExperience(inserted.rows[0]));
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to duplicate experience', 500);
    }
  });

  app.post('/functions/v1/host/experiences/:id/submit', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
      requireHostRole(auth);
      await requireApprovedHost(pool, auth.userId);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      if (err?.statusCode) {
        return error(reply, err.code || 'FORBIDDEN', err.message, err.statusCode);
      }
      throw err;
    }

    const id = req.params?.id;
    try {
      const { rows } = await pool.query(
        `select id, status, title, summary, description, meetup_notes, safety_notes,
         meeting_point, city, tags
         from experiences where id = $1 and host_user_id = $2 limit 1`,
        [id, auth.userId]
      );
      const current = rows[0];
      if (!current) {
        return error(reply, 'NOT_FOUND', 'Experience not found', 404);
      }
      if (!['draft', 'rejected'].includes(current.status)) {
        return error(reply, 'INVALID_STATUS', 'Experience cannot be submitted', 400);
      }
      const text = buildSafetyTextFromExperience(current);
      if (text) {
        const check = checkText({ scene: 'experience', text, locale: req.headers['accept-language'] });
        if (!check.ok) {
          logBlockedContent({
            req,
            scene: 'experience',
            reasons: check.reasons,
            textPreview: buildTextPreview(text),
            source: 'experience',
            userId: auth.userId,
          });
          return contentBlocked(reply, check.reasons);
        }
      }
      const updated = await pool.query(
        `update experiences set status = 'published', rejection_reason = null,
         published_at = now(), updated_at = now()
         where id = $1 and host_user_id = $2 returning *`,
        [id, auth.userId]
      );
      return ok(reply, mapExperience(updated.rows[0]));
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to submit experience', 500);
    }
  });

  app.post('/functions/v1/host/experiences/:id/pause', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
      requireHostRole(auth);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      if (err?.statusCode) {
        return error(reply, err.code || 'FORBIDDEN', err.message, err.statusCode);
      }
      throw err;
    }

    const id = req.params?.id;
    try {
      const { rows } = await pool.query(
        'select id, status from experiences where id = $1 and host_user_id = $2 limit 1',
        [id, auth.userId]
      );
      const current = rows[0];
      if (!current) {
        return error(reply, 'NOT_FOUND', 'Experience not found', 404);
      }
      if (current.status !== 'published') {
        return error(reply, 'INVALID_STATUS', 'Experience cannot be paused', 400);
      }
      const updated = await pool.query(
        `update experiences set status = 'paused', updated_at = now()
         where id = $1 and host_user_id = $2 returning *`,
        [id, auth.userId]
      );
      return ok(reply, mapExperience(updated.rows[0]));
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to pause experience', 500);
    }
  });

  app.post('/functions/v1/host/experiences/:id/resume', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
      requireHostRole(auth);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      if (err?.statusCode) {
        return error(reply, err.code || 'FORBIDDEN', err.message, err.statusCode);
      }
      throw err;
    }

    const id = req.params?.id;
    try {
      const { rows } = await pool.query(
        'select id, status from experiences where id = $1 and host_user_id = $2 limit 1',
        [id, auth.userId]
      );
      const current = rows[0];
      if (!current) {
        return error(reply, 'NOT_FOUND', 'Experience not found', 404);
      }
      if (current.status !== 'paused') {
        return error(reply, 'INVALID_STATUS', 'Experience cannot be resumed', 400);
      }
      const updated = await pool.query(
        `update experiences set status = 'published', updated_at = now()
         where id = $1 and host_user_id = $2 returning *`,
        [id, auth.userId]
      );
      return ok(reply, mapExperience(updated.rows[0]));
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to resume experience', 500);
    }
  });

  app.post('/functions/v1/host/experiences/:id/archive', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
      requireHostRole(auth);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      if (err?.statusCode) {
        return error(reply, err.code || 'FORBIDDEN', err.message, err.statusCode);
      }
      throw err;
    }

    const id = req.params?.id;
    try {
      const { rows } = await pool.query(
        'select id, status, has_active_orders from experiences where id = $1 and host_user_id = $2 limit 1',
        [id, auth.userId]
      );
      const current = rows[0];
      if (!current) {
        return error(reply, 'NOT_FOUND', 'Experience not found', 404);
      }
      if (current.has_active_orders) {
        return error(reply, 'HAS_ACTIVE_ORDERS', 'Cannot archive experience with active orders', 400);
      }
      if (!['published', 'paused'].includes(current.status)) {
        return error(reply, 'INVALID_STATUS', 'Experience cannot be archived', 400);
      }
      const updated = await pool.query(
        `update experiences set status = 'archived', updated_at = now()
         where id = $1 and host_user_id = $2 returning *`,
        [id, auth.userId]
      );
      return ok(reply, mapExperience(updated.rows[0]));
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to archive experience', 500);
    }
  });

  app.get('/functions/v1/discover/experiences/recommend', async (req, reply) => {
    const page = normalizeInt(req.query?.page, 1);
    const pageSize = normalizeInt(req.query?.pageSize, 10);
    const city = (req.query?.city || '').toString().trim();
    const categories = (req.query?.categories || '').toString().trim();
    const languages = (req.query?.languages || '').toString().trim();
    const minPrice = req.query?.minPrice;
    const maxPrice = req.query?.maxPrice;
    const minRating = req.query?.minRating;
    const sort = (req.query?.sort || 'recommended').toString().trim();

    const params = ['published'];
    const where = ['status = $1'];
    if (city) {
      params.push(city);
      where.push(`city = $${params.length}`);
    }
    if (categories) {
      const list = categories.split(',').map((item) => item.trim()).filter(Boolean);
      if (list.length > 0) {
        params.push(list);
        where.push(`category = ANY($${params.length}::text[])`);
      }
    }
    if (languages) {
      const list = languages.split(',').map((item) => item.trim()).filter(Boolean);
      if (list.length > 0) {
        params.push(JSON.stringify(list));
        where.push(`languages @> $${params.length}::jsonb`);
      }
    }
    if (minPrice !== undefined) {
      const value = Number(minPrice);
      if (Number.isFinite(value)) {
        params.push(value);
        where.push(`price_per_guest >= $${params.length}`);
      }
    }
    if (maxPrice !== undefined) {
      const value = Number(maxPrice);
      if (Number.isFinite(value)) {
        params.push(value);
        where.push(`price_per_guest <= $${params.length}`);
      }
    }
    if (minRating !== undefined) {
      const value = Number(minRating);
      if (Number.isFinite(value)) {
        params.push(value);
        where.push(`rating >= $${params.length}`);
      }
    }

    let orderBy = 'score desc, rating desc, review_count desc, updated_at desc, id desc';
    if (sort === 'rating') {
      orderBy = 'rating desc, review_count desc, updated_at desc, id desc';
    } else if (sort === 'priceLowHigh') {
      orderBy = 'price_per_guest asc, updated_at desc, id desc';
    } else if (sort === 'priceHighLow') {
      orderBy = 'price_per_guest desc, updated_at desc, id desc';
    } else if (sort === 'popularity') {
      orderBy = 'completed_orders desc, updated_at desc, id desc';
    }

    params.push(pageSize);
    params.push((page - 1) * pageSize);

    const sql = `select * from experiences where ${where.join(' and ')}
      order by ${orderBy}
      limit $${params.length - 1} offset $${params.length}`;

    try {
      const { rows } = await pool.query(sql, params);
      const items = rows.map(mapExperienceBrief);
      const hasMore = rows.length === pageSize;
      const nextPage = hasMore ? page + 1 : page;
      return ok(reply, { items, hasMore, nextPage });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch recommendations', 500);
    }
  });

  app.get('/functions/v1/experiences/:id', async (req, reply) => {
    const id = req.params?.id;
    try {
      const { rows } = await pool.query(
        'select * from experiences where id = $1 and status = $2 limit 1',
        [id, 'published']
      );
      if (!rows[0]) {
        return error(reply, 'NOT_FOUND', 'Experience not found', 404);
      }
      return ok(reply, mapExperienceDetail(rows[0]));
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch experience detail', 500);
    }
  });

  app.get('/functions/v1/experiences/:id/reviews', async (req, reply) => {
    const id = req.params?.id;
    const limit = normalizeLimit(req.query?.limit, 10, 50);
    const cursor = req.query?.cursor;
    const sort = (req.query?.sort || 'newest').toString().trim();
    if (!id || String(id).trim().length === 0) {
      return error(reply, 'INVALID_INPUT', 'experienceId is required', 400);
    }
    if (sort && sort !== 'newest') {
      // Only newest is supported for now.
    }

    const cursorData = decodeReviewCursor(cursor);
    if (cursor && !cursorData) {
      return error(reply, 'INVALID_CURSOR', 'Invalid cursor', 400);
    }

    const params = [id, 'COMPLETED'];
    const where = [
      'o.experience_id = $1',
      'o.status = $2',
      `(
        (
          exists (
            select 1 from reviews r2
            where r2.order_id = o.id
              and (r2.from_role = $3 or r2.from_user_id = o.traveler_id)
          )
          and exists (
            select 1 from reviews r3
            where r3.order_id = o.id
              and (r3.from_role = $4 or r3.from_user_id = o.host_id)
          )
        )
        or (o.completed_at is not null and o.completed_at + interval '${REVIEW_REVEAL_DAYS} days' <= now())
      )`,
    ];
    params.push(REVIEW_ROLE.TRAVELER, REVIEW_ROLE.HOST);

    if (cursorData) {
      params.push(cursorData.createdAt);
      params.push(cursorData.id);
      where.push(`(r.created_at, r.id) < ($${params.length - 1}, $${params.length})`);
    }

    params.push(limit + 1);

    const sql = `select
        r.id,
        r.rating,
        r.comment,
        r.created_at,
        r.from_role,
        r.to_role,
        r.from_user_id,
        r.to_user_id,
        o.traveler_id,
        o.host_id
      from reviews r
      join orders o on o.id = r.order_id
      where ${where.join(' and ')}
      order by r.created_at desc, r.id desc
      limit $${params.length}`;

    try {
      const { rows } = await pool.query(sql, params);
      const sliced = rows.slice(0, limit);
      const items = sliced.map((row) => {
        const fromRole = resolveReviewRole(row, row);
        const toRole = resolveToRole(row, fromRole);
        return {
          id: row.id?.toString() ?? '',
          rating: row.rating ?? 0,
          comment: row.comment ?? '',
          createdAt: toIso(row.created_at),
          fromRole,
          toRole,
          displayAuthor: displayAuthorLabel(fromRole),
        };
      });
      const last = items[items.length - 1];
      const nextCursor = rows.length > limit && last
        ? encodeReviewCursor(last.createdAt, last.id)
        : null;
      return ok(reply, { items, nextCursor });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch experience reviews', 500);
    }
  });
}

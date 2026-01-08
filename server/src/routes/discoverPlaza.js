import { ok, error, contentBlocked } from '../utils/responses.js';
import { requireAuth, respondAuthError } from '../services/authService.js';
import { checkText } from '../services/contentSafetyService.js';
import { logBlockedContent, buildTextPreview } from '../services/safetyAuditLogger.js';
import { signUrlsFromStoredUrls, signUrlFromStoredUrl } from '../services/storage/ossStorageService.js';

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

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function encodeCursor(createdAt, id) {
  if (!createdAt || !id) return null;
  const value = `${toIso(createdAt)}|${id}`;
  return Buffer.from(value).toString('base64');
}

function decodeCursor(token) {
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [createdAtRaw, id] = decoded.split('|');
    if (!createdAtRaw || !id) return null;
    const createdAt = new Date(createdAtRaw);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch (_err) {
    return null;
  }
}

function mapPost(row) {
  return {
    id: row.id,
    authorId: row.author_id ?? '',
    authorName: row.author_name ?? '',
    // Convert stored avatar URL to signed URL
    authorAvatarUrl: signUrlFromStoredUrl(row.author_avatar_url ?? ''),
    city: row.city ?? '',
    content: row.content ?? '',
    // Convert stored image URLs to signed URLs (1 hour expiry)
    imageUrls: signUrlsFromStoredUrls(asStringArray(row.images), 3600),
    likes: row.like_count ?? 0,
    comments: row.comment_count ?? 0,
    publishedAt: toIso(row.created_at) ?? new Date().toISOString(),
    tags: asStringArray(row.tags),
    video: row.video ?? null,
  };
}

function mapComment(row) {
  return {
    id: row.id,
    postId: row.post_id,
    userId: row.user_id,
    authorName: row.author_name ?? '',
    authorAvatarUrl: row.author_avatar_url ?? '',
    content: row.content ?? '',
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
  };
}

export default async function discoverPlazaRoutes(app) {
  const pool = app.pg.pool;

  app.get('/functions/v1/discover/posts', async (req, reply) => {
    const limit = normalizeInt(req.query?.limit, 20);
    const city = (req.query?.city || '').toString().trim();
    const cursor = decodeCursor(req.query?.cursor);

    const params = ['published'];
    const where = ['status = $1'];
    if (city) {
      params.push(city);
      where.push(`city = $${params.length}`);
    }
    if (cursor) {
      params.push(cursor.createdAt);
      params.push(cursor.id);
      where.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
    }

    params.push(limit + 1);
    const sql = `select * from discover_posts where ${where.join(' and ')}
      order by created_at desc, id desc
      limit $${params.length}`;

    try {
      const { rows } = await pool.query(sql, params);
      const hasMore = rows.length > limit;
      const sliced = hasMore ? rows.slice(0, limit) : rows;
      const posts = sliced.map(mapPost);
      const last = sliced[sliced.length - 1];
      const nextCursor = last ? encodeCursor(last.created_at, last.id) : null;
      return ok(reply, { posts, nextCursor, hasMore });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch posts', 500);
    }
  });

  app.post('/functions/v1/discover/posts', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }

    const payload = req.body || {};
    const content = (payload.content || '').toString();
    if (!content && (!Array.isArray(payload.images) || payload.images.length === 0) && !payload.video) {
      return error(reply, 'INVALID_REQUEST', 'content or media required', 400);
    }
    const tags = Array.isArray(payload.tags) ? payload.tags : [];
    const composed = [content, ...tags].join(' ').trim();
    if (composed) {
      const check = checkText({ scene: 'post', text: composed, locale: req.headers['accept-language'] });
      if (!check.ok) {
        logBlockedContent({
          req,
          scene: 'post',
          reasons: check.reasons,
          textPreview: buildTextPreview(composed),
          source: 'post',
          userId: auth.userId,
        });
        return contentBlocked(reply, check.reasons);
      }
    }

    const images = Array.isArray(payload.images) ? payload.images : [];
    const params = [
      auth.userId,
      (payload.authorName || '').toString(),
      (payload.authorAvatarUrl || '').toString(),
      payload.city ? payload.city.toString() : null,
      content,
      JSON.stringify(images),
      payload.video ? JSON.stringify(payload.video) : null,
      JSON.stringify(tags),
    ];

    try {
      const { rows } = await pool.query(
        `insert into discover_posts (
          author_id, author_name, author_avatar_url, city, content, images, video, tags
        ) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
        params
      );
      return ok(reply, mapPost(rows[0]));
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to publish post', 500);
    }
  });

  app.post('/functions/v1/discover/posts/:id/like', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }

    const postId = req.params?.id;
    const client = await pool.connect();
    try {
      await client.query('begin');
      const insert = await client.query(
        'insert into discover_post_likes (post_id, user_id) values ($1, $2) on conflict do nothing returning post_id',
        [postId, auth.userId]
      );
      let likeCount = null;
      if (insert.rowCount > 0) {
        const updated = await client.query(
          'update discover_posts set like_count = like_count + 1, updated_at = now() where id = $1 returning like_count',
          [postId]
        );
        likeCount = updated.rows[0]?.like_count ?? null;
      }
      if (likeCount === null) {
        const current = await client.query('select like_count from discover_posts where id = $1', [postId]);
        likeCount = current.rows[0]?.like_count ?? 0;
      }
      await client.query('commit');
      return ok(reply, { liked: true, likeCount });
    } catch (err) {
      await client.query('rollback');
      if (err?.code === '23503') {
        return error(reply, 'NOT_FOUND', 'Post not found', 404);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to like post', 500);
    } finally {
      client.release();
    }
  });

  app.delete('/functions/v1/discover/posts/:id/like', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }

    const postId = req.params?.id;
    const client = await pool.connect();
    try {
      await client.query('begin');
      const del = await client.query(
        'delete from discover_post_likes where post_id = $1 and user_id = $2',
        [postId, auth.userId]
      );
      let likeCount = null;
      if (del.rowCount > 0) {
        const updated = await client.query(
          'update discover_posts set like_count = greatest(like_count - 1, 0), updated_at = now() where id = $1 returning like_count',
          [postId]
        );
        likeCount = updated.rows[0]?.like_count ?? 0;
      }
      if (likeCount === null) {
        const current = await client.query('select like_count from discover_posts where id = $1', [postId]);
        likeCount = current.rows[0]?.like_count ?? 0;
      }
      await client.query('commit');
      return ok(reply, { liked: false, likeCount });
    } catch (err) {
      await client.query('rollback');
      if (err?.code === '23503') {
        return error(reply, 'NOT_FOUND', 'Post not found', 404);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to unlike post', 500);
    } finally {
      client.release();
    }
  });

  app.get('/functions/v1/discover/posts/:id/comments', async (req, reply) => {
    const postId = req.params?.id;
    const limit = normalizeInt(req.query?.limit, 20);
    const cursor = decodeCursor(req.query?.cursor);

    const params = [postId];
    const where = ['post_id = $1'];
    if (cursor) {
      params.push(cursor.createdAt);
      params.push(cursor.id);
      where.push(`(created_at, id) > ($${params.length - 1}, $${params.length})`);
    }

    params.push(limit + 1);
    const sql = `select * from discover_comments where ${where.join(' and ')}
      order by created_at asc, id asc
      limit $${params.length}`;

    try {
      const { rows } = await pool.query(sql, params);
      const hasMore = rows.length > limit;
      const sliced = hasMore ? rows.slice(0, limit) : rows;
      const comments = sliced.map(mapComment);
      const last = sliced[sliced.length - 1];
      const nextCursor = last ? encodeCursor(last.created_at, last.id) : null;
      return ok(reply, { comments, nextCursor, hasMore });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch comments', 500);
    }
  });

  app.post('/functions/v1/discover/posts/:id/comments', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }

    const postId = req.params?.id;
    const payload = req.body || {};
    const content = (payload.content || '').toString().trim();
    if (!content) {
      return error(reply, 'INVALID_REQUEST', 'content is required', 400);
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      const insert = await client.query(
        `insert into discover_comments (
          post_id, user_id, author_name, author_avatar_url, content
        ) values ($1, $2, $3, $4, $5) returning *`,
        [
          postId,
          auth.userId,
          (payload.authorName || '').toString(),
          (payload.authorAvatarUrl || '').toString(),
          content,
        ]
      );
      await client.query(
        'update discover_posts set comment_count = comment_count + 1, updated_at = now() where id = $1',
        [postId]
      );
      await client.query('commit');
      return ok(reply, mapComment(insert.rows[0]));
    } catch (err) {
      await client.query('rollback');
      if (err?.code === '23503') {
        return error(reply, 'NOT_FOUND', 'Post not found', 404);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to publish comment', 500);
    } finally {
      client.release();
    }
  });
}

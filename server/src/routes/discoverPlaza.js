import { ok, error, contentBlocked } from '../utils/responses.js';
import { AuthError, requireAuth, respondAuthError } from '../services/authService.js';
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
    isLiked: row.is_liked ?? false,
    status: row.status ?? 'published',
    publishedAt: toIso(row.created_at) ?? new Date().toISOString(),
    tags: asStringArray(row.tags),
    video: row.video ?? null,
  };
}

function mapComment(row, auth) {
  return {
    id: row.id,
    postId: row.post_id,
    authorName: row.author_name ?? '',
    authorAvatarUrl: row.author_avatar_url ?? '',
    content: row.content ?? '',
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    isMine: auth?.userId ? row.user_id === auth.userId : false,
  };
}

function nextStatusForAction(action, currentStatus) {
  switch (action) {
    case 'hide':
      return currentStatus === 'published' ? 'hidden' : null;
    case 'unhide':
      return currentStatus === 'hidden' ? 'published' : null;
    case 'delete':
      return ['published', 'hidden'].includes(currentStatus) ? 'removed' : null;
    default:
      return null;
  }
}

export default async function discoverPlazaRoutes(app) {
  const pool = app.pg.pool;

  app.get('/functions/v1/discover/posts', async (req, reply) => {
    const mine = req.query?.mine?.toString() === '1';
    const limit = normalizeInt(req.query?.limit, 20);
    const city = (req.query?.city || '').toString().trim();
    const cursor = decodeCursor(req.query?.cursor);

    let auth = null;
    if (mine) {
      try {
        auth = await requireAuth(req, reply);
      } catch (err) {
        if (respondAuthError(err, reply)) return;
        throw err;
      }
    } else {
      try {
        auth = await requireAuth(req, null);
      } catch (err) {
        if (!(err instanceof AuthError)) {
          throw err;
        }
      }
    }

    const params = [];
    const where = [];
    if (mine) {
      const statusRaw = (req.query?.status || '').toString().trim();
      const status = statusRaw || 'published';
      if (!['published', 'hidden'].includes(status)) {
        return error(reply, 'INVALID_REQUEST', 'Invalid status', 400);
      }
      params.push(auth.userId, status);
      where.push('p.author_id = $1', 'p.status = $2');
    } else {
      params.push('published');
      where.push('p.status = $1');
    }
    if (city) {
      params.push(city);
      where.push(`p.city = $${params.length}`);
    }
    if (cursor) {
      params.push(cursor.createdAt);
      params.push(cursor.id);
      where.push(`(p.created_at, p.id) < ($${params.length - 1}, $${params.length})`);
    }

    let likedSelect = 'false as is_liked';
    if (auth?.userId) {
      params.push(auth.userId);
      likedSelect =
        `exists (select 1 from discover_post_likes l where l.post_id = p.id and l.user_id = $${params.length}) as is_liked`;
    }
    params.push(limit + 1);
    const sql = `select p.*, ${likedSelect} from discover_posts p where ${where.join(' and ')}
      order by p.created_at desc, p.id desc
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

  app.patch('/functions/v1/discover/posts/:id', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }

    const postId = req.params?.id;
    const action = (req.body?.action || '').toString().trim();
    if (!postId || !action) {
      return error(reply, 'INVALID_REQUEST', 'Invalid post action', 400);
    }

    try {
      const { rows } = await pool.query(
        'select id, author_id, status from discover_posts where id = $1 limit 1',
        [postId]
      );
      const post = rows[0];
      if (!post) {
        return error(reply, 'NOT_FOUND', 'Post not found', 404);
      }
      if (post.author_id !== auth.userId) {
        return error(reply, 'FORBIDDEN', 'No access to post', 403);
      }
      const nextStatus = nextStatusForAction(action, post.status);
      if (!nextStatus) {
        return error(reply, 'INVALID_STATUS', 'Invalid post action', 400);
      }

      const update = await pool.query(
        `update discover_posts
         set status = $1, updated_at = now()
         where id = $2
         returning id, status, updated_at`,
        [nextStatus, postId]
      );
      const updated = update.rows[0];
      return ok(reply, {
        id: updated.id,
        status: updated.status,
        updatedAt: toIso(updated.updated_at),
      });
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to update post', 500);
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
    let auth = null;
    try {
      auth = await requireAuth(req, null);
    } catch (err) {
      if (!(err instanceof AuthError)) {
        throw err;
      }
    }
    const limit = normalizeInt(req.query?.limit, 20);
    const cursor = decodeCursor(req.query?.cursor);

    try {
      const postResult = await pool.query(
        'select status from discover_posts where id = $1 limit 1',
        [postId]
      );
      const post = postResult.rows[0];
      if (!post || post.status !== 'published') {
        return error(reply, 'NOT_FOUND', 'Post not found', 404);
      }
    } catch (err) {
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to fetch comments', 500);
    }

    const params = [postId, 'published'];
    const where = ['post_id = $1', 'status = $2'];
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
      const comments = sliced.map((row) => mapComment(row, auth));
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
      const postResult = await client.query(
        'select status from discover_posts where id = $1 limit 1',
        [postId]
      );
      const post = postResult.rows[0];
      if (!post || post.status !== 'published') {
        await client.query('rollback');
        return error(reply, 'NOT_FOUND', 'Post not found', 404);
      }
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
      return ok(reply, mapComment(insert.rows[0], auth));
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

  app.delete('/functions/v1/discover/posts/:postId/comments/:commentId', async (req, reply) => {
    let auth = null;
    try {
      auth = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }

    const postId = req.params?.postId;
    const commentId = req.params?.commentId;
    if (!postId || !commentId) {
      return error(reply, 'INVALID_REQUEST', 'Invalid comment id', 400);
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query(
        'select * from discover_comments where id = $1 and post_id = $2 limit 1',
        [commentId, postId]
      );
      const comment = rows[0];
      if (!comment) {
        await client.query('rollback');
        return error(reply, 'NOT_FOUND', 'Comment not found', 404);
      }
      if (comment.user_id !== auth.userId) {
        await client.query('rollback');
        return error(reply, 'FORBIDDEN', 'No access to comment', 403);
      }
      if (comment.status !== 'deleted') {
        await client.query(
          'update discover_comments set status = $1, updated_at = now() where id = $2',
          ['deleted', commentId]
        );
        if (comment.status === 'published') {
          await client.query(
            'update discover_posts set comment_count = greatest(comment_count - 1, 0), updated_at = now() where id = $1',
            [postId]
          );
        }
      }
      await client.query('commit');
      return ok(reply, { id: commentId, status: 'deleted' });
    } catch (err) {
      await client.query('rollback');
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Failed to delete comment', 500);
    } finally {
      client.release();
    }
  });
}

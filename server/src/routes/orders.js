import { requireAuth, respondAuthError } from '../services/authService.js';
import { requireApprovedHost } from '../middlewares/requireApprovedHost.js';
import { authorize } from '../services/authorize.js';
import { ok, error } from '../utils/responses.js';
import { toOrderReadModel } from '../readModels/orderReadModel.js';

const ORDER_STATUS = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PENDING: 'PENDING_HOST_CONFIRM',
  CONFIRMED: 'CONFIRMED',
  IN_SERVICE: 'IN_SERVICE',
  COMPLETED: 'COMPLETED',
  CANCELLED_REFUNDED: 'CANCELLED_REFUNDED',
  CANCELLED_BY_TRAVELER: 'CANCELLED_BY_TRAVELER',
};

const REVIEW_REVEAL_DAYS = 14;
const REVIEW_ROLE = {
  TRAVELER: 'TRAVELER',
  HOST: 'HOST',
};

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function computeReviewRevealAt(order) {
  const completedAt = normalizeDate(order?.completed_at);
  if (!completedAt) return null;
  const revealAt = new Date(completedAt);
  revealAt.setDate(revealAt.getDate() + REVIEW_REVEAL_DAYS);
  return revealAt;
}

function computeReviewVisibility(order, travelerReviewed, hostReviewed) {
  if (travelerReviewed && hostReviewed) return true;
  const revealAt = computeReviewRevealAt(order);
  if (!revealAt) return false;
  return Date.now() >= revealAt.getTime();
}

function attachReviewStatus(order) {
  const travelerReviewed = Boolean(order?.traveler_reviewed);
  const hostReviewed = Boolean(order?.host_reviewed);
  const revealAt = computeReviewRevealAt(order);
  const visible = computeReviewVisibility(order, travelerReviewed, hostReviewed);
  return {
    ...order,
    traveler_reviewed: travelerReviewed,
    host_reviewed: hostReviewed,
    review_reveal_at: revealAt ? revealAt.toISOString() : null,
    review_visible: visible,
  };
}

function resolveReviewRole(review, order) {
  if (review?.from_role) return review.from_role;
  if (review?.from_user_id === order?.traveler_id) return REVIEW_ROLE.TRAVELER;
  if (review?.from_user_id === order?.host_id) return REVIEW_ROLE.HOST;
  return null;
}

function serializeReview(review, order) {
  if (!review) return null;
  const fromRole = resolveReviewRole(review, order);
  const toRole = review.to_role || (fromRole === REVIEW_ROLE.TRAVELER ? REVIEW_ROLE.HOST : REVIEW_ROLE.TRAVELER);
  return {
    id: review.id,
    order_id: review.order_id,
    from_user_id: review.from_user_id,
    to_user_id: review.to_user_id,
    from_role: fromRole,
    to_role: toRole,
    rating: review.rating,
    comment: review.comment,
    created_at: review.created_at,
    updated_at: review.updated_at,
  };
}

function requireUserId(userId) {
  if (!userId || String(userId).trim().length === 0) {
    const err = new Error('userId is required');
    err.code = 'USER_ID_REQUIRED';
    err.statusCode = 400;
    throw err;
  }
  return String(userId).trim();
}

async function ensureProfile(pool, userId) {
  const validated = requireUserId(userId);
  const { rows } = await pool.query(
    'select ensure_profile_v2($1, $2) as id',
    [validated, null]
  );
  return rows[0]?.id;
}

async function fetchOrder(pool, orderId) {
  const { rows } = await pool.query(
    `select o.*,
            host_profile.id as "hostUserId",
            host_profile.nickname as "host_nickname",
            traveler_profile.id as "travelerUserId",
            traveler_profile.nickname as "traveler_nickname",
            coalesce(refund.status, o.refund_status) as refund_status,
            coalesce(refund.processed_at, o.refund_at) as refund_at,
            refund.id as refund_id,
            exists(
              select 1 from reviews r
              where r.order_id = o.id and r.from_user_id = o.traveler_id
            ) as traveler_reviewed,
            exists(
              select 1 from reviews r
              where r.order_id = o.id and r.from_user_id = o.host_id
            ) as host_reviewed
     from orders o
     left join profiles host_profile on host_profile.id = o.host_id
     left join profiles traveler_profile on traveler_profile.id = o.traveler_id
     left join lateral (
       select r.id, r.status, r.processed_at
       from refunds r
       where r.order_id = o.id
       order by r.created_at desc
       limit 1
     ) refund on true
     where o.id = $1`,
    [orderId]
  );
  return rows[0] ? attachReviewStatus(rows[0]) : null;
}

function parsePath(req) {
  const routeOverride =
    req.headers['x-route'] ||
    req.headers['x-path'] ||
    (req.query ? req.query.route : null) ||
    '';
  if (routeOverride) {
    try {
      const u = new URL(routeOverride.startsWith('http') ? routeOverride : `http://local${routeOverride}`);
      return u;
    } catch {
      return new URL(`http://local${routeOverride}`);
    }
  }
  return new URL(`http://local${req.url.replace('/functions/v1/orders', '') || '/'}`);
}

async function handleCreate(pool, req, reply, actor) {
  const body = req.body || {};
  const {
    experienceId,
    hostId,
    startTime,
    endTime,
    peopleCount,
    totalAmount,
    currency = 'CNY',
    travelerNote = null,
    experienceTitle = null,
    experienceCover = null,
    city = null,
    meetingPoint = null,
    languagePreference = null,
    timeSlotLabel = null,
    tags = null,
    travelerName = null,
    travelerAvatar = null,
    hostName = null,
    hostAvatar = null,
    contactPhone = null,
    channel = null,
    visibleToTraveler = null,
    visibleToHost = null,
  } = body;
  if (!experienceId || !hostId || !startTime || !endTime || !peopleCount || !totalAmount) {
    return error(reply, 'INVALID_INPUT', 'Missing required fields', 400);
  }
  const profileId = await ensureProfile(pool, actor.userId);
  const hostProfileId = await ensureProfile(pool, hostId);
  authorize({ ...actor, profileId }, 'orders:create');

  const { rows: existingRows } = await pool.query(
    `select * from orders
     where traveler_id = $1 and host_id = $2 and experience_id = $3 and start_time = $4
     order by created_at desc limit 1`,
    [profileId, hostProfileId, experienceId, startTime]
  );
  if (existingRows[0]) return ok(reply, existingRows[0]);

  const orderNo = `ORD${Date.now()}${Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, '0')}`;
  const { rows } = await pool.query(
    `insert into orders
    (order_no, traveler_id, host_id, experience_id, start_time, end_time, people_count,
     status, payment_status, total_amount, currency, traveler_note, paid_at,
     experience_title, experience_cover, city, meeting_point, language_preference,
     time_slot_label, tags, traveler_name, traveler_avatar, host_name, host_avatar,
     contact_phone, channel, visible_to_traveler, visible_to_host)
     values ($1,$2,$3,$4,$5,$6,$7,'PENDING_PAYMENT','UNPAID',$8,$9,$10, null,
             $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     returning *`,
    [
     orderNo,
     profileId,
      hostProfileId,
      experienceId,
      startTime,
      endTime,
      peopleCount,
      totalAmount,
      currency,
      travelerNote,
      experienceTitle,
      experienceCover,
      city,
      meetingPoint,
      languagePreference,
      timeSlotLabel,
      tags,
      travelerName,
      travelerAvatar,
      hostName,
      hostAvatar,
      contactPhone,
      channel,
      visibleToTraveler,
      visibleToHost,
    ]
  );
  const order = rows[0];
  await pool.query(
    'insert into order_status_logs(order_id, from_status, to_status, actor_id, actor_role) values ($1,$2,$3,$4,$5)',
    [order.id, null, order.status, profileId, 'TRAVELER']
  );
  const enriched = await fetchOrder(pool, order.id);
  return ok(reply, toOrderReadModel(enriched ?? order), 201);
}

async function handleMarkPaid(pool, req, reply, actor, orderId) {
  const profileId = await ensureProfile(pool, actor.userId);
  authorize({ ...actor, profileId }, 'orders:mark_paid', { travelerId: profileId });
  const order = await fetchOrder(pool, orderId);
  if (!order) return error(reply, 'NOT_FOUND', 'Order not found', 404);
  if (order.payment_status !== 'UNPAID') {
    return error(reply, 'INVALID_STATUS_TRANSITION', 'Order already paid', 400);
  }
  if (order.traveler_id !== profileId) {
    return error(reply, 'FORBIDDEN', 'Only traveler can mark paid', 403);
  }
  if (order.status === ORDER_STATUS.CANCELLED_REFUNDED ||
      order.status === ORDER_STATUS.CANCELLED_BY_TRAVELER ||
      order.status === ORDER_STATUS.COMPLETED) {
    return error(reply, 'INVALID_STATUS_TRANSITION', 'Order not payable', 400);
  }
  const nextStatus = order.status === ORDER_STATUS.PENDING_PAYMENT
    ? ORDER_STATUS.PENDING
    : order.status;
  const { rows } = await pool.query(
    `update orders set payment_status='PAID', status=$2, paid_at = now()
     where id = $1 returning *`,
    [orderId, nextStatus]
  );
  if (nextStatus !== order.status) {
    await pool.query(
      'insert into order_status_logs(order_id, from_status, to_status, actor_id, actor_role, reason) values ($1,$2,$3,$4,$5,$6)',
      [orderId, order.status, nextStatus, profileId, 'TRAVELER', 'PAYMENT_CONFIRMED']
    );
  }
  const enriched = await fetchOrder(pool, rows[0].id);
  return ok(reply, enriched ?? rows[0]);
}

async function handleAccept(pool, req, reply, actor, orderId) {
  const profileId = await ensureProfile(pool, actor.userId);
  const order = await fetchOrder(pool, orderId);
  if (!order) return error(reply, 'NOT_FOUND', 'Order not found', 404);
  authorize({ ...actor, profileId }, 'orders:accept', { hostId: order.host_id });
  await requireApprovedHost(pool, actor.userId);
  if (order.payment_status !== 'PAID') {
    return error(reply, 'PAYMENT_REQUIRED', 'Order not paid', 400);
  }
  if (order.status !== ORDER_STATUS.PENDING) {
    return error(reply, 'INVALID_STATUS_TRANSITION', 'Order not pending host confirm', 400);
  }
  const { rows } = await pool.query(
    `update orders set status='CONFIRMED', confirmed_at=now() where id=$1 returning *`,
    [orderId]
  );
  await pool.query(
    'insert into order_status_logs(order_id, from_status, to_status, actor_id, actor_role) values ($1,$2,$3,$4,$5)',
    [orderId, order.status, ORDER_STATUS.CONFIRMED, profileId, 'HOST']
  );
  const enriched = await fetchOrder(pool, rows[0].id);
  return ok(reply, enriched ?? rows[0]);
}

async function handleReject(pool, req, reply, actor, orderId) {
  const profileId = await ensureProfile(pool, actor.userId);
  const order = await fetchOrder(pool, orderId);
  if (!order) return error(reply, 'NOT_FOUND', 'Order not found', 404);
  authorize({ ...actor, profileId }, 'orders:reject', { hostId: order.host_id });
  await requireApprovedHost(pool, actor.userId);
  if (order.status !== ORDER_STATUS.PENDING) {
    return error(reply, 'INVALID_STATUS_TRANSITION', 'Order not pending host confirm', 400);
  }
  const reason = (req.body || {}).reason || null;
  const nextPaymentStatus = order.payment_status === 'PAID' ? 'REFUNDED' : order.payment_status;
  const { rows } = await pool.query(
    `update orders set status='CANCELLED_REFUNDED', payment_status=$2,
     cancelled_at=now(), cancelled_by='HOST', cancelled_reason=$3 where id=$1 returning *`,
    [orderId, nextPaymentStatus, reason]
  );
  await pool.query(
    'insert into order_status_logs(order_id, from_status, to_status, actor_id, actor_role, reason) values ($1,$2,$3,$4,$5,$6)',
    [orderId, order.status, ORDER_STATUS.CANCELLED_REFUNDED, profileId, 'HOST', reason]
  );
  const enriched = await fetchOrder(pool, rows[0].id);
  return ok(reply, enriched ?? rows[0]);
}

async function handleCancel(pool, req, reply, actor, orderId) {
  const profileId = await ensureProfile(pool, actor.userId);
  const order = await fetchOrder(pool, orderId);
  if (!order) return error(reply, 'NOT_FOUND', 'Order not found', 404);
  authorize({ ...actor, profileId }, 'orders:cancel', { travelerId: order.traveler_id });
  if (order.status === ORDER_STATUS.COMPLETED || order.status === ORDER_STATUS.IN_SERVICE) {
    return error(reply, 'INVALID_STATUS_TRANSITION', 'Order cannot be cancelled', 400);
  }
  const reason = (req.body || {}).reason || null;
  const nextPaymentStatus = order.payment_status === 'PAID' ? 'REFUNDED' : order.payment_status;
  const { rows } = await pool.query(
    `update orders set status='CANCELLED_BY_TRAVELER', payment_status=$2,
     cancelled_at=now(), cancelled_by='TRAVELER', cancelled_reason=$3 where id=$1 returning *`,
    [orderId, nextPaymentStatus, reason]
  );
  await pool.query(
    'insert into order_status_logs(order_id, from_status, to_status, actor_id, actor_role, reason) values ($1,$2,$3,$4,$5,$6)',
    [orderId, order.status, ORDER_STATUS.CANCELLED_BY_TRAVELER, profileId, 'TRAVELER', reason]
  );
  const enriched = await fetchOrder(pool, rows[0].id);
  return ok(reply, enriched ?? rows[0]);
}

async function handleStart(pool, req, reply, actor, orderId) {
  const profileId = await ensureProfile(pool, actor.userId);
  const order = await fetchOrder(pool, orderId);
  if (!order) return error(reply, 'NOT_FOUND', 'Order not found', 404);
  authorize({ ...actor, profileId }, 'orders:start', { hostId: order.host_id, travelerId: order.traveler_id });
  if (actor.role === 'host') {
    await requireApprovedHost(pool, actor.userId);
  }
  if (order.status !== ORDER_STATUS.CONFIRMED) {
    return error(reply, 'INVALID_STATUS_TRANSITION', 'Order not confirmed', 400);
  }
  const actorRole = order.host_id === profileId ? 'HOST' : 'TRAVELER';
  const { rows } = await pool.query(
    `update orders set status='IN_SERVICE', started_at=now() where id=$1 returning *`,
    [orderId]
  );
  await pool.query(
    'insert into order_status_logs(order_id, from_status, to_status, actor_id, actor_role) values ($1,$2,$3,$4,$5)',
    [orderId, order.status, ORDER_STATUS.IN_SERVICE, profileId, actorRole]
  );
  await pool.query(
    'insert into service_logs(order_id, event_type, actor_id, actor_role) values ($1,$2,$3,$4)',
    [orderId, 'START', profileId, actorRole]
  );
  const enriched = await fetchOrder(pool, rows[0].id);
  return ok(reply, enriched ?? rows[0]);
}

async function handleEnd(pool, req, reply, actor, orderId) {
  const profileId = await ensureProfile(pool, actor.userId);
  const order = await fetchOrder(pool, orderId);
  if (!order) return error(reply, 'NOT_FOUND', 'Order not found', 404);
  authorize({ ...actor, profileId }, 'orders:end', { hostId: order.host_id, travelerId: order.traveler_id });
  if (actor.role === 'host') {
    await requireApprovedHost(pool, actor.userId);
  }
  if (order.status !== ORDER_STATUS.IN_SERVICE) {
    return error(reply, 'INVALID_STATUS_TRANSITION', 'Order not in service', 400);
  }
  const actorRole = order.host_id === profileId ? 'HOST' : 'TRAVELER';
  const { rows } = await pool.query(
    `update orders set status='COMPLETED', completed_at=now() where id=$1 returning *`,
    [orderId]
  );
  await pool.query(
    'insert into order_status_logs(order_id, from_status, to_status, actor_id, actor_role) values ($1,$2,$3,$4,$5)',
    [orderId, order.status, ORDER_STATUS.COMPLETED, profileId, actorRole]
  );
  await pool.query(
    'insert into service_logs(order_id, event_type, actor_id, actor_role) values ($1,$2,$3,$4)',
    [orderId, 'END', profileId, actorRole]
  );
  const enriched = await fetchOrder(pool, rows[0].id);
  return ok(reply, enriched ?? rows[0]);
}

async function handleReview(pool, req, reply, actor, orderId) {
  const profileId = await ensureProfile(pool, actor.userId);
  const order = await fetchOrder(pool, orderId);
  if (!order) return error(reply, 'NOT_FOUND', 'Order not found', 404);
  authorize(
    { ...actor, profileId },
    'orders:review',
    { travelerId: order.traveler_id, hostId: order.host_id }
  );
  if (order.status !== ORDER_STATUS.COMPLETED) {
    return error(reply, 'INVALID_STATUS_TRANSITION', 'Order not completed', 400);
  }
  const { rating, comment = null } = req.body || {};
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return error(reply, 'INVALID_INPUT', 'rating must be 1-5', 400);
  }
  let fromRole = null;
  let toRole = null;
  let toUserId = null;
  if (profileId === order.traveler_id) {
    fromRole = REVIEW_ROLE.TRAVELER;
    toRole = REVIEW_ROLE.HOST;
    toUserId = order.host_id;
  } else if (profileId === order.host_id) {
    fromRole = REVIEW_ROLE.HOST;
    toRole = REVIEW_ROLE.TRAVELER;
    toUserId = order.traveler_id;
  } else {
    return error(reply, 'FORBIDDEN', 'No access to order', 403);
  }
  const { rows: existing } = await pool.query(
    'select id from reviews where order_id = $1 and from_user_id = $2 limit 1',
    [orderId, profileId]
  );
  if (existing[0]) return error(reply, 'DUPLICATE', 'Review already exists', 400);
  await pool.query(
    `insert into reviews
      (order_id, from_user_id, to_user_id, rating, comment, from_role, to_role)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [orderId, profileId, toUserId, rating, comment, fromRole, toRole]
  );
  return ok(reply, { orderId, rating, comment, fromRole });
}

async function handleExperienceReviewSummary(pool, req, reply, actor, experienceId) {
  if (!experienceId || String(experienceId).trim().length === 0) {
    return error(reply, 'INVALID_INPUT', 'experienceId is required', 400);
  }
  const { rows } = await pool.query(
    `select
        count(*)::int as review_count,
        coalesce(avg(r.rating), 0) as avg_rating
     from reviews r
     join orders o on o.id = r.order_id
     where o.experience_id = $1
       and o.status = $2
       and (r.from_role = $3 or r.from_user_id = o.traveler_id)
       and (
         exists (
           select 1 from reviews r2
           where r2.order_id = o.id
             and (r2.from_role = $4 or r2.from_user_id = o.host_id)
         )
         or (o.completed_at is not null and o.completed_at + interval '14 days' <= now())
       )`,
    [experienceId, ORDER_STATUS.COMPLETED, REVIEW_ROLE.TRAVELER, REVIEW_ROLE.HOST]
  );
  const row = rows[0] || { review_count: 0, avg_rating: 0 };
  return ok(reply, {
    experienceId,
    reviewCount: Number(row.review_count) || 0,
    rating: Number(row.avg_rating) || 0,
  });
}

async function handleMyOrders(pool, req, reply, actor, statusFilter) {
  const profileId = await ensureProfile(pool, actor.userId);
  const params = [profileId];
  let sql =
    `select o.id, o.order_no, o.experience_id, o.host_id, o.traveler_id, o.start_time, o.status, o.payment_status,
            o.payment_method, o.payment_provider, o.payment_intent_id, o.paid_at, o.completed_at,
            o.total_amount, o.currency, o.created_at, o.conversation_id, o.experience_title,
            o.experience_cover, o.city, o.meeting_point, o.language_preference, o.time_slot_label,
            o.tags, o.traveler_name, o.traveler_avatar, o.host_name, o.host_avatar, o.contact_phone,
            o.channel, o.visible_to_traveler, o.visible_to_host, o.refund_status, o.refund_at,
            host_profile.id as "hostUserId",
            host_profile.nickname as "host_nickname",
            traveler_profile.id as "travelerUserId",
            traveler_profile.nickname as "traveler_nickname",
            exists(
              select 1 from reviews r
              where r.order_id = o.id and r.from_user_id = o.traveler_id
            ) as traveler_reviewed,
            exists(
              select 1 from reviews r
              where r.order_id = o.id and r.from_user_id = o.host_id
            ) as host_reviewed
     from orders o
     left join profiles host_profile on host_profile.id = o.host_id
     left join profiles traveler_profile on traveler_profile.id = o.traveler_id
     where o.traveler_id = $1`;
  if (statusFilter) {
    params.push(statusFilter);
    sql += ' and status = $2';
  }
  sql += ' order by created_at desc';
  const { rows } = await pool.query(sql, params);
  const payload = rows.map((row) => toOrderReadModel(attachReviewStatus(row)));
  return ok(reply, payload);
}

async function handleHostOrders(pool, req, reply, actor, statusFilter) {
  const profileId = await ensureProfile(pool, actor.userId);
  const params = [profileId, actor.userId];
  let sql =
    `select o.id, o.order_no, o.experience_id, o.traveler_id, o.host_id, o.start_time, o.status, o.payment_status,
            o.payment_method, o.payment_provider, o.payment_intent_id, o.paid_at, o.completed_at,
            o.total_amount, o.currency, o.created_at, o.conversation_id, o.experience_title,
            o.experience_cover, o.city, o.meeting_point, o.language_preference, o.time_slot_label,
            o.tags, o.traveler_name, o.traveler_avatar, o.host_name, o.host_avatar, o.contact_phone,
            o.channel, o.visible_to_traveler, o.visible_to_host, o.refund_status, o.refund_at,
            host_profile.id as "hostUserId",
            host_profile.nickname as "host_nickname",
            traveler_profile.id as "travelerUserId",
            traveler_profile.nickname as "traveler_nickname",
            exists(
              select 1 from reviews r
              where r.order_id = o.id and r.from_user_id = o.traveler_id
            ) as traveler_reviewed,
            exists(
              select 1 from reviews r
              where r.order_id = o.id and r.from_user_id = o.host_id
            ) as host_reviewed
     from orders o
     left join profiles host_profile on host_profile.id = o.host_id
     left join profiles traveler_profile on traveler_profile.id = o.traveler_id
     where o.host_id = $1 or o.host_id = $2`;
  if (statusFilter) {
    params.push(statusFilter);
    sql += ' and status = $3';
  }
  sql += ' order by created_at desc';
  const { rows } = await pool.query(sql, params);
  const payload = rows.map((row) => toOrderReadModel(attachReviewStatus(row)));
  return ok(reply, payload);
}

async function handleDetail(pool, req, reply, actor, orderId) {
  const profileId = await ensureProfile(pool, actor.userId);
  const orderRow = await fetchOrder(pool, orderId);
  if (!orderRow) return error(reply, 'NOT_FOUND', 'Order not found', 404);
  authorize(
    { ...actor, profileId },
    'orders:detail',
    { hostId: orderRow.host_id, travelerId: orderRow.traveler_id }
  );
  const { rows: logs } = await pool.query(
    'select * from service_logs where order_id = $1 order by created_at asc',
    [orderId]
  );
  const { rows: reviewRows } = await pool.query(
    'select * from reviews where order_id = $1 order by created_at asc',
    [orderId]
  );
  let travelerReview = null;
  let hostReview = null;
  for (const row of reviewRows) {
    const role = resolveReviewRole(row, orderRow);
    if (role === REVIEW_ROLE.TRAVELER) travelerReview = serializeReview(row, orderRow);
    if (role === REVIEW_ROLE.HOST) hostReview = serializeReview(row, orderRow);
  }
  const reviewsPayload = {
    visible: orderRow.review_visible,
    reveal_at: orderRow.review_reveal_at,
    traveler_reviewed: orderRow.traveler_reviewed,
    host_reviewed: orderRow.host_reviewed,
    traveler: orderRow.review_visible ? travelerReview : null,
    host: orderRow.review_visible ? hostReview : null,
  };
  return ok(reply, {
    order: toOrderReadModel(orderRow),
    serviceLogs: logs,
    reviews: reviewsPayload,
    review: orderRow.review_visible ? travelerReview : null,
  });
}

export default async function ordersRoutes(app) {
  const pool = app.pg.pool;

  app.all('/functions/v1/orders', async (req, reply) => {
    let actor = null;
    try {
      actor = await requireAuth(req, reply);
    } catch (err) {
      if (respondAuthError(err, reply)) return;
      throw err;
    }
    const url = parsePath(req);
    const pathname = url.pathname.startsWith('/orders')
      ? url.pathname.replace(/^\/orders/, '') || '/'
      : url.pathname;
    const status = url.searchParams.get('status');

    try {
      if (req.method === 'POST' && pathname === '/create') {
        return await handleCreate(pool, req, reply, actor);
      }
      if (req.method === 'POST' && /^\/\d+\/mark_paid$/.test(pathname)) {
        const id = Number(pathname.split('/')[1]);
        return await handleMarkPaid(pool, req, reply, actor, id);
      }
      if (req.method === 'POST' && /^\/\d+\/accept$/.test(pathname)) {
        const id = Number(pathname.split('/')[1]);
        return await handleAccept(pool, req, reply, actor, id);
      }
      if (req.method === 'POST' && /^\/\d+\/reject$/.test(pathname)) {
        const id = Number(pathname.split('/')[1]);
        return await handleReject(pool, req, reply, actor, id);
      }
      if (req.method === 'POST' && /^\/\d+\/cancel$/.test(pathname)) {
        const id = Number(pathname.split('/')[1]);
        return await handleCancel(pool, req, reply, actor, id);
      }
      if (req.method === 'POST' && /^\/\d+\/start$/.test(pathname)) {
        const id = Number(pathname.split('/')[1]);
        return await handleStart(pool, req, reply, actor, id);
      }
      if (req.method === 'POST' && /^\/\d+\/end$/.test(pathname)) {
        const id = Number(pathname.split('/')[1]);
        return await handleEnd(pool, req, reply, actor, id);
      }
      if (req.method === 'POST' && /^\/\d+\/review$/.test(pathname)) {
        const id = Number(pathname.split('/')[1]);
        return await handleReview(pool, req, reply, actor, id);
      }
      if (req.method === 'GET' && /^\/experience\/[^/]+\/reviews_summary$/.test(pathname)) {
        const experienceId = decodeURIComponent(pathname.split('/')[2]);
        return await handleExperienceReviewSummary(pool, req, reply, actor, experienceId);
      }
      if (req.method === 'GET' && pathname === '/my') {
        return await handleMyOrders(pool, req, reply, actor, status);
      }
      if (req.method === 'GET' && pathname === '/host/orders') {
        return await handleHostOrders(pool, req, reply, actor, status);
      }
      if (req.method === 'GET' && /^\/\d+$/.test(pathname)) {
        const id = Number(pathname.slice(1));
        return await handleDetail(pool, req, reply, actor, id);
      }

      return error(reply, 'NOT_FOUND', 'Unknown route', 404);
    } catch (err) {
      if (err?.statusCode) {
        return error(reply, err.code || 'FORBIDDEN', err.message, err.statusCode);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Orders handler error', 500);
    }
  });
}

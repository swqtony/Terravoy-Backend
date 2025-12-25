import { requireAuth, respondAuthError } from '../services/authService.js';
import { authorize } from '../services/authorize.js';
import { ok, error } from '../utils/responses.js';

const ORDER_STATUS = {
  PENDING: 'PENDING_HOST_CONFIRM',
  CONFIRMED: 'CONFIRMED',
  IN_SERVICE: 'IN_SERVICE',
  COMPLETED: 'COMPLETED',
  CANCELLED_REFUNDED: 'CANCELLED_REFUNDED',
  CANCELLED_BY_TRAVELER: 'CANCELLED_BY_TRAVELER',
};

function requireLeancloudUserId(leancloudUserId) {
  if (!leancloudUserId || String(leancloudUserId).trim().length === 0) {
    const err = new Error('leancloudUserId is required');
    err.code = 'LEAN_USER_ID_REQUIRED';
    err.statusCode = 400;
    throw err;
  }
  return String(leancloudUserId).trim();
}

async function ensureProfile(pool, leancloudUserId) {
  const validated = requireLeancloudUserId(leancloudUserId);
  const { rows } = await pool.query(
    'select ensure_profile_v2($1, $2) as id',
    [validated, null]
  );
  return rows[0]?.id;
}

async function fetchOrder(pool, orderId) {
  const { rows } = await pool.query(
    `select o.*,
            host_profile.leancloud_user_id as "hostLeancloudUserId",
            traveler_profile.leancloud_user_id as "travelerLeancloudUserId"
     from orders o
     left join profiles host_profile on host_profile.id = o.host_id
     left join profiles traveler_profile on traveler_profile.id = o.traveler_id
     where o.id = $1`,
    [orderId]
  );
  return rows[0] || null;
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
  } = body;
  if (!experienceId || !hostId || !startTime || !endTime || !peopleCount || !totalAmount) {
    return error(reply, 'INVALID_INPUT', 'Missing required fields', 400);
  }
  const profileId = await ensureProfile(pool, actor.userId);
  authorize({ ...actor, profileId }, 'orders:create');

  const { rows: existingRows } = await pool.query(
    `select * from orders
     where traveler_id = $1 and host_id = $2 and experience_id = $3 and start_time = $4
     order by created_at desc limit 1`,
    [profileId, hostId, experienceId, startTime]
  );
  if (existingRows[0]) return ok(reply, existingRows[0]);

  const orderNo = `ORD${Date.now()}${Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, '0')}`;
  const { rows } = await pool.query(
    `insert into orders
    (order_no, traveler_id, host_id, experience_id, start_time, end_time, people_count,
     status, payment_status, total_amount, currency, traveler_note, paid_at)
     values ($1,$2,$3,$4,$5,$6,$7,'PENDING_HOST_CONFIRM','PAID',$8,$9,$10, now())
     returning *`,
    [
      orderNo,
      profileId,
      hostId,
      experienceId,
      startTime,
      endTime,
      peopleCount,
      totalAmount,
      currency,
      travelerNote,
    ]
  );
  const order = rows[0];
  await pool.query(
    'insert into order_status_logs(order_id, from_status, to_status, actor_id, actor_role) values ($1,$2,$3,$4,$5)',
    [order.id, null, order.status, profileId, 'TRAVELER']
  );
  const enriched = await fetchOrder(pool, order.id);
  return ok(reply, enriched ?? order, 201);
}

async function handleMarkPaid(pool, req, reply, actor, orderId) {
  const profileId = await ensureProfile(pool, actor.userId);
  authorize({ ...actor, profileId }, 'orders:review', { travelerId: profileId });
  const order = await fetchOrder(pool, orderId);
  if (!order) return error(reply, 'NOT_FOUND', 'Order not found', 404);
  if (order.payment_status !== 'UNPAID') {
    return error(reply, 'INVALID_STATUS_TRANSITION', 'Order already paid', 400);
  }
  if (order.traveler_id !== profileId) {
    return error(reply, 'FORBIDDEN', 'Only traveler can mark paid', 403);
  }
  const { rows } = await pool.query(
    `update orders set payment_status='PAID', status='PENDING_HOST_CONFIRM', paid_at = now()
     where id = $1 returning *`,
    [orderId]
  );
  await pool.query(
    'insert into order_status_logs(order_id, from_status, to_status, actor_id, actor_role) values ($1,$2,$3,$4,$5)',
    [orderId, order.status, 'PENDING_HOST_CONFIRM', profileId, 'TRAVELER']
  );
  const enriched = await fetchOrder(pool, rows[0].id);
  return ok(reply, enriched ?? rows[0]);
}

async function handleAccept(pool, req, reply, actor, orderId) {
  const profileId = await ensureProfile(pool, actor.userId);
  const order = await fetchOrder(pool, orderId);
  if (!order) return error(reply, 'NOT_FOUND', 'Order not found', 404);
  authorize({ ...actor, profileId }, 'orders:accept', { hostId: order.host_id });
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
  if (order.status !== ORDER_STATUS.PENDING) {
    return error(reply, 'INVALID_STATUS_TRANSITION', 'Order not pending host confirm', 400);
  }
  const reason = (req.body || {}).reason || null;
  const { rows } = await pool.query(
    `update orders set status='CANCELLED_REFUNDED', payment_status='REFUNDED',
     cancelled_at=now(), cancelled_by='HOST', cancelled_reason=$2 where id=$1 returning *`,
    [orderId, reason]
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
  const { rows } = await pool.query(
    `update orders set status='CANCELLED_BY_TRAVELER', payment_status='REFUNDED',
     cancelled_at=now(), cancelled_by='TRAVELER', cancelled_reason=$2 where id=$1 returning *`,
    [orderId, reason]
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
  authorize({ ...actor, profileId }, 'orders:review', { travelerId: order.traveler_id });
  if (order.status !== ORDER_STATUS.COMPLETED) {
    return error(reply, 'INVALID_STATUS_TRANSITION', 'Order not completed', 400);
  }
  const { rating, comment = null } = req.body || {};
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return error(reply, 'INVALID_INPUT', 'rating must be 1-5', 400);
  }
  const { rows: existing } = await pool.query(
    'select id from reviews where order_id = $1 limit 1',
    [orderId]
  );
  if (existing[0]) return error(reply, 'DUPLICATE', 'Review already exists', 400);
  await pool.query(
    'insert into reviews(order_id, from_user_id, to_user_id, rating, comment) values ($1,$2,$3,$4,$5)',
    [orderId, profileId, order.host_id, rating, comment]
  );
  return ok(reply, { orderId, rating, comment });
}

async function handleMyOrders(pool, req, reply, actor, statusFilter) {
  const profileId = await ensureProfile(pool, actor.userId);
  const params = [profileId];
  let sql =
    `select o.id, o.experience_id, o.host_id, o.start_time, o.status, o.total_amount, o.currency, o.created_at,
            host_profile.leancloud_user_id as "hostLeancloudUserId",
            traveler_profile.leancloud_user_id as "travelerLeancloudUserId"
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
  return ok(reply, rows);
}

async function handleHostOrders(pool, req, reply, actor, statusFilter) {
  const profileId = await ensureProfile(pool, actor.userId);
  const params = [profileId];
  let sql =
    `select o.id, o.experience_id, o.traveler_id, o.start_time, o.status, o.total_amount, o.currency, o.created_at,
            host_profile.leancloud_user_id as "hostLeancloudUserId",
            traveler_profile.leancloud_user_id as "travelerLeancloudUserId"
     from orders o
     left join profiles host_profile on host_profile.id = o.host_id
     left join profiles traveler_profile on traveler_profile.id = o.traveler_id
     where o.host_id = $1`;
  if (statusFilter) {
    params.push(statusFilter);
    sql += ' and status = $2';
  }
  sql += ' order by created_at desc';
  const { rows } = await pool.query(sql, params);
  return ok(reply, rows);
}

async function handleDetail(pool, req, reply, actor, orderId) {
  const profileId = await ensureProfile(pool, actor.userId);
  const order = await fetchOrder(pool, orderId);
  if (!order) return error(reply, 'NOT_FOUND', 'Order not found', 404);
  authorize({ ...actor, profileId }, 'orders:detail', { hostId: order.host_id, travelerId: order.traveler_id });
  const { rows: logs } = await pool.query(
    'select * from service_logs where order_id = $1 order by created_at asc',
    [orderId]
  );
  const { rows: review } = await pool.query(
    'select * from reviews where order_id = $1 limit 1',
    [orderId]
  );
  return ok(reply, { order, serviceLogs: logs, review: review[0] || null });
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

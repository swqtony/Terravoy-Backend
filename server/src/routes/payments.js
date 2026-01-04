import { requireAuth, respondAuthError } from '../services/authService.js';
import { authorize } from '../services/authorize.js';
import { ok, error } from '../utils/responses.js';
import { initPaymentsService } from '../services/payments/index.js';
import { WebhookEventTypes } from '../services/payments/providerInterface.js';
import { config } from '../config.js';

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
    'select * from orders where id = $1',
    [orderId]
  );
  return rows[0] || null;
}

async function fetchIntent(pool, intentId) {
  const { rows } = await pool.query(
    'select * from payment_intents where id = $1',
    [intentId]
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
  return new URL(`http://local${req.url.replace('/functions/v1/payments', '') || '/'}`);
}

function normalizeAmount(value) {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return Number(num.toFixed(2));
}

async function processSyncEvent(pool, paymentsService, event, logger) {
  const payload = { ...event.data, _originalCreatedAt: event.createdAt };
  const { rows } = await pool.query(
    `insert into webhook_events
     (provider, event_id, event_type, payload, status, received_at)
     values ($1,$2,$3,$4,'received', now())
     on conflict (provider, event_id) do nothing
     returning id`,
    [event.provider, event.eventId, event.type, JSON.stringify(payload)]
  );
  const webhookEventId = rows[0]?.id;
  if (!webhookEventId) {
    return;
  }
  try {
    await paymentsService.eventProcessor.processEvent(event, webhookEventId);
    await pool.query(
      `update webhook_events set status='processed', processed_at=now() where id=$1`,
      [webhookEventId]
    );
    logger?.info?.({
      event: 'payments.sync.processed',
      provider: event.provider,
      eventId: event.eventId,
      type: event.type,
    });
  } catch (err) {
    await pool.query(
      `update webhook_events set status='failed', processed_at=now(), last_error=$2 where id=$1`,
      [webhookEventId, err.message]
    );
    logger?.error?.(err, 'Sync event processing failed');
  }
}

async function handleCreateIntent(pool, req, reply, actor, paymentsService) {
  const body = req.body || {};
  const orderId = Number(body.orderId);
  const requestedAmount = normalizeAmount(body.amount);
  const currency = body.currency || 'CNY';
  const idempotencyKey = body.idempotencyKey || null;
  const metadata = body.metadata || {};

  if (!orderId || !requestedAmount) {
    return error(reply, 'INVALID_INPUT', 'orderId/amount required', 400);
  }

  const profileId = await ensureProfile(pool, actor.userId);
  const order = await fetchOrder(pool, orderId);
  if (!order) return error(reply, 'NOT_FOUND', 'Order not found', 404);

  authorize({ ...actor, profileId }, 'payments:create', { travelerId: order.traveler_id });

  if (order.traveler_id !== profileId) {
    return error(reply, 'FORBIDDEN', 'Only traveler can pay', 403);
  }
  if (order.payment_status !== 'UNPAID') {
    return error(reply, 'INVALID_STATUS_TRANSITION', 'Order already paid', 400);
  }
  if (order.status === 'CANCELLED_REFUNDED' || order.status === 'CANCELLED_BY_TRAVELER' || order.status === 'COMPLETED') {
    return error(reply, 'INVALID_STATUS_TRANSITION', 'Order is not payable', 400);
  }

  const orderAmount = normalizeAmount(order.total_amount);
  if (orderAmount !== null && orderAmount !== requestedAmount) {
    return error(reply, 'PRICE_MISMATCH', 'Order amount mismatch', 409, { orderAmount });
  }

  const { rows: activeIntents } = await pool.query(
    `select * from payment_intents
     where order_id = $1 and status in ('requires_confirmation', 'created')
     order by created_at desc limit 1`,
    [orderId]
  );
  if (activeIntents.length > 0) {
    const intent = activeIntents[0];
    return ok(reply, {
      intentId: intent.id,
      providerIntentId: intent.provider_intent_id,
      status: intent.status,
      amount: Number(intent.amount),
      currency: intent.currency,
      clientSecret: intent.client_secret,
    });
  }

  // Use the active provider
  const provider = paymentsService.getActiveProvider();

  // Create intent with provider
  const result = await provider.createIntent({
    amount: requestedAmount,
    currency,
    idempotencyKey,
    metadata: { ...metadata, orderId, travelerId: profileId },
  });

  // Persist intent (fallback to existing if concurrent request wins)
  let rows = [];
  try {
    const insert = await pool.query(
      `insert into payment_intents
       (order_id, provider, provider_intent_id, amount, currency, status, idempotency_key, client_secret, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning *`,
      [
        orderId,
        provider.name,
        result.providerIntentId,
        requestedAmount,
        currency,
        result.status, // requires_confirmation
        idempotencyKey,
        result.clientSecret,
        JSON.stringify(metadata),
      ]
    );
    rows = insert.rows;
  } catch (err) {
    if (err?.code === '23505') {
      const { rows: existing } = await pool.query(
        `select * from payment_intents
         where order_id = $1 and status in ('requires_confirmation', 'created')
         order by created_at desc limit 1`,
        [orderId]
      );
      rows = existing;
    } else {
      throw err;
    }
  }

  const intent = rows[0];
  await pool.query(
    'update orders set payment_intent_id = $1 where id = $2',
    [intent.id, orderId]
  );

  return ok(reply, {
    intentId: intent.id,
    providerIntentId: intent.provider_intent_id,
    status: intent.status,
    amount: intent.amount,
    currency: intent.currency,
    clientSecret: intent.client_secret,
  }, 201);
}

async function handleConfirm(pool, req, reply, actor, paymentsService) {
  const body = req.body || {};
  const intentId = Number(body.intentId);
  // Optional params for mock/testing
  const simulate = body.simulate || null;
  const paymentMethod = body.method || null;
  const webhookOnly = config.flags.paymentsWebhookOnly;

  if (!intentId) {
    return error(reply, 'INVALID_INPUT', 'intentId required', 400);
  }

  const profileId = await ensureProfile(pool, actor.userId);
  const intent = await fetchIntent(pool, intentId);
  if (!intent) return error(reply, 'NOT_FOUND', 'Payment intent not found', 404);

  const order = await fetchOrder(pool, intent.order_id);
  if (!order) return error(reply, 'NOT_FOUND', 'Order not found', 404);

  authorize({ ...actor, profileId }, 'payments:confirm', { travelerId: order.traveler_id });

  if (order.traveler_id !== profileId) {
    return error(reply, 'FORBIDDEN', 'Only traveler can confirm payment', 403);
  }

  // If already successful, return success
  if (intent.status === 'succeeded' || order.payment_status === 'PAID') {
    return ok(reply, {
      intentId: intent.id,
      status: 'succeeded',
      paidAt: order.paid_at,
    });
  }

  const provider = paymentsService.getProvider(intent.provider) || paymentsService.getActiveProvider();

  // Call provider confirm
  // For webhook-first, this returns 'processing' and triggers async webhook
  const result = await provider.confirmIntent({
    providerIntentId: intent.provider_intent_id,
    idempotencyKey: body.idempotencyKey, // Optional confirming idempotency
    paymentMethod,
    simulate, // For mock provider
  });

  // Record payment attempt (processing or immediate result).
  await pool.query(
    `insert into payment_attempts
     (order_id, intent_id, provider, status, amount, currency, idempotency_key, actor_id, actor_role, actor_ip, raw_payload)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (intent_id, idempotency_key) where idempotency_key is not null do nothing`,
    [
      order.id,
      intent.id,
      provider.name,
      result.status,
      intent.amount,
      intent.currency,
      body.idempotencyKey || null,
      profileId,
      actor.role,
      req.ip || null,
      JSON.stringify({ request: body, result }),
    ]
  );

  const mockDesiredStatus = provider.name === 'mock'
    ? (simulate === 'failed' ? 'failed' : simulate === 'requires_action' ? 'requires_action' : 'succeeded')
    : null;

  if (mockDesiredStatus && mockDesiredStatus !== 'requires_action') {
    const event = {
      eventId: `sync_${intent.id}_${Date.now()}`,
      type: mockDesiredStatus === 'succeeded'
        ? WebhookEventTypes.PAYMENT_SUCCEEDED
        : WebhookEventTypes.PAYMENT_FAILED,
      provider: provider.name,
      createdAt: new Date().toISOString(),
      data: {
        providerIntentId: intent.provider_intent_id,
        providerTxnId: result.providerTxnId || null,
        amount: intent.amount,
        currency: intent.currency,
        status: mockDesiredStatus,
        ...(mockDesiredStatus === 'failed' && {
          errorCode: result.errorCode || 'MOCK_DECLINED',
          errorMessage: result.errorMessage || 'Payment failed',
        }),
      },
    };
    await processSyncEvent(pool, paymentsService, event, req.log);
  } else if (!webhookOnly && (result.status === 'succeeded' || result.status === 'failed')) {
    const event = {
      eventId: `sync_${intent.id}_${Date.now()}`,
      type: result.status === 'succeeded'
        ? WebhookEventTypes.PAYMENT_SUCCEEDED
        : WebhookEventTypes.PAYMENT_FAILED,
      provider: provider.name,
      createdAt: new Date().toISOString(),
      data: {
        providerIntentId: intent.provider_intent_id,
        providerTxnId: result.providerTxnId || null,
        amount: intent.amount,
        currency: intent.currency,
        status: result.status,
        ...(result.status === 'failed' && {
          errorCode: result.errorCode || 'SYNC_FAILED',
          errorMessage: result.errorMessage || 'Payment failed',
        }),
      },
    };
    await processSyncEvent(pool, paymentsService, event, req.log);
  }

  // Update intent status to match provider's immediate response (usually processing)
  const normalizedStatus = mockDesiredStatus && mockDesiredStatus !== 'requires_action'
    ? mockDesiredStatus
    : webhookOnly && (result.status === 'succeeded' || result.status === 'failed')
      ? 'processing'
      : result.status;
  await pool.query(
    'update payment_intents set status=$1, updated_at=now() where id=$2',
    [normalizedStatus, intent.id]
  );

  // Return the status. Frontend should poll or wait for webhook result via socket/status endpoint
  return ok(reply, {
    intentId: intent.id,
    status: normalizedStatus, // e.g. 'processing'
    actionData: result.actionData,
  });
}

async function handleRefund(pool, req, reply, actor, paymentsService) {
  const body = req.body || {};
  const orderId = Number(body.orderId);
  const amount = normalizeAmount(body.amount); // Optional, partial refund
  const reason = body.reason || 'requested_by_user';
  const idempotencyKey = body.idempotencyKey || null;
  const webhookOnly = config.flags.paymentsWebhookOnly;

  if (!orderId) {
    return error(reply, 'INVALID_INPUT', 'orderId required', 400);
  }

  const profileId = await ensureProfile(pool, actor.userId);
  const order = await fetchOrder(pool, orderId);
  if (!order) return error(reply, 'NOT_FOUND', 'Order not found', 404);

  // Authorize: Host can refund, or admin
  authorize({ ...actor, profileId }, 'payments:refund', { hostId: order.host_id });

  // Check state
  if (order.payment_status !== 'PAID' && order.payment_status !== 'REFUNDED') { // Allow multiple refunds?
    return error(reply, 'INVALID_STATUS', 'Order not paid', 400);
  }

  // Get successful payment record
  const { rows: payments } = await pool.query(
    `select * from payments where order_id = $1 and status = 'succeeded' order by created_at desc limit 1`,
    [orderId]
  );
  const payment = payments[0];
  if (!payment) {
    return error(reply, 'INVALID_STATE', 'No successful payment found', 400);
  }

  const refundAmount = amount || Number(payment.amount);

  // 1. Create refund record (requested)
  const { rows: refundRows } = await pool.query(
    `insert into refunds
     (order_id, payment_id, intent_id, provider, status, amount, currency, reason, idempotency_key, requested_by, requested_role)
     values ($1,$2,$3,$4,'requested',$5,$6,$7,$8,$9,$10)
     returning *`,
    [
      orderId,
      payment.id,
      payment.intent_id,
      payment.provider,
      refundAmount,
      payment.currency,
      reason,
      idempotencyKey,
      profileId, // uuid
      actor.role
    ]
  );
  const refundRecord = refundRows[0];

  // 2. Call provider refund
  const provider = paymentsService.getProvider(payment.provider);
  const result = await provider.refund({
    providerTxnId: payment.provider_txn_id,
    amount: refundAmount,
    currency: payment.currency,
    idempotencyKey: idempotencyKey || `refund_${refundRecord.id}`,
    reason,
  });

  // 3. Update status (processing)
  const normalizedStatus = webhookOnly && (result.status === 'succeeded' || result.status === 'failed')
    ? 'processing'
    : result.status;
  await pool.query(
    `update refunds set status=$1, provider_refund_id=$2, updated_at=now() where id=$3`,
    [normalizedStatus, result.providerRefundId, refundRecord.id]
  );

  if (!webhookOnly && (result.status === 'succeeded' || result.status === 'failed')) {
    const event = {
      eventId: `sync_refund_${refundRecord.id}_${Date.now()}`,
      type: result.status === 'succeeded'
        ? WebhookEventTypes.REFUND_SUCCEEDED
        : WebhookEventTypes.REFUND_FAILED,
      provider: payment.provider,
      createdAt: new Date().toISOString(),
      data: {
        providerRefundId: result.providerRefundId || null,
        providerTxnId: payment.provider_txn_id,
        amount: refundAmount,
        currency: payment.currency,
        status: result.status,
        ...(result.status === 'failed' && {
          errorCode: result.errorCode || 'SYNC_REFUND_FAILED',
          errorMessage: result.errorMessage || 'Refund failed',
        }),
      },
    };
    await processSyncEvent(pool, paymentsService, event, req.log);
  }

  // 4. Update order status to REFUNDING
  await pool.query(
    `update orders set refund_status='processing', payment_status='REFUNDING' where id=$1`,
    [orderId]
  );

  return ok(reply, {
    refundId: refundRecord.id,
    status: normalizedStatus,
  });
}

async function handleRefundRetry(pool, req, reply, actor, paymentsService) {
  const body = req.body || {};
  const refundId = Number(body.refundId);
  const idempotencyKey = body.idempotencyKey || null;
  const webhookOnly = config.flags.paymentsWebhookOnly;

  if (!refundId) {
    return error(reply, 'INVALID_INPUT', 'refundId required', 400);
  }

  const { rows: refunds } = await pool.query(
    'select * from refunds where id = $1',
    [refundId]
  );
  const refund = refunds[0];
  if (!refund) {
    return error(reply, 'NOT_FOUND', 'Refund not found', 404);
  }

  const order = await fetchOrder(pool, refund.order_id);
  if (!order) {
    return error(reply, 'NOT_FOUND', 'Order not found', 404);
  }

  const profileId = await ensureProfile(pool, actor.userId);
  authorize({ ...actor, profileId }, 'payments:refund', { hostId: order.host_id });

  if (refund.status === 'succeeded') {
    return ok(reply, { refundId: refund.id, status: refund.status });
  }

  const { rows: payments } = await pool.query(
    'select * from payments where id = $1',
    [refund.payment_id]
  );
  const payment = payments[0];
  if (!payment) {
    return error(reply, 'INVALID_STATE', 'Payment not found for refund', 400);
  }

  const provider = paymentsService.getProvider(refund.provider) || paymentsService.getActiveProvider();
  const result = await provider.refund({
    providerTxnId: payment.provider_txn_id,
    amount: refund.amount,
    currency: refund.currency,
    idempotencyKey: idempotencyKey || `refund_retry_${refund.id}`,
    reason: refund.reason || 'requested_by_user',
  });

  const normalizedStatus = webhookOnly && (result.status === 'succeeded' || result.status === 'failed')
    ? 'processing'
    : result.status;

  await pool.query(
    `update refunds set status=$1, provider_refund_id=$2, last_error=$3, updated_at=now() where id=$4`,
    [normalizedStatus, result.providerRefundId || refund.provider_refund_id, null, refund.id]
  );

  await pool.query(
    `update orders set refund_status='processing', payment_status='REFUNDING' where id=$1`,
    [refund.order_id]
  );

  return ok(reply, { refundId: refund.id, status: normalizedStatus });
}

async function handleWebhook(pool, req, reply, paymentsService) {
  const providerName = req.params.provider || 'mock'; // /webhook/:provider
  const signature = req.headers['x-signature'] || req.headers['stripe-signature'] || '';
  const rawPayload = req.body; // fastify raw body if configured, else parsed body

  // Note: For real providers, we need the raw stream or buffer for signature verification.
  // Assuming req.body is usable or we have middleware to handle it.
  // For mock provider, JSON body is fine.

  const result = await paymentsService.handleWebhook(providerName, rawPayload, signature);

  if (!result.ok) {
    return error(reply, 'WEBHOOK_ERROR', result.error, 400);
  }

  return ok(reply, { received: true, eventId: result.eventId });
}

async function handleGetPayments(pool, req, reply, actor) {
  const url = parsePath(req);
  // Expected path: /orders/:id/payments
  // pathname logic in main handler might strip '/payments', so we need to be careful
  // Let's assume the router passes the ID via regex or parsing
  const matches = url.pathname.match(/\/orders\/(\d+)\/payments/);
  const orderId = matches ? Number(matches[1]) : Number(req.params?.id); // fallback

  if (!orderId) {
    return error(reply, 'INVALID_INPUT', 'Order ID required', 400);
  }

  const profileId = await ensureProfile(pool, actor.userId);
  const order = await fetchOrder(pool, orderId);
  if (!order) return error(reply, 'NOT_FOUND', 'Order not found', 404);

  authorize({ ...actor, profileId }, 'orders:detail', { hostId: order.host_id, travelerId: order.traveler_id });

  const { rows: attempts } = await pool.query(
    'select * from payment_attempts where order_id=$1 order by created_at desc',
    [orderId]
  );
  const { rows: payments } = await pool.query(
    'select * from payments where order_id=$1 order by created_at desc',
    [orderId]
  );
  const { rows: refunds } = await pool.query(
    'select * from refunds where order_id=$1 order by created_at desc',
    [orderId]
  );

  // also fetch intent info
  const { rows: intents } = await pool.query(
    'select * from payment_intents where order_id=$1 order by created_at desc',
    [orderId]
  );

  return ok(reply, {
    intents,
    attempts,
    payments,
    refunds
  });
}

export default async function paymentsRoutes(app) {
  const pool = app.pg.pool;

  // Initialize service layer
  const paymentsService = initPaymentsService({ pool, logger: app.log });

  app.all('/functions/v1/payments', async (req, reply) => {
    // 1. Webhook route (No Auth required usually, or signature auth)
    const url = parsePath(req);
    const pathname = url.pathname.startsWith('/payments')
      ? url.pathname.replace(/^\/payments/, '') || '/'
      : url.pathname;

    try {
      if (req.method === 'POST' && pathname === '/webhook') {
        // Handle default mock webhook
        return await handleWebhook(pool, { ...req, params: { provider: 'mock' } }, reply, paymentsService);
      }

      // 2. Authenticated routes
      let actor = null;
      try {
        actor = await requireAuth(req, reply);
      } catch (err) {
        if (respondAuthError(err, reply)) return;
        throw err;
      }

      if (req.method === 'POST' && pathname === '/create_intent') {
        return await handleCreateIntent(pool, req, reply, actor, paymentsService);
      }
      if (req.method === 'POST' && pathname === '/confirm') {
        return await handleConfirm(pool, req, reply, actor, paymentsService);
      }
      if (req.method === 'POST' && pathname === '/refund') {
        return await handleRefund(pool, req, reply, actor, paymentsService);
      }
      if (req.method === 'POST' && pathname === '/refund/retry') {
        return await handleRefundRetry(pool, req, reply, actor, paymentsService);
      }

      // GET /orders/:id/payments 
      // This might be routed differently if it was strictly REST, but sticking to this handler:
      if (req.method === 'GET' && /^\/orders\/\d+\/payments$/.test(pathname)) {
        return await handleGetPayments(pool, req, reply, actor);
      }

      return error(reply, 'NOT_FOUND', 'Unknown route', 404);
    } catch (err) {
      if (err?.statusCode) {
        return error(reply, err.code || 'FORBIDDEN', err.message, err.statusCode);
      }
      req.log.error(err);
      return error(reply, 'SERVER_ERROR', 'Payments handler error', 500);
    }
  });

  // Also support /functions/v1/webhooks/payments for real provider webhooks if needed externally
  app.post('/functions/v1/webhooks/payments/:provider', async (req, reply) => {
    try {
      const result = await paymentsService.handleWebhook(
        req.params.provider,
        req.body,
        req.headers['x-signature'] || req.headers['stripe-signature']// specific headers
      );
      if (!result.ok) {
        return reply.code(400).send({ error: result.error });
      }
      return { received: true };
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: 'Internal Server Error' });
    }
  });
}

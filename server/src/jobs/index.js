import { pool } from '../db/pool.js';
import pino from 'pino';
import { startMatchWorker } from '../workers/match_worker.js';
import { config } from '../config.js';
import {
  replayFailedWebhooks,
  reconcileSucceededPayments,
  cleanupExpiredIntents,
} from './payments.js';

const logger = pino({ transport: { target: 'pino-pretty' } });

function scheduleJob(label, intervalMin, job) {
  if (!Number.isFinite(intervalMin) || intervalMin <= 0) {
    logger.warn({ event: 'jobs.skip', label, intervalMin }, 'Job disabled by config');
    return;
  }
  job();
  setInterval(job, intervalMin * 60 * 1000);
}

async function autoCloseUnconfirmed() {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const client = await pool.connect();
  try {
    const { rows: unpaid } = await client.query(
      `select * from orders where status = 'PENDING_PAYMENT' and created_at < $1`,
      [thirtyMinutesAgo]
    );
    for (const order of unpaid) {
      await client.query(
        `update orders set status='CANCELLED_BY_TRAVELER',
         cancelled_at=now(), cancelled_by='SYSTEM', cancelled_reason='PAYMENT_TIMEOUT'
         where id=$1`,
        [order.id]
      );
      await client.query(
        `insert into order_status_logs(order_id, from_status, to_status, actor_role, reason)
         values ($1,$2,$3,$4,$5)`,
        [order.id, order.status, 'CANCELLED_BY_TRAVELER', 'SYSTEM', 'PAYMENT_TIMEOUT']
      );
    }
    const { rows } = await client.query(
      `select * from orders where status = 'PENDING_HOST_CONFIRM' and created_at < $1`,
      [twelveHoursAgo]
    );
    for (const order of rows) {
      await client.query(
        `update orders set status='CANCELLED_REFUNDED', payment_status='REFUNDED',
         cancelled_at=now(), cancelled_by='SYSTEM', cancelled_reason='AUTO_TIMEOUT'
         where id=$1`,
        [order.id]
      );
      await client.query(
        `insert into order_status_logs(order_id, from_status, to_status, actor_role, reason)
         values ($1,$2,$3,$4,$5)`,
        [order.id, order.status, 'CANCELLED_REFUNDED', 'SYSTEM', 'AUTO_TIMEOUT']
      );
    }
    if (rows.length > 0) {
      logger.info(`Auto-closed ${rows.length} stale orders`);
    }
    if (unpaid.length > 0) {
      logger.info(`Auto-cancelled ${unpaid.length} unpaid orders`);
    }
  } catch (err) {
    logger.error(err, 'Failed auto-close job');
  } finally {
    client.release();
  }
}

export function startJobs() {
  // Run every 10 minutes
  autoCloseUnconfirmed();
  setInterval(autoCloseUnconfirmed, 10 * 60 * 1000);
  startMatchWorker();

  const paymentsLogger = logger.child({ scope: 'payments.jobs' });
  const paymentsConfig = config.payments.jobs;

  // Webhook replay
  scheduleJob('payments.webhook.replay', paymentsConfig.replayIntervalMin, () => {
    replayFailedWebhooks({ pool, logger: paymentsLogger });
  });

  // Reconcile succeeded payments
  scheduleJob('payments.reconcile.succeeded', paymentsConfig.reconcileIntervalMin, () => {
    reconcileSucceededPayments({ pool, logger: paymentsLogger });
  });

  // Cleanup expired intents
  scheduleJob('payments.intent.cleanup', paymentsConfig.cleanupIntervalMin, () => {
    cleanupExpiredIntents({
      pool,
      logger: paymentsLogger,
      cutoffMinutes: paymentsConfig.intentExpireMin,
    });
  });
}

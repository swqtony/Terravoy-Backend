import { pool } from '../db/pool.js';
import pino from 'pino';
import { startMatchWorker } from '../workers/match_worker.js';

const logger = pino({ transport: { target: 'pino-pretty' } });

async function autoCloseUnconfirmed() {
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const client = await pool.connect();
  try {
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
}

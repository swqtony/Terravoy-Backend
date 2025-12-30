const requiredRpcs = [
  'start_match',
  'try_match',
  'get_active_match_request',
  'get_latest_match_session',
  'cancel_match',
  'ensure_profile_v2',
  'update_profile_from_questionnaire',
];

const requiredTables = [
  'profiles',
  'trip_cards',
  'match_requests',
  'match_sessions',
  'orders',
  'order_status_logs',
  'payment_intents',
  'payments',
  'payment_attempts',
  'refunds',
  'webhook_events',
  'service_logs',
  'reviews',
  'settlements',
  'user_preferences',
];

export async function checkDbCapabilities(pool) {
  const client = await pool.connect();
  try {
    const rpcQuery = `
      select proname from pg_proc p
      join pg_namespace n on p.pronamespace = n.oid
      where n.nspname = 'public' and proname = any($1::text[])
    `;
    const rpcRes = await client.query(rpcQuery, [requiredRpcs]);
    const rpcSet = new Set(rpcRes.rows.map((r) => r.proname));
    const missingRpc = requiredRpcs.filter((r) => !rpcSet.has(r));

    const tableQuery = `
      select tablename from pg_tables
      where schemaname='public' and tablename = any($1::text[])
    `;
    const tableRes = await client.query(tableQuery, [requiredTables]);
    const tableSet = new Set(tableRes.rows.map((r) => r.tablename));
    const missingTables = requiredTables.filter((t) => !tableSet.has(t));

    if (missingRpc.length || missingTables.length) {
      const detail = { missingRpc, missingTables };
      console.error('DB capability check failed', detail);
      throw new Error(`Missing DB capabilities: ${JSON.stringify(detail)}`);
    }
    console.log('DB capability check passed');
  } finally {
    client.release();
  }
}

import { Pool } from 'pg';

function buildPoolConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.POSTGRES_HOST || process.env.PGHOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || process.env.PGPORT || 5432),
    user: process.env.POSTGRES_USER || process.env.PGUSER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || '',
    database: process.env.POSTGRES_DB || process.env.PGDATABASE || 'postgres',
  };
}

function safeConfig(config) {
  if (config.connectionString) {
    return { connectionString: '<set>' };
  }
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
  };
}

async function main() {
  const config = buildPoolConfig();
  console.log('[worker-selfcheck] ENABLE_MATCH_WORKER=', process.env.ENABLE_MATCH_WORKER);
  console.log('[worker-selfcheck] DB config=', safeConfig(config));

  const pool = new Pool(config);
  const client = await pool.connect();
  try {
    const countRes = await client.query(
      `select count(*)::int as count
       from match_sessions
       where conversation_id is null
         and status in ('pending', 'matched')`
    );
    const count = countRes.rows[0]?.count ?? 0;
    console.log('[worker-selfcheck] candidates=', count);

    if (count > 0) {
      const rowRes = await client.query(
        `select id, status, request_a_id, request_b_id, created_at
         from match_sessions
         where conversation_id is null
           and status in ('pending', 'matched')
         order by created_at desc
         limit 1`
      );
      console.log('[worker-selfcheck] latest_candidate=', rowRes.rows[0]);
    } else {
      console.log('[worker-selfcheck] latest_candidate=none');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[worker-selfcheck] error', err?.stack || err);
  process.exit(1);
});

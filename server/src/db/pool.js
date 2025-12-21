import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

pool.on('error', (err) => {
  // Log and allow process to crash so orchestrator restarts.
  console.error('Unexpected PG pool error', err);
});

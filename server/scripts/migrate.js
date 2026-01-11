import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const envFile = process.env.MIGRATIONS_ENV_FILE;
if (envFile && envFile.trim()) {
  dotenv.config({ path: envFile.trim() });
} else {
  dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
}
dotenv.config(); // fallback to local .env inside server if present

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsDir = path.resolve(__dirname, '..', 'db', 'migrations');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const baseline = args.has('--baseline');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function run() {
  const { Pool } = pg;
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT) || 5432,
    user: process.env.POSTGRES_USER || 'terravoy',
    password: process.env.POSTGRES_PASSWORD || 'terravoy_dev',
    database: process.env.POSTGRES_DB || 'terravoy',
  });

  const client = await pool.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      );
    `);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const { rows } = await client.query(
      'select filename, checksum from schema_migrations'
    );
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

    const pending = [];
    for (const file of files) {
      const full = path.join(migrationsDir, file);
      const sql = fs.readFileSync(full, 'utf8');
      const checksum = sha256(sql);
      const existing = applied.get(file);
      if (existing && existing !== checksum) {
        throw new Error(
          `Migration checksum mismatch: ${file} (db=${existing}, local=${checksum})`
        );
      }
      if (!existing) {
        pending.push({ file, sql, checksum });
      }
    }

    if (pending.length === 0) {
      console.log('No pending migrations');
      return;
    }

    if (baseline) {
      const { rows: countRows } = await client.query(
        'select count(*)::int as count from schema_migrations'
      );
      const count = countRows[0]?.count ?? 0;
      if (count === 0) {
        for (const item of pending) {
          await client.query(
            'insert into schema_migrations (filename, checksum) values ($1, $2)',
            [item.file, item.checksum]
          );
        }
        console.log(`Baseline applied (${pending.length} migrations recorded)`);
        return;
      }
    }

    if (dryRun) {
      console.log(`Pending migrations (${pending.length}):`);
      for (const item of pending) {
        console.log(`- ${item.file}`);
      }
      return;
    }

    for (const item of pending) {
      console.log(`Applying migration ${item.file}`);
      await client.query(item.sql);
      await client.query(
        'insert into schema_migrations (filename, checksum) values ($1, $2)',
        [item.file, item.checksum]
      );
    }
    console.log('Migrations completed');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed', err);
  process.exit(1);
});

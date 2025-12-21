import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
dotenv.config(); // fallback to local .env inside server if present

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsDir = path.resolve(__dirname, '..', 'db', 'migrations');

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
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const full = path.join(migrationsDir, file);
      const sql = fs.readFileSync(full, 'utf8');
      console.log(`Applying migration ${file}`);
      await client.query(sql);
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

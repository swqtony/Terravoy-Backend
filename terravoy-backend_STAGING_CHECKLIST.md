# terravoy-backend — Staging Checklist

## Repo status
- Path: `/home/swqtony/projects/terravoy-backend`
- Branch: `admin-phase4-backend`
- git status:
  ```text
  ## admin-phase4-backend
  ```

## A1) Runnability / Entry
- Entry: `server/src/app.js:1-93` (Fastify)
  ```text
  83 const start = async () => {
  84   try {
  85     await app.listen({ port: config.port, host: '0.0.0.0' });
  86     app.log.info(`API listening on ${config.port}`);
  87   } catch (err) {
  88     app.log.error(err);
  89     process.exit(1);
  90   }
  91 };
  93 start();
  ```
- Scripts: `server/package.json:5-11`
  ```text
  5 "scripts": {
  6   "start": "node src/app.js",
  7   "dev": "NODE_ENV=development node src/app.js",
  8   "db:migrate": "node scripts/migrate.js",
  9   "contract:test": "node tests/contract_tests.js",
  10  "media:test": "node tests/media_contract_tests.js",
  11  "safety:test": "node tests/safety_report_tests.js"
  ```
  (backend entry is `node src/app.js`.)
- Suggested staging run:
  ```bash
  cd server
  NODE_ENV=staging PORT=3000 node src/app.js
  ```

## A2) Env & Config Loader
- Config loader: `server/src/config.js:1-5`
  ```text
  1 import dotenv from 'dotenv';
  3 dotenv.config({ path: '../.env' });
  4 dotenv.config();
  ```
- Required envs are defined in `server/src/config.js` (see snippets below).

## A3) Hardcoded Endpoints / Defaults
- Localhost defaults (staging must override): `server/src/config.js:7-22`
  ```text
  7  port: Number(process.env.PORT) || 3000,
  9  host: process.env.POSTGRES_HOST || 'localhost',
  16 url: process.env.REDIS_URL || 'redis://localhost:6379/0',
  21 apiBaseUrl: process.env.IM_API_BASE_URL || 'http://localhost:8090',
  ```
- Dev secrets defaults (staging must override): `server/src/config.js:24-56`
  ```text
  24 jwtSecret: process.env.TERRA_JWT_SECRET || 'dev_terra_secret_change_me',
  53 localJwtSecret: process.env.LOCAL_JWT_SECRET || 'dev_local_jwt_secret',
  55 jwtSecret: process.env.AUTH_JWT_SECRET || 'dev_auth_jwt_secret',
  ```
- External avatar default: `server/src/routes/profile.js:6-11`
  ```text
  6 const DEFAULT_AVATAR_URL = 'https://picsum.photos/seed/me/200';
  8 function resolveAvatarUrl(raw) {
  9   const trimmed = typeof raw === 'string' ? raw.trim() : '';
 10   return trimmed || DEFAULT_AVATAR_URL;
  ```

## A4) Secrets / Tracked Env
- Tracked env files: `.env.example` only.
- Local `.env` exists but is not tracked; do not commit or print its contents.

## Backend-specific Checks
- **LeanCloud headers**: no runtime usage in `server/src` (no hits for `x-leancloud` or `LeanCloud`).
- **Health check**: `server/src/routes/health.js:1-2`
  ```text
  1 export default async function healthRoutes(app) {
  2   app.get('/health', async (_req, reply) => reply.send({ ok: true }));
  ```
- **CORS**: currently `origin: true` (permissive)
  - `server/src/app.js:20-23`
  ```text
  20 await app.register(cors, {
  21   origin: true,
  22 });
  ```
- **Migrations**: `db/migrations/*` ordered lexicographically; runner `server/scripts/migrate.js:7-37`
  ```text
   7 dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
  27 const files = fs
  28   .readdirSync(migrationsDir)
  29   .filter((f) => f.endsWith('.sql'))
  30   .sort();
  ```
  Suggested run: `cd server && node scripts/migrate.js`

## P0 Blockers
- None detected in code, assuming staging envs are supplied.

## P1 Fix Soon
- Replace permissive CORS with explicit staging origins.
- Remove dev-default secrets (or fail-fast) to avoid accidental staging misconfig.

## P2 Nice-to-have
- Move picsum default avatar to configurable media base.

## Notes
- Staging template added: `.env.staging.example` (no secrets).

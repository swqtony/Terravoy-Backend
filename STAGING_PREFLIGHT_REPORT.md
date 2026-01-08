# STAGING_PREFLIGHT_REPORT

## 1) Executive Summary
- Staging-ready: **FAIL**
- P0 blockers: **2**
- Reason: Flutter app has a localhost fallback and lacks fail-fast for missing base URLs.

## 2) P0 Blockers (must fix before staging)
1) **Flutter app falls back to localhost for IM base**
   - `lib/services/api/im_conversation_repository_api.dart:825-829`
   ```text
   825 static Uri _normalizeBase(String base) {
   826   var normalized = base.trim();
   827   if (normalized.isEmpty) return Uri.parse('http://localhost/');
   828   if (!normalized.endsWith('/')) normalized = '$normalized/';
   829   return Uri.parse(normalized);
   ```
2) **Flutter app does not fail-fast when BACKEND_BASE_URL is missing**
   - `lib/main.dart:51-55`
   ```text
   51 final backendConfig = BackendConfig.fromEnv();
   52 if (backendConfig.baseUrl.isEmpty) {
   53   debugPrint(
   54       '[backend] BACKEND_BASE_URL is not set; please configure via .env or --dart-define');
   55 }
   ```

## 3) P1 Fix Soon
- Backend CORS is permissive (`origin: true`) and should be restricted to staging origins.
  - `server/src/app.js:20-23`
  ```text
  20 await app.register(cors, {
  21   origin: true,
  22 });
  ```
- Backend config includes dev defaults for secrets and localhost endpoints; add validation/fail-fast for staging.
  - `server/src/config.js:9-56`
  ```text
  9  host: process.env.POSTGRES_HOST || 'localhost',
  16 url: process.env.REDIS_URL || 'redis://localhost:6379/0',
  24 jwtSecret: process.env.TERRA_JWT_SECRET || 'dev_terra_secret_change_me',
  53 localJwtSecret: process.env.LOCAL_JWT_SECRET || 'dev_local_jwt_secret',
  55 jwtSecret: process.env.AUTH_JWT_SECRET || 'dev_auth_jwt_secret',
  ```

## 4) P2 Nice-to-have
- Consolidate external mock assets (picsum/unsplash/dicebear) to a configurable base.
- Add `/health` endpoint for Admin web (optional).

## 5) Repo-by-repo Findings

### TerraVoy (App)
- Env loader is `flutter_dotenv` + `String.fromEnvironment`:
  - `lib/services/local_backend/backend_config.dart:16-35`
  ```text
  16   static BackendConfig fromEnv() {
  17     final envUrl = dotenv.env['BACKEND_BASE_URL'] ?? '';
  18     const defineUrl = String.fromEnvironment('BACKEND_BASE_URL', defaultValue: '');
  21     final envImApi = dotenv.env['IM_API_BASE_URL'] ?? '';
  23     final envImGateway = dotenv.env['IM_GATEWAY_BASE_URL'] ?? '';
  34     imApiBaseUrl: imApi.isNotEmpty ? imApi : url,
  35     imGatewayBaseUrl: imGateway.isNotEmpty ? imGateway : (imApi.isNotEmpty ? imApi : url),
  ```
- `.env` is loaded only in non-release (staging should use `--dart-define`):
  - `lib/main.dart:37-41`
  ```text
  37 Future<void> main() async {
  38   WidgetsFlutterBinding.ensureInitialized();
  39   if (!kReleaseMode) {
  40     await dotenv.load(fileName: ".env");
  41   }
  ```
- `.env` is not packaged as an asset:
  - `pubspec.yaml:32-36`
  ```text
  32 flutter:
  33   generate: true
  34   uses-material-design: true
  35   assets:
  36     - assets/policies/
  ```

### terravoy-backend
- Entry and bind to `0.0.0.0`:
  - `server/src/app.js:83-86`
  ```text
  83 const start = async () => {
  84   try {
  85     await app.listen({ port: config.port, host: '0.0.0.0' });
  86     app.log.info(`API listening on ${config.port}`);
  ```
- Config loader uses dotenv (loads `../.env` first):
  - `server/src/config.js:1-4`
  ```text
  1 import dotenv from 'dotenv';
  3 dotenv.config({ path: '../.env' });
  4 dotenv.config();
  ```
- Health check exists:
  - `server/src/routes/health.js:1-2`
  ```text
  1 export default async function healthRoutes(app) {
  2   app.get('/health', async (_req, reply) => reply.send({ ok: true }));
  ```
- LeanCloud headers not used in runtime (no hits in `server/src`).

### TerraVoy-Admin
- API base is required; app throws if missing:
  - `src/lib/server/adminBff.ts:13-18`
  ```text
  13 export function getAdminApiBase(): string {
  14     const base = process.env.NEXT_PUBLIC_ADMIN_API_BASE;
  15     if (!base) {
  16         throw new Error('NEXT_PUBLIC_ADMIN_API_BASE is not set');
  17     }
  18     return base.replace(/\/$/, '');
  ```
- `.env.local` exists but is untracked; `.gitignore` now ignores `.env`/`.env.*` (templates allowed).

## 6) Cross-Repo Alignment (Staging Contract)
- Suggested staging endpoints:
  - Backend API: `https://api-staging.example.com`
  - Admin Web: `https://admin-staging.example.com`
  - IM API: `https://im-api-staging.example.com`
  - IM Gateway: `wss://im-gw-staging.example.com`
- Alignment notes:
  - App uses `BACKEND_BASE_URL` / `IM_API_BASE_URL` / `IM_GATEWAY_BASE_URL`.
  - Admin uses `NEXT_PUBLIC_ADMIN_API_BASE` and should point to the same backend API host.
  - Backend should allow CORS for admin staging origin.

## 7) Required Env Matrix
| Repo | Var | Required | Example | Where used | Notes |
| --- | --- | --- | --- | --- | --- |
| App | BACKEND_BASE_URL | Yes | https://api-staging.example.com | `lib/services/local_backend/backend_config.dart:17-27` | Must be set via `--dart-define` for staging builds |
| App | PUBLIC_MEDIA_BASE_URL | Yes | https://media-staging.example.com | `lib/services/local_backend/backend_config.dart:19-28` | Used for media URLs |
| App | IM_API_BASE_URL | Yes | https://im-api-staging.example.com | `lib/services/local_backend/backend_config.dart:21-34` | Used for IM API |
| App | IM_GATEWAY_BASE_URL | Yes | wss://im-gw-staging.example.com | `lib/services/local_backend/backend_config.dart:23-35` | Used for IM gateway |
| Backend | NODE_ENV | Yes | staging | `server/src/config.js:115-124` | Controls prod guards |
| Backend | PORT | Yes | 3000 | `server/src/config.js:7` | Server listen port |
| Backend | POSTGRES_* | Yes | staging DB | `server/src/config.js:9-13` | DB connection |
| Backend | REDIS_URL | Yes | redis://staging-redis.example.com:6379/0 | `server/src/config.js:16` | Redis connection |
| Backend | IM_API_BASE_URL | Yes | https://im-api-staging.example.com | `server/src/config.js:21` | IM API base |
| Backend | PUBLIC_MEDIA_BASE_URL | Yes | https://media-staging.example.com | `server/src/config.js:82-85` | Media URLs |
| Backend | TERRA_JWT_SECRET | Yes | change_me | `server/src/config.js:24` | Auth signing |
| Backend | AUTH_JWT_SECRET | Yes | change_me | `server/src/config.js:55` | Auth signing |
| Backend | LOCAL_JWT_SECRET | Yes | change_me | `server/src/config.js:53` | Local JWT signing |
| Backend | ADMIN_JWT_SECRET | Yes | change_me | `server/src/config.js:97` | Required when NODE_ENV=production |
| Admin | NEXT_PUBLIC_ADMIN_API_BASE | Yes | https://api-staging.example.com | `src/lib/server/adminBff.ts:13-18` | Must be set at build time |
| Admin | ADMIN_ACCESS_TOKEN_TTL_MIN | No | 30 | `src/lib/server/adminBff.ts:7` | Defaults to 30 |
| Admin | ADMIN_REFRESH_TOKEN_TTL_DAYS | No | 30 | `src/lib/server/adminBff.ts:8` | Defaults to 30 |

## 8) Deployment Notes (ECS)
- Backend binds to `0.0.0.0` (OK for ECS).
- CORS currently allows any origin; restrict to staging origins.
- Ensure migrations are run via `cd server && node scripts/migrate.js` before app traffic.

## 9) Smoke Tests (no secrets)
```bash
# Backend health
curl -sS https://api-staging.example.com/health

# Admin web (basic reachability)
curl -I https://admin-staging.example.com
```

## PATCH_SUGGESTIONS (no auto-edits)
- App: remove localhost fallback and fail-fast on missing base URLs.
  - Target: `lib/services/api/im_conversation_repository_api.dart` and `lib/main.dart`.
- Backend: add explicit CORS allowlist for staging.
  - Target: `server/src/app.js`.
- Admin: optional `/health` route for smoke testing.

## Appendix: Generated Templates
- `/mnt/c/wsl_projects/TerraVoy/.env.staging.example`
- `/home/swqtony/projects/terravoy-backend/.env.staging.example`
- `/mnt/c/wsl_projects/TerraVoy-Admin/.env.staging.example`

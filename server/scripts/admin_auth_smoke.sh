#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
COOKIE_JAR="${COOKIE_JAR:-/tmp/admin_auth_cookies.txt}"

if [[ -z "${ADMIN_EMAIL}" || -z "${ADMIN_PASSWORD}" ]]; then
  echo "Missing ADMIN_EMAIL or ADMIN_PASSWORD."
  echo "Example: ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=Secret123 API_BASE=http://localhost:3000 ./server/scripts/admin_auth_smoke.sh"
  exit 1
fi

echo "Login..."
LOGIN_JSON=$(curl -s \
  -c "${COOKIE_JAR}" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
  "${API_BASE}/functions/v1/admin/auth/login")

ACCESS_TOKEN=$(python3 - <<'PY'
import json,sys
payload=json.loads(sys.stdin.read())
print(payload.get('accessToken',''))
PY
<<<"${LOGIN_JSON}")

if [[ -z "${ACCESS_TOKEN}" ]]; then
  echo "Login failed. Response: ${LOGIN_JSON}"
  exit 1
fi

echo "ME (authorized)..."
curl -s -H "Authorization: Bearer ${ACCESS_TOKEN}" "${API_BASE}/functions/v1/admin/me"
echo

echo "Refresh token..."
REFRESH_JSON=$(curl -s -b "${COOKIE_JAR}" -c "${COOKIE_JAR}" "${API_BASE}/functions/v1/admin/auth/refresh")
NEW_ACCESS_TOKEN=$(python3 - <<'PY'
import json,sys
payload=json.loads(sys.stdin.read())
print(payload.get('accessToken',''))
PY
<<<"${REFRESH_JSON}")

echo "Logout..."
curl -s -b "${COOKIE_JAR}" -c "${COOKIE_JAR}" "${API_BASE}/functions/v1/admin/auth/logout"
echo

echo "ME (should be 401 with old token)..."
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${ACCESS_TOKEN}" "${API_BASE}/functions/v1/admin/me")
echo "Status: ${STATUS}"

cat <<'NOTES'

Notes:
- Ensure ADMIN_JWT_SECRET is set in your environment (required in production).
- Create an admin user (example using node):
  node - <<'NODE'
  import pg from 'pg';
  import { createAdminUser } from './server/src/services/adminAuthService.js';

  const pool = new pg.Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT) || 5432,
    user: process.env.POSTGRES_USER || 'terravoy',
    password: process.env.POSTGRES_PASSWORD || 'terravoy_dev',
    database: process.env.POSTGRES_DB || 'terravoy',
  });

  const user = await createAdminUser(pool, {
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
    password: process.env.ADMIN_PASSWORD || 'Secret123',
  });
  console.log('Created admin:', user);
  await pool.end();
  NODE
NOTES

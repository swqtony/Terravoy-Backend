#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
SUPER_EMAIL="${SUPER_EMAIL:-}"
SUPER_PASSWORD="${SUPER_PASSWORD:-}"
CS_EMAIL="${CS_EMAIL:-}"
CS_PASSWORD="${CS_PASSWORD:-}"
POST_ID="${POST_ID:-}"
EXPERIENCE_ID="${EXPERIENCE_ID:-}"
ORDER_ID="${ORDER_ID:-}"

if [[ -z "${SUPER_EMAIL}" || -z "${SUPER_PASSWORD}" ]]; then
  echo "Missing SUPER_EMAIL or SUPER_PASSWORD."
  echo "Example: SUPER_EMAIL=admin@example.com SUPER_PASSWORD=Secret123 ./server/scripts/admin_phase3_smoke.sh"
  exit 1
fi

get_access_token() {
  local email="$1"
  local password="$2"
  local response
  response=$(curl -s \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${email}\",\"password\":\"${password}\"}" \
    "${API_BASE}/functions/v1/admin/auth/login")

  python3 - <<'PY'
import json,sys
payload=json.loads(sys.stdin.read())
print(payload.get('accessToken',''))
PY
<<<"${response}"
}

SUPER_TOKEN=$(get_access_token "${SUPER_EMAIL}" "${SUPER_PASSWORD}")
if [[ -z "${SUPER_TOKEN}" ]]; then
  echo "Failed to login as super admin"
  exit 1
fi

if [[ -z "${POST_ID}" ]]; then
  POST_ID=$(curl -s -H "Authorization: Bearer ${SUPER_TOKEN}" \
    "${API_BASE}/functions/v1/admin/posts?pageSize=1" | \
    python3 - <<'PY'
import json,sys
payload=json.loads(sys.stdin.read())
items=payload.get('data',{}).get('items',[])
print(items[0]['id'] if items else '')
PY
  )
fi

if [[ -z "${EXPERIENCE_ID}" ]]; then
  EXPERIENCE_ID=$(curl -s -H "Authorization: Bearer ${SUPER_TOKEN}" \
    "${API_BASE}/functions/v1/admin/experiences?pageSize=1" | \
    python3 - <<'PY'
import json,sys
payload=json.loads(sys.stdin.read())
items=payload.get('data',{}).get('items',[])
print(items[0]['id'] if items else '')
PY
  )
fi

if [[ -z "${ORDER_ID}" ]]; then
  ORDER_ID=$(curl -s -H "Authorization: Bearer ${SUPER_TOKEN}" \
    "${API_BASE}/functions/v1/admin/orders?pageSize=1" | \
    python3 - <<'PY'
import json,sys
payload=json.loads(sys.stdin.read())
items=payload.get('data',{}).get('items',[])
print(items[0]['id'] if items else '')
PY
  )
fi

if [[ -z "${POST_ID}" || -z "${EXPERIENCE_ID}" || -z "${ORDER_ID}" ]]; then
  echo "Missing POST_ID or EXPERIENCE_ID or ORDER_ID. Provide IDs via env."
  exit 1
fi

echo "Super admin PATCH posts (expect 200)"
STATUS_POST=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${SUPER_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"status":"hidden","reason":"moderation"}' \
  "${API_BASE}/functions/v1/admin/posts/${POST_ID}")

echo "Status: ${STATUS_POST}"

echo "Super admin PATCH experiences (expect 200)"
STATUS_EXP=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${SUPER_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"status":"paused","reason":"ops review"}' \
  "${API_BASE}/functions/v1/admin/experiences/${EXPERIENCE_ID}")

echo "Status: ${STATUS_EXP}"

echo "Super admin PATCH orders (expect 200)"
STATUS_ORDER=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${SUPER_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"dispute_status":"open","reason":"cs case"}' \
  "${API_BASE}/functions/v1/admin/orders/${ORDER_ID}")

echo "Status: ${STATUS_ORDER}"

echo "Missing reason should be 400"
STATUS_NO_REASON=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${SUPER_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"status":"hidden"}' \
  "${API_BASE}/functions/v1/admin/posts/${POST_ID}")

echo "Status: ${STATUS_NO_REASON}"

echo "Audit logs for actions"
for action in posts.update experiences.update orders.update; do
  COUNT=$(curl -s -H "Authorization: Bearer ${SUPER_TOKEN}" \
    "${API_BASE}/functions/v1/admin/audit-logs?action=${action}&pageSize=1" | \
    python3 - <<'PY'
import json,sys
payload=json.loads(sys.stdin.read())
items=payload.get('data',{}).get('items',[])
print(len(items))
PY
  )
  echo "${action}: ${COUNT}"
 done

if [[ -n "${CS_EMAIL}" && -n "${CS_PASSWORD}" ]]; then
  CS_TOKEN=$(get_access_token "${CS_EMAIL}" "${CS_PASSWORD}")
  echo "CS PATCH posts (expect 403)"
  STATUS_CS_POST=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${CS_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d '{"status":"hidden","reason":"cs"}' \
    "${API_BASE}/functions/v1/admin/posts/${POST_ID}")
  echo "Status: ${STATUS_CS_POST}"

  echo "CS PATCH orders (expect 200)"
  STATUS_CS_ORDER=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${CS_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d '{"dispute_status":"open","reason":"cs"}' \
    "${API_BASE}/functions/v1/admin/orders/${ORDER_ID}")
  echo "Status: ${STATUS_CS_ORDER}"
else
  echo "CS_EMAIL/CS_PASSWORD not set; skipping CS tests"
fi

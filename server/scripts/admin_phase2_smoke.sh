#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
SUPER_EMAIL="${SUPER_EMAIL:-}"
SUPER_PASSWORD="${SUPER_PASSWORD:-}"
CS_EMAIL="${CS_EMAIL:-}"
CS_PASSWORD="${CS_PASSWORD:-}"
REPORT_ID="${REPORT_ID:-}"
MEDIA_OBJECT_KEY="${MEDIA_OBJECT_KEY:-}"

if [[ -z "${SUPER_EMAIL}" || -z "${SUPER_PASSWORD}" ]]; then
  echo "Missing SUPER_EMAIL or SUPER_PASSWORD."
  echo "Example: SUPER_EMAIL=admin@example.com SUPER_PASSWORD=Secret123 ./server/scripts/admin_phase2_smoke.sh"
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

echo "Super admin token acquired"

if [[ -z "${REPORT_ID}" ]]; then
  REPORT_ID=$(curl -s \
    -H "Authorization: Bearer ${SUPER_TOKEN}" \
    "${API_BASE}/functions/v1/admin/reports?pageSize=1" | \
    python3 - <<'PY'
import json,sys
payload=json.loads(sys.stdin.read())
items=payload.get('data',{}).get('items',[])
print(items[0]['id'] if items else '')
PY
  )
fi

if [[ -z "${REPORT_ID}" ]]; then
  echo "No report found. Set REPORT_ID to an existing report id."
  exit 1
fi

echo "Testing PATCH /reports without reason (expect 400)"
STATUS_NO_REASON=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${SUPER_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"status":"reviewing"}' \
  "${API_BASE}/functions/v1/admin/reports/${REPORT_ID}")

echo "Status: ${STATUS_NO_REASON}"

echo "Testing PATCH /reports with reason (expect 200)"
STATUS_OK=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${SUPER_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"status":"reviewing","reason":"triage"}' \
  "${API_BASE}/functions/v1/admin/reports/${REPORT_ID}")

echo "Status: ${STATUS_OK}"

echo "Checking audit log (action=reports.update)"
AUDIT_COUNT=$(curl -s \
  -H "Authorization: Bearer ${SUPER_TOKEN}" \
  "${API_BASE}/functions/v1/admin/audit-logs?action=reports.update&pageSize=1" | \
  python3 - <<'PY'
import json,sys
payload=json.loads(sys.stdin.read())
items=payload.get('data',{}).get('items',[])
print(len(items))
PY
)

echo "Audit items: ${AUDIT_COUNT}"

if [[ -n "${CS_EMAIL}" && -n "${CS_PASSWORD}" ]]; then
  CS_TOKEN=$(get_access_token "${CS_EMAIL}" "${CS_PASSWORD}")
  echo "Testing CS role PATCH /reports (expect 403)"
  STATUS_FORBIDDEN=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${CS_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d '{"status":"reviewing","reason":"nope"}' \
    "${API_BASE}/functions/v1/admin/reports/${REPORT_ID}")
  echo "Status: ${STATUS_FORBIDDEN}"

  if [[ -n "${MEDIA_OBJECT_KEY}" ]]; then
    echo "Testing CS role media read (expect 403)"
    STATUS_MEDIA=$(curl -s -o /dev/null -w '%{http_code}' \
      -H "Authorization: Bearer ${CS_TOKEN}" \
      -H 'Content-Type: application/json' \
      -d "{\"objectKey\":\"${MEDIA_OBJECT_KEY}\",\"reason\":\"support\"}" \
      "${API_BASE}/functions/v1/admin/media/read-url")
    echo "Status: ${STATUS_MEDIA}"
  else
    echo "MEDIA_OBJECT_KEY not set; skipping media permission check"
  fi
else
  echo "CS_EMAIL/CS_PASSWORD not set; skipping CS role tests"
fi

cat <<'NOTES'

Notes:
- Ensure ADMIN_JWT_SECRET is set and migrations are applied.
- To grant roles manually:
  -- assign super_admin
  insert into admin_user_roles (admin_user_id, role_id)
  select u.id, r.id from admin_users u join admin_roles r on r.key = 'super_admin'
  where u.email = 'admin@example.com' on conflict do nothing;

  -- assign cs
  insert into admin_user_roles (admin_user_id, role_id)
  select u.id, r.id from admin_users u join admin_roles r on r.key = 'cs'
  where u.email = 'cs@example.com' on conflict do nothing;
NOTES

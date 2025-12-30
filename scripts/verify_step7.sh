#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-http://localhost:3000}"
HOST_USER="${HOST_USER:-verify_host_user}"
HOST_SESSION="${HOST_SESSION:-verify_host_session}"
ADMIN_KEY="${ADMIN_API_KEY:-}"
FILE="${FILE:-}"
MIME="${MIME:-image/jpeg}"
EXT="${EXT:-jpg}"

if [[ -z "$FILE" ]]; then
  echo "FILE is required (example: FILE=./path/to/image.jpg MIME=image/jpeg EXT=jpg)" >&2
  exit 1
fi

FILE_SIZE=$(wc -c < "$FILE" | tr -d ' ')

echo "== save draft =="
curl -sS -X PUT "$HOST/v1/host-certifications/draft" \
  -H "Content-Type: application/json" \
  -H "x-leancloud-user-id: $HOST_USER" \
  -H "x-leancloud-sessiontoken: $HOST_SESSION" \
  -d '{"profile":{"credentials":{"licenseNumber":"LIC-001"},"compliance":{"acceptServiceTerms":true,"acceptPrivacy":true,"noIllegalContent":true}},"documents":[]}' | cat

echo "== upload-url =="
UPLOAD_RESP=$(curl -sS -X POST "$HOST/v1/media/upload-url" \
  -H "Content-Type: application/json" \
  -H "x-leancloud-user-id: $HOST_USER" \
  -H "x-leancloud-sessiontoken: $HOST_SESSION" \
  -d "{\"scope\":\"kyc\",\"visibility\":\"private\",\"ext\":\"$EXT\",\"size\":$FILE_SIZE,\"mime\":\"$MIME\"}")

echo "$UPLOAD_RESP"
OBJECT_KEY=$(python3 - <<'PY' <<<"$UPLOAD_RESP"
import json,sys
payload=json.loads(sys.stdin.read())
data=payload.get('data',payload)
print(data.get('objectKey',''))
PY
)
UPLOAD_URL=$(python3 - <<'PY' <<<"$UPLOAD_RESP"
import json,sys
payload=json.loads(sys.stdin.read())
data=payload.get('data',payload)
print(data.get('uploadUrl',''))
PY
)

if [[ -z "$OBJECT_KEY" || -z "$UPLOAD_URL" ]]; then
  echo "upload-url failed" >&2
  exit 1
fi

echo "== PUT to OSS =="
curl -sS -X PUT "$UPLOAD_URL" -H "Content-Type: $MIME" --data-binary "@$FILE" | cat

echo "== complete =="
COMPLETE_RESP=$(curl -sS -X POST "$HOST/v1/media/complete" \
  -H "Content-Type: application/json" \
  -H "x-leancloud-user-id: $HOST_USER" \
  -H "x-leancloud-sessiontoken: $HOST_SESSION" \
  -d "{\"objectKey\":\"$OBJECT_KEY\",\"declaredSize\":$FILE_SIZE,\"declaredMime\":\"$MIME\"}")

echo "$COMPLETE_RESP"
ASSET_ID=$(python3 - <<'PY' <<<"$COMPLETE_RESP"
import json,sys
payload=json.loads(sys.stdin.read())
data=payload.get('data',payload)
print(data.get('id',''))
PY
)

if [[ -z "$ASSET_ID" ]]; then
  echo "complete failed" >&2
  exit 1
fi

echo "== update draft with document =="
DRAFT_RESP=$(curl -sS -X PUT "$HOST/v1/host-certifications/draft" \
  -H "Content-Type: application/json" \
  -H "x-leancloud-user-id: $HOST_USER" \
  -H "x-leancloud-sessiontoken: $HOST_SESSION" \
  -d "{\"documents\":[{\"mediaAssetId\":\"$ASSET_ID\",\"objectKey\":\"$OBJECT_KEY\",\"docType\":\"license\",\"name\":\"license.jpg\",\"sizeBytes\":$FILE_SIZE,\"contentType\":\"$MIME\"}]}")

echo "$DRAFT_RESP"

echo "== submit =="
SUBMIT_RESP=$(curl -sS -X POST "$HOST/v1/host-certifications/submit" \
  -H "Content-Type: application/json" \
  -H "x-leancloud-user-id: $HOST_USER" \
  -H "x-leancloud-sessiontoken: $HOST_SESSION" \
  -d '{"agree":true}')

echo "$SUBMIT_RESP"

CERT_ID=$(python3 - <<'PY' <<<"$SUBMIT_RESP"
import json,sys
payload=json.loads(sys.stdin.read())
state=payload.get('data',payload).get('state',{})
print(state.get('draftId',''))
PY
)

if [[ -n "$ADMIN_KEY" && -n "$CERT_ID" ]]; then
  echo "== admin approve =="
  curl -sS -X POST "$HOST/v1/admin/host-certifications/$CERT_ID/review" \
    -H "Content-Type: application/json" \
    -H "x-leancloud-user-id: $HOST_USER" \
    -H "x-leancloud-sessiontoken: $HOST_SESSION" \
    -H "x-admin-key: $ADMIN_KEY" \
    -d '{"action":"approve"}' | cat
else
  echo "ADMIN_API_KEY not set; skipping admin approval"
fi

echo "== verify host action gating =="
curl -sS -X POST "$HOST/functions/v1/host/experiences" \
  -H "Content-Type: application/json" \
  -H "x-leancloud-user-id: $HOST_USER" \
  -H "x-leancloud-sessiontoken: $HOST_SESSION" \
  -H "x-terra-role: host" \
  -d '{}' | cat

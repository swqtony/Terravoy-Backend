#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
HOST_LC_ID="${HOST_LC_ID:?HOST_LC_ID is required}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required for table checks}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found; install psql or run without DB checks" >&2
  exit 1
fi

HTTP_STATUS=""
HTTP_BODY=""

http() {
  local method="$1"
  local url="$2"
  local data="${3:-}"
  local token="${4:-}"
  local role="${5:-}"

  local tmp
  tmp=$(mktemp)
  local args=("-sS" "-w" "%{http_code}" "-o" "$tmp" "-X" "$method" "$url")
  args+=("-H" "Content-Type: application/json")
  if [[ -n "$token" ]]; then
    args+=("-H" "x-terra-token: $token")
  fi
  if [[ -n "$role" ]]; then
    args+=("-H" "x-terra-role: $role")
  fi
  if [[ -n "$data" ]]; then
    args+=("-d" "$data")
  fi
  HTTP_STATUS=$(curl "${args[@]}")
  HTTP_BODY=$(cat "$tmp")
  rm -f "$tmp"
}

json_get() {
  local path="$1"
  HTTP_BODY="$HTTP_BODY" python - "$path" <<'PY'
import json
import sys
import os

path = sys.argv[1]
raw = sys.stdin.read()
if not raw.strip():
  raw = os.environ.get('HTTP_BODY', '')
raw = raw.strip() or '{}'
try:
  data = json.loads(raw)
except json.JSONDecodeError:
  print('')
  sys.exit(0)

current = data
for part in path.split('.'):
  if isinstance(current, dict):
    current = current.get(part)
  elif isinstance(current, list) and part.isdigit():
    idx = int(part)
    current = current[idx] if idx < len(current) else None
  else:
    current = None
    break
print('' if current is None else current)
PY
}

terra_token() {
  local user_id="$1"
  local role="$2"
  http POST "$BASE_URL/functions/v1/terra-auth" "{\"leancloudUserId\":\"$user_id\",\"role\":\"$role\"}"
  if [[ "$HTTP_STATUS" != "200" ]]; then
    echo "terra-auth failed for role=$role user=$user_id" >&2
    echo "status=$HTTP_STATUS body=$HTTP_BODY" >&2
    exit 1
  fi
  local token
  token=$(json_get "data.terraToken")
  if [[ -z "$token" ]]; then
    echo "Failed to get terra token" >&2
    echo "$HTTP_BODY" >&2
    exit 1
  fi
  echo "$token"
}

psql "$DATABASE_URL" -Atc "select current_database(), current_user;" | sed 's/^/DB: /'

HOST_TOKEN=$(terra_token "$HOST_LC_ID" "host")

TMP_PNG="/tmp/oss_smoke.png"
BASE64_PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8a8eUAAAAASUVORK5CYII="

echo "$BASE64_PNG" | base64 -d > "$TMP_PNG"
FILE_SIZE=$(wc -c < "$TMP_PNG" | tr -d ' ')

UPLOAD_BODY=$(cat <<JSON
{"scope":"experience","visibility":"public","mime":"image/png","ext":"png","size":$FILE_SIZE}
JSON
)

http POST "$BASE_URL/functions/v1/storage/upload-url" "$UPLOAD_BODY" "$HOST_TOKEN" "host"
if [[ "$HTTP_STATUS" != "200" ]]; then
  echo "upload-url failed status=$HTTP_STATUS body=$HTTP_BODY" >&2
  exit 1
fi
UPLOAD_URL=$(json_get "data.uploadUrl")
OBJECT_KEY=$(json_get "data.objectKey")
BUCKET=$(json_get "data.bucket")
FINAL_URL=$(json_get "data.finalUrl")

if [[ -z "$UPLOAD_URL" || -z "$OBJECT_KEY" || -z "$BUCKET" ]]; then
  echo "Missing upload-url response fields" >&2
  echo "$HTTP_BODY" >&2
  exit 1
fi

PUT_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT -H "Content-Type: image/png" --data-binary "@$TMP_PNG" "$UPLOAD_URL")
if [[ "$PUT_STATUS" != "200" && "$PUT_STATUS" != "201" ]]; then
  echo "PUT upload failed status=$PUT_STATUS" >&2
  exit 1
fi

COMPLETE_BODY=$(cat <<JSON
{"objectKey":"$OBJECT_KEY","bucket":"$BUCKET","scope":"experience","visibility":"public","mime":"image/png","size":$FILE_SIZE}
JSON
)

http POST "$BASE_URL/functions/v1/storage/complete" "$COMPLETE_BODY" "$HOST_TOKEN" "host"
if [[ "$HTTP_STATUS" != "200" ]]; then
  echo "complete failed status=$HTTP_STATUS body=$HTTP_BODY" >&2
  exit 1
fi
ASSET_ID=$(json_get "data.assetId")
ASSET_URL=$(json_get "data.url")

if [[ -z "$ASSET_ID" ]]; then
  echo "Missing assetId" >&2
  echo "$HTTP_BODY" >&2
  exit 1
fi

psql "$DATABASE_URL" -Atc "select id, url, scope, visibility, provider from media_assets where owner_user_id = '$HOST_LC_ID' and scope = 'experience' and visibility = 'public' and provider = 'oss' order by created_at desc limit 1;" | sed 's/^/media_assets: /'

if [[ -n "$FINAL_URL" ]]; then
  HEAD_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -I "$FINAL_URL" || true)
  echo "finalUrl HEAD status=$HEAD_STATUS"
fi

echo "Step 5 smoke test passed."

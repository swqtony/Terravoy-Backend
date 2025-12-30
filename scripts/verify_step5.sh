#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-http://localhost:3000}"
LC_USER="${LC_USER:-verify_media_user}"
LC_SESSION="${LC_SESSION:-verify_media_session}"
FILE="${FILE:-}"
MIME="${MIME:-image/jpeg}"
EXT="${EXT:-}"

if [[ -z "$FILE" ]]; then
  echo "Set FILE to an image path before running (example: FILE=./path/to/file.jpg)."
  exit 1
fi

if [[ ! -f "$FILE" ]]; then
  echo "FILE not found: $FILE"
  exit 1
fi

if [[ -z "$EXT" ]]; then
  EXT="${FILE##*.}"
  EXT="${EXT,,}"
fi

echo "== legacy storage should be gone =="
for path in /storage/upload-url /storage/complete /storage/read-url; do
  status=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$HOST$path")
  echo "$path -> $status (expected 410)"
done

size=$(wc -c < "$FILE" | tr -d ' ')

echo "== upload-url =="
upload_resp=$(
  curl -sS -X POST "$HOST/v1/media/upload-url" \
    -H "Content-Type: application/json" \
    -H "x-leancloud-user-id: $LC_USER" \
    -H "x-leancloud-sessiontoken: $LC_SESSION" \
    -d "{\"scope\":\"post\",\"visibility\":\"public\",\"ext\":\"$EXT\",\"size\":$size,\"mime\":\"$MIME\"}"
)
echo "$upload_resp"

object_key=$(python3 - <<'PY' <<<"$upload_resp"
import json,sys
data=json.loads(sys.stdin.read())
payload=data.get("data",data)
print(payload.get("objectKey",""))
PY
)
upload_url=$(python3 - <<'PY' <<<"$upload_resp"
import json,sys
data=json.loads(sys.stdin.read())
payload=data.get("data",data)
print(payload.get("uploadUrl",""))
PY
)
content_type=$(python3 - <<'PY' <<<"$upload_resp"
import json,sys
data=json.loads(sys.stdin.read())
payload=data.get("data",data)
headers=payload.get("requiredHeaders") or {}
print(headers.get("Content-Type",""))
PY
)

if [[ -z "$object_key" || -z "$upload_url" ]]; then
  echo "upload-url failed to return objectKey/uploadUrl"
  exit 1
fi

echo "== PUT to OSS =="
curl -sS -X PUT "$upload_url" -H "Content-Type: ${content_type:-$MIME}" --data-binary @"$FILE" >/dev/null
echo "PUT ok"

echo "== complete =="
complete_resp=$(
  curl -sS -X POST "$HOST/v1/media/complete" \
    -H "Content-Type: application/json" \
    -H "x-leancloud-user-id: $LC_USER" \
    -H "x-leancloud-sessiontoken: $LC_SESSION" \
    -d "{\"objectKey\":\"$object_key\",\"declaredSize\":$size,\"declaredMime\":\"$MIME\"}"
)
echo "$complete_resp"

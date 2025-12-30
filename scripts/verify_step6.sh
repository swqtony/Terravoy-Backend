#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-http://localhost:3000}"
LC_USER="${LC_USER:-verify_safety_user}"
LC_SESSION="${LC_SESSION:-verify_safety_session}"
HOST_USER="${HOST_USER:-verify_host_user}"
HOST_SESSION="${HOST_SESSION:-verify_host_session}"

echo "== check-text URL =="
curl -sS -X POST "$HOST/v1/safety/check-text" \
  -H "Content-Type: application/json" \
  -H "x-leancloud-user-id: $LC_USER" \
  -H "x-leancloud-sessiontoken: $LC_SESSION" \
  -d '{"scene":"chat","text":"visit http://example.com"}' | cat

echo "== check-text PHONE =="
curl -sS -X POST "$HOST/v1/safety/check-text" \
  -H "Content-Type: application/json" \
  -H "x-leancloud-user-id: $LC_USER" \
  -H "x-leancloud-sessiontoken: $LC_SESSION" \
  -d '{"scene":"chat","text":"call me 13800138000"}' | cat

echo "== check-text WECHAT =="
curl -sS -X POST "$HOST/v1/safety/check-text" \
  -H "Content-Type: application/json" \
  -H "x-leancloud-user-id: $LC_USER" \
  -H "x-leancloud-sessiontoken: $LC_SESSION" \
  -d '{"scene":"chat","text":"加微信 abcdefg"}' | cat

echo "== check-text SENSITIVE_WORD =="
curl -sS -X POST "$HOST/v1/safety/check-text" \
  -H "Content-Type: application/json" \
  -H "x-leancloud-user-id: $LC_USER" \
  -H "x-leancloud-sessiontoken: $LC_SESSION" \
  -d '{"scene":"chat","text":"illegal content"}' | cat

echo "== discover post blocked =="
curl -sS -X POST "$HOST/functions/v1/discover/posts" \
  -H "Content-Type: application/json" \
  -H "x-leancloud-user-id: $LC_USER" \
  -H "x-leancloud-sessiontoken: $LC_SESSION" \
  -d '{"content":"http://example.com","images":[]}' | cat

echo "== experience blocked =="
draft_resp=$(
  curl -sS -X POST "$HOST/functions/v1/host/experiences" \
    -H "Content-Type: application/json" \
    -H "x-leancloud-user-id: $HOST_USER" \
    -H "x-leancloud-sessiontoken: $HOST_SESSION" \
    -H "x-terra-role: host" \
    -d '{}'
)
echo "$draft_resp"
exp_id=$(python3 - <<'PY' <<<"$draft_resp"
import json,sys
data=json.loads(sys.stdin.read())
payload=data.get("data",data)
print(payload.get("id",""))
PY
)
if [[ -n "$exp_id" ]]; then
  curl -sS -X PUT "$HOST/functions/v1/host/experiences/$exp_id" \
    -H "Content-Type: application/json" \
    -H "x-leancloud-user-id: $HOST_USER" \
    -H "x-leancloud-sessiontoken: $HOST_SESSION" \
    -H "x-terra-role: host" \
    -d '{"title":"Test","description":"加微信 abcdefg"}' | cat
fi

echo "== report create =="
curl -sS -X POST "$HOST/v1/reports" \
  -H "Content-Type: application/json" \
  -H "x-leancloud-user-id: $LC_USER" \
  -H "x-leancloud-sessiontoken: $LC_SESSION" \
  -d '{"targetType":"chat","targetId":"conv_1","reasonCode":"spam","description":"test report"}' | cat

echo "== check-text rate limit (expect 429) =="
rate_status="200"
for i in $(seq 1 130); do
  rate_status=$(curl -sS -o /tmp/step6_rate_body.json -w "%{http_code}" \
    -X POST "$HOST/v1/safety/check-text" \
    -H "Content-Type: application/json" \
    -H "x-leancloud-user-id: ${LC_USER}_rl" \
    -H "x-leancloud-sessiontoken: ${LC_SESSION}_rl" \
    -d "{\"scene\":\"chat\",\"text\":\"rate test ${i}\"}")
  if [[ "$rate_status" == "429" ]]; then
    break
  fi
done
echo "rate status: $rate_status"
cat /tmp/step6_rate_body.json

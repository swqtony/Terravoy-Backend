#!/usr/bin/env bash
set -euo pipefail

IM_API_URL="${IM_API_URL:-http://localhost:8090}"
IM_ACCESS_TOKEN="${IM_ACCESS_TOKEN:-}"
IM_USER_A="${IM_USER_A:-}"
IM_USER_B="${IM_USER_B:-}"
MATCH_SESSION_ID="${MATCH_SESSION_ID:-match-0001}"
ORDER_ID="${ORDER_ID:-order-0001}"
COMPOSE_FILE="${COMPOSE_FILE:-im/docker-compose.im.yml}"

if [[ -z "$IM_ACCESS_TOKEN" || -z "$IM_USER_A" || -z "$IM_USER_B" ]]; then
  echo "Missing env: IM_ACCESS_TOKEN, IM_USER_A, IM_USER_B"
  exit 1
fi

json_get() {
  node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));const path='$1'.split('.');let cur=data;for(const p of path){cur=cur?.[p];}console.log(cur ?? '')"
}

uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen
  else
    node -e "console.log(require('crypto').randomUUID())"
  fi
}

auth_header=(-H "Authorization: Bearer ${IM_ACCESS_TOKEN}" -H "Content-Type: application/json")

echo "Ensure match thread..."
match_resp=$(curl -sS "${auth_header[@]}" \
  -d "{\"type\":\"match\",\"match_session_id\":\"${MATCH_SESSION_ID}\",\"members\":[{\"user_id\":\"${IM_USER_A}\",\"role\":\"traveler\"},{\"user_id\":\"${IM_USER_B}\",\"role\":\"host\"}]}" \
  "${IM_API_URL}/v1/threads/ensure")
match_thread_id=$(echo "$match_resp" | json_get "data.thread_id")
echo "match_thread_id=${match_thread_id}"

echo "Ensure order thread..."
order_resp=$(curl -sS "${auth_header[@]}" \
  -d "{\"type\":\"order\",\"order_id\":\"${ORDER_ID}\",\"members\":[{\"user_id\":\"${IM_USER_A}\",\"role\":\"traveler\"},{\"user_id\":\"${IM_USER_B}\",\"role\":\"host\"}]}" \
  "${IM_API_URL}/v1/threads/ensure")
order_thread_id=$(echo "$order_resp" | json_get "data.thread_id")
echo "order_thread_id=${order_thread_id}"

client_msg_id=$(uuid)
echo "Send message..."
msg_resp=$(curl -sS "${auth_header[@]}" \
  -d "{\"thread_id\":\"${match_thread_id}\",\"client_msg_id\":\"${client_msg_id}\",\"type\":\"text\",\"content\":{\"text\":\"hello\"}}" \
  "${IM_API_URL}/v1/messages")
seq=$(echo "$msg_resp" | json_get "data.seq")
msg_id=$(echo "$msg_resp" | json_get "data.msg_id")
echo "msg_id=${msg_id} seq=${seq}"

echo "Retry same client_msg_id (idempotent)..."
msg_resp_2=$(curl -sS "${auth_header[@]}" \
  -d "{\"thread_id\":\"${match_thread_id}\",\"client_msg_id\":\"${client_msg_id}\",\"type\":\"text\",\"content\":{\"text\":\"hello\"}}" \
  "${IM_API_URL}/v1/messages")
seq2=$(echo "$msg_resp_2" | json_get "data.seq")
msg_id2=$(echo "$msg_resp_2" | json_get "data.msg_id")
echo "msg_id2=${msg_id2} seq2=${seq2}"

if [[ "$msg_id" != "$msg_id2" ]]; then
  echo "Idempotency failed"
  exit 1
fi

echo "Fetch messages afterSeq=0..."
curl -sS "${auth_header[@]}" \
  "${IM_API_URL}/v1/threads/${match_thread_id}/messages?afterSeq=0&limit=10" >/dev/null

echo "Update read state..."
curl -sS "${auth_header[@]}" \
  -d "{\"last_read_seq\":${seq}}" \
  "${IM_API_URL}/v1/threads/${match_thread_id}/read" >/dev/null

echo "Push queue smoke..."
docker compose -f "${COMPOSE_FILE}" exec -T im-redis redis-cli XADD im:push:stream '*' \
  msg_id test-msg thread_id "${match_thread_id}" seq "${seq}" to_user_id "${IM_USER_B}" attempt 0 available_at_ms "$(date +%s%3N)" >/dev/null
sleep 2
len=$(docker compose -f "${COMPOSE_FILE}" exec -T im-redis redis-cli XLEN im:push:stream | tr -d '\r')
echo "push_stream_len=${len}"

echo "IM smoke completed."

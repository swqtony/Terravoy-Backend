#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
HOST_LC_ID="${HOST_LC_ID:?HOST_LC_ID is required}"
TRAVELER_LC_ID="${TRAVELER_LC_ID:?TRAVELER_LC_ID is required}"
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

assert_status() {
  local expected="$1"
  if [[ "$HTTP_STATUS" != "$expected" ]]; then
    echo "Expected status $expected, got $HTTP_STATUS" >&2
    echo "$HTTP_BODY" >&2
    exit 1
  fi
}

assert_status_not_2xx() {
  if [[ "$HTTP_STATUS" =~ ^2 ]]; then
    echo "Expected non-2xx, got $HTTP_STATUS" >&2
    echo "$HTTP_BODY" >&2
    exit 1
  fi
}

health_check() {
  echo "[A] Health check"
  http GET "$BASE_URL/health"
  assert_status 200
}

db_check() {
  echo "[A] DB tables check"
  psql "$DATABASE_URL" -Atc "select current_database(), current_user;" | sed 's/^/DB: /'
  local row
  row=$(psql "$DATABASE_URL" -Atc "select to_regclass('public.experiences'), to_regclass('public.discover_posts'), to_regclass('public.discover_post_likes'), to_regclass('public.discover_comments'), to_regclass('public.media_assets');")
  IFS='|' read -r exp posts likes comments media <<<"$row"
  if [[ -z "$exp" || -z "$posts" || -z "$likes" || -z "$comments" || -z "$media" ]]; then
    echo "Table check failed: $row" >&2
    exit 1
  fi
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

expect_key_fields_detail() {
  python - <<'PY'
import json
import sys

raw = sys.stdin.read().strip() or '{}'
try:
  payload = json.loads(raw)
except json.JSONDecodeError:
  print('Invalid JSON')
  sys.exit(1)

if payload.get('success') is True:
  data = payload.get('data')
else:
  data = payload

missing = []
for key in [
  'coverImageUrl',
  'gallery',
  'availability',
  'cancellationPolicy',
  'safetyNotes',
  'meetupNotes',
  'ageRestriction',
]:
  if key not in data or data.get(key) in (None, '', []):
    missing.append(key)

if missing:
  print('Missing fields: ' + ', '.join(missing))
  sys.exit(1)
PY
}

health_check
db_check

HOST_TOKEN=$(terra_token "$HOST_LC_ID" "host")
TRAVELER_TOKEN=$(terra_token "$TRAVELER_LC_ID" "traveler")

# Experience: create draft
http POST "$BASE_URL/functions/v1/host/experiences" "{}" "$HOST_TOKEN" "host"
assert_status 200
EXPERIENCE_ID=$(json_get "data.id")

# Invalid transition: draft -> pause should fail
http POST "$BASE_URL/functions/v1/host/experiences/$EXPERIENCE_ID/pause" "{}" "$HOST_TOKEN" "host"
assert_status_not_2xx

# Non-owner access should fail
http GET "$BASE_URL/functions/v1/host/experiences/$EXPERIENCE_ID" "" "$TRAVELER_TOKEN" "traveler"
if [[ "$HTTP_STATUS" != "403" ]]; then
  echo "Expected 403 for non-owner, got $HTTP_STATUS" >&2
  echo "$HTTP_BODY" >&2
  exit 1
fi

# Update
UPDATE_PAYLOAD='{
  "title":"Smoke Test Experience",
  "summary":"Summary",
  "description":"Long description",
  "city":"Tokyo",
  "meetingPoint":"Station",
  "languages":["en"],
  "category":"city_walk",
  "durationMinutes":90,
  "availability":[{"type":"weekly","weekdays":[1,2],"startTime":"10:00","endTime":"12:00"}],
  "minGuests":1,
  "maxGuests":4,
  "minAdvanceHours":12,
  "cutoffHours":6,
  "pricePerGuest":199,
  "currency":"CNY",
  "cancellationPolicy":"flexible",
  "coverImageUrl":"https://example.com/cover.jpg",
  "gallery":["https://example.com/1.jpg","https://example.com/2.jpg","https://example.com/3.jpg"],
  "safetyNotes":"Stay safe",
  "meetupNotes":"Be on time",
  "ageRestriction":{"text":"18+"},
  "tags":["walk"]
}'
http PUT "$BASE_URL/functions/v1/host/experiences/$EXPERIENCE_ID" "$UPDATE_PAYLOAD" "$HOST_TOKEN" "host"
assert_status 200

# Submit -> publish
http POST "$BASE_URL/functions/v1/host/experiences/$EXPERIENCE_ID/submit" "{}" "$HOST_TOKEN" "host"
assert_status 200

# Pause -> Resume -> Archive
http POST "$BASE_URL/functions/v1/host/experiences/$EXPERIENCE_ID/pause" "{}" "$HOST_TOKEN" "host"
assert_status 200
http POST "$BASE_URL/functions/v1/host/experiences/$EXPERIENCE_ID/resume" "{}" "$HOST_TOKEN" "host"
assert_status 200
http POST "$BASE_URL/functions/v1/host/experiences/$EXPERIENCE_ID/archive" "{}" "$HOST_TOKEN" "host"
assert_status 200

# Duplicate
http POST "$BASE_URL/functions/v1/host/experiences/$EXPERIENCE_ID/duplicate" "{}" "$HOST_TOKEN" "host"
assert_status 200
DUPLICATE_ID=$(json_get "data.id")

# Delete archived original
http DELETE "$BASE_URL/functions/v1/host/experiences/$EXPERIENCE_ID" "" "$HOST_TOKEN" "host"
assert_status 200

# Delete duplicate draft
http DELETE "$BASE_URL/functions/v1/host/experiences/$DUPLICATE_ID" "" "$HOST_TOKEN" "host"
assert_status 200

# Create two more experiences for list order + discover recommend
http POST "$BASE_URL/functions/v1/host/experiences" "{}" "$HOST_TOKEN" "host"
assert_status 200
EXP_A=$(json_get "data.id")
http POST "$BASE_URL/functions/v1/host/experiences" "{}" "$HOST_TOKEN" "host"
assert_status 200
EXP_B=$(json_get "data.id")

http PUT "$BASE_URL/functions/v1/host/experiences/$EXP_B" "$UPDATE_PAYLOAD" "$HOST_TOKEN" "host"
assert_status 200
sleep 1
http PUT "$BASE_URL/functions/v1/host/experiences/$EXP_A" "$UPDATE_PAYLOAD" "$HOST_TOKEN" "host"
assert_status 200

# list order check
http GET "$BASE_URL/functions/v1/host/experiences?page=1&pageSize=2" "" "$HOST_TOKEN" "host"
assert_status 200
python - <<PY
import json
import sys
body = json.loads('''$HTTP_BODY''')
items = body.get('data', [])
if len(items) < 2:
  print('Expected at least 2 items')
  sys.exit(1)
if items[0].get('id') != '$EXP_A':
  print('List order not stable; expected EXP_A first')
  sys.exit(1)
PY

# Publish both for discover
http POST "$BASE_URL/functions/v1/host/experiences/$EXP_A/submit" "{}" "$HOST_TOKEN" "host"
assert_status 200
http POST "$BASE_URL/functions/v1/host/experiences/$EXP_B/submit" "{}" "$HOST_TOKEN" "host"
assert_status 200

# Discover recommend page1/page2 no overlap
http GET "$BASE_URL/functions/v1/discover/experiences/recommend?page=1&pageSize=1" ""
assert_status 200
REC_1=$(json_get "data.items.0.id")
http GET "$BASE_URL/functions/v1/discover/experiences/recommend?page=2&pageSize=1" ""
assert_status 200
REC_2=$(json_get "data.items.0.id")
if [[ -z "$REC_1" || -z "$REC_2" || "$REC_1" == "$REC_2" ]]; then
  echo "Recommend pagination overlap or empty" >&2
  exit 1
fi

# Detail field coverage
http GET "$BASE_URL/functions/v1/experiences/$REC_1" ""
assert_status 200
echo "$HTTP_BODY" | expect_key_fields_detail

# Plaza publish + bulk posts
SPECIAL_CONTENT="smoke-post-$(date +%s)"
http POST "$BASE_URL/functions/v1/discover/posts" "{\"content\":\"$SPECIAL_CONTENT\",\"images\":[\"https://example.com/x.jpg\"]}" "$TRAVELER_TOKEN" "traveler"
assert_status 200
POST_ID=$(json_get "data.id")

for i in $(seq 1 40); do
  http POST "$BASE_URL/functions/v1/discover/posts" "{\"content\":\"bulk-$i\"}" "$TRAVELER_TOKEN" "traveler"
  assert_status 200
done

# Cursor paging
http GET "$BASE_URL/functions/v1/discover/posts?limit=20" ""
assert_status 200
PAGE1_BODY="$HTTP_BODY"
CURSOR=$(echo "$PAGE1_BODY" | python - <<'PY'
import json
import sys
body = json.loads(sys.stdin.read())
print(body.get('data', {}).get('nextCursor', '') or '')
PY
)
if [[ -z "$CURSOR" ]]; then
  echo "Missing cursor" >&2
  exit 1
fi

http GET "$BASE_URL/functions/v1/discover/posts?limit=20&cursor=$CURSOR" ""
assert_status 200
PAGE2_BODY="$HTTP_BODY"
python - <<PY
import json
import sys
p1 = json.loads('''$PAGE1_BODY''')
p2 = json.loads('''$PAGE2_BODY''')
ids1 = {p['id'] for p in p1.get('data', {}).get('posts', [])}
ids2 = {p['id'] for p in p2.get('data', {}).get('posts', [])}
if ids1 & ids2:
  print('Overlap between pages')
  sys.exit(1)
all_ids = ids1 | ids2
if len(all_ids) < 40:
  print('Expected at least 40 unique posts in first 2 pages')
  sys.exit(1)
if not any(p.get('content') == '$SPECIAL_CONTENT' for p in p1.get('data', {}).get('posts', [])):
  print('Special post not found in page1')
  sys.exit(1)
PY

# Like idempotency
http POST "$BASE_URL/functions/v1/discover/posts/$POST_ID/like" "{}" "$TRAVELER_TOKEN" "traveler"
assert_status 200
LIKE_COUNT_1=$(json_get "data.likeCount")
http POST "$BASE_URL/functions/v1/discover/posts/$POST_ID/like" "{}" "$TRAVELER_TOKEN" "traveler"
assert_status 200
LIKE_COUNT_2=$(json_get "data.likeCount")
if [[ "$LIKE_COUNT_1" != "$LIKE_COUNT_2" ]]; then
  echo "Like not idempotent" >&2
  exit 1
fi
http DELETE "$BASE_URL/functions/v1/discover/posts/$POST_ID/like" "" "$TRAVELER_TOKEN" "traveler"
assert_status 200
LIKE_COUNT_3=$(json_get "data.likeCount")
http POST "$BASE_URL/functions/v1/discover/posts/$POST_ID/like" "{}" "$TRAVELER_TOKEN" "traveler"
assert_status 200
LIKE_COUNT_4=$(json_get "data.likeCount")
if [[ "$LIKE_COUNT_4" -lt "$LIKE_COUNT_3" ]]; then
  echo "Like count incorrect after unlike/like" >&2
  exit 1
fi

# Comments
COMMENT_CONTENT="comment-$(date +%s)"
http POST "$BASE_URL/functions/v1/discover/posts/$POST_ID/comments" "{\"content\":\"$COMMENT_CONTENT\"}" "$TRAVELER_TOKEN" "traveler"
assert_status 200
http GET "$BASE_URL/functions/v1/discover/posts/$POST_ID/comments?limit=20" ""
assert_status 200
python - <<PY
import json
body = json.loads('''$HTTP_BODY''')
comments = body.get('data', {}).get('comments', [])
if not any(c.get('content') == '$COMMENT_CONTENT' for c in comments):
  print('Comment not found')
  raise SystemExit(1)
PY

http GET "$BASE_URL/functions/v1/discover/posts?limit=20" ""
assert_status 200
python - <<PY
import json
body = json.loads('''$HTTP_BODY''')
posts = body.get('data', {}).get('posts', [])
post = next((p for p in posts if p.get('id') == '$POST_ID'), None)
if not post or post.get('comments', 0) < 1:
  print('comment_count not updated')
  raise SystemExit(1)
PY

echo "Step 4 smoke test passed."

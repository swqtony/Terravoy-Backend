#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-http://localhost:3000}"
TRAVELER_LC="${TRAVELER_LC:-traveler_local}"
HOST_LC="${HOST_LC:-host_local}"
TRAVELER_SESSION_TOKEN="${TRAVELER_SESSION_TOKEN:-dev_trav_session}"
HOST_SESSION_TOKEN="${HOST_SESSION_TOKEN:-dev_host_session}"
MATCH_PREFS='{"preferredGender":"female","preferredAgeMin":20,"preferredAgeMax":35,"preferredLanguages":["en"],"cityScopeMode":"Strict"}'

fail() { echo "FAIL: $1" >&2; exit 1; }
pass() { echo "PASS: $1"; }
step() { echo "==> $1"; }

api_post() {
  local path="$1"; shift
  curl -sS -X POST "$HOST$path" \
    -H "Content-Type: application/json" \
    "$@"
}

parse_field() {
  python3 - <<'PY' "$1" "$2"
import json,sys
data=json.loads(sys.argv[1])
path=sys.argv[2].split('.')
cur=data
try:
    for p in path:
        cur=cur[p]
    print(cur)
except Exception:
    sys.exit(1)
PY
}

step "Health check"
curl -sS "$HOST/health" | grep -q '"ok":true' || fail "health"
pass "health"

step "Bootstrap traveler profile"
resp=$(api_post "/functions/v1/profile-bootstrap" \
  -H "x-leancloud-user-id: $TRAVELER_LC" \
  -H "x-leancloud-sessiontoken: $TRAVELER_SESSION_TOKEN" \
  -d "{\"leancloudUserId\":\"$TRAVELER_LC\"}")
trav_profile=$(parse_field "$resp" "data.profileId") || fail "profile id"
pass "profile-bootstrap"

step "Mark traveler profile completed"
api_post "/functions/v1/profile-update" \
  -H "x-leancloud-user-id: $TRAVELER_LC" \
  -H "x-leancloud-sessiontoken: $TRAVELER_SESSION_TOKEN" \
  -d "{\"profileId\":\"$trav_profile\",\"gender\":\"male\",\"age\":30,\"firstLanguage\":\"en\",\"secondLanguage\":\"en\",\"homeCity\":\"shanghai\"}" >/dev/null
pass "profile-update"

step "Create trip card"
resp=$(api_post "/functions/v1/trip-card-create" \
  -H "x-leancloud-user-id: $TRAVELER_LC" \
  -H "x-leancloud-sessiontoken: $TRAVELER_SESSION_TOKEN" \
  -d "{\"profileId\":\"$trav_profile\",\"destinationCity\":\"shanghai\",\"startDate\":\"2025-12-20\",\"endDate\":\"2025-12-21\"}")
trip_card=$(parse_field "$resp" "data.id") || fail "trip card"
pass "trip-card-create"

step "Save traveler preferences"
resp=$(curl -sS -X PUT "$HOST/api/v1/preferences/match" \
  -H "Content-Type: application/json" \
  -H "x-leancloud-user-id: $TRAVELER_LC" \
  -H "x-leancloud-sessiontoken: $TRAVELER_SESSION_TOKEN" \
  -d "$MATCH_PREFS")
pref_gender=$(parse_field "$resp" "data.preferredGender") || fail "preferences save"
pass "preferences saved ($pref_gender)"

step "Match start (reuse saved preferences; expect waiting or matched)"
resp=$(api_post "/functions/v1/match-start" \
  -H "x-leancloud-user-id: $TRAVELER_LC" \
  -H "x-leancloud-sessiontoken: $TRAVELER_SESSION_TOKEN" \
  -d "{\"tripCardId\":\"$trip_card\"}")
echo "$resp"
pref_in_resp=$(parse_field "$resp" "data.preferences.preferredGender") || fail "preferences missing in match-start"
[ "$pref_in_resp" = "female" ] || fail "preferences not reused"
applied_gender=$(parse_field "$resp" "data.appliedPreferences.preferredGender") || fail "appliedPreferences missing"
pass "match-start (response above)"

step "Bootstrap host profile"
resp=$(api_post "/functions/v1/profile-bootstrap" \
  -H "x-leancloud-user-id: $HOST_LC" \
  -H "x-leancloud-sessiontoken: $HOST_SESSION_TOKEN" \
  -d "{\"leancloudUserId\":\"$HOST_LC\"}")
host_profile=$(parse_field "$resp" "data.profileId") || fail "host profile"
api_post "/functions/v1/profile-update" \
  -H "x-leancloud-user-id: $HOST_LC" \
  -H "x-leancloud-sessiontoken: $HOST_SESSION_TOKEN" \
  -d "{\"profileId\":\"$host_profile\",\"gender\":\"female\",\"age\":28,\"firstLanguage\":\"en\",\"secondLanguage\":\"en\",\"homeCity\":\"shanghai\"}" >/dev/null
pass "host profile/bootstrap+update"

step "Create order"
start_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
end_time=$(date -u -d "+2 hours" +"%Y-%m-%dT%H:%M:%SZ")
resp=$(curl -sS -X POST "$HOST/functions/v1/orders" \
  -H "Content-Type: application/json" \
  -H "x-leancloud-user-id: $TRAVELER_LC" \
  -H "x-leancloud-sessiontoken: $TRAVELER_SESSION_TOKEN" \
  -H "x-terra-role: traveler" \
  -H "x-route: /orders/create" \
  -d "{\"travelerId\":\"$trav_profile\",\"experienceId\":\"exp1\",\"hostId\":\"$host_profile\",\"startTime\":\"$start_time\",\"endTime\":\"$end_time\",\"peopleCount\":1,\"totalAmount\":100}")
echo "$resp"
pass "order create (response above)"

echo "PASS: smoke tests completed"

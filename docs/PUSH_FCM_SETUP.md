# FCM Push Setup

## Env
- `FCM_SERVICE_ACCOUNT_JSON` (preferred, JSON string)
- `FCM_SERVICE_ACCOUNT_PATH` (path to service account file)
- `PUSH_MAX_RETRIES` (default 5)
- `PUSH_RETRY_BACKOFF_MS` (default 1000)

## Token Registration
- `POST /push/token`
  - body: `{ "platform": "android", "token": "FCM_DEVICE_TOKEN" }`

## Verification Steps
1) Configure FCM env vars
2) Start stack: `docker compose up -d`
3) Register token via `/push/token`
4) Send IM message to offline user
5) Check push worker logs for send result

## Notes
- Payload includes `thread_id`, `seq`, `msg_id`
- Dead-letter stream: `im:push:dlq`

# FCM Push Setup (Go)

## Env
- `FCM_SERVICE_ACCOUNT_JSON` or `FCM_SERVICE_ACCOUNT_PATH`
- `PUSH_MAX_RETRIES` (default 5)
- `PUSH_RETRY_BACKOFF_MS` (default 1000)

## Token Registration
- `POST /v1/push/token`
  - body: `{ "platform": "android", "token": "FCM_DEVICE_TOKEN" }`

## Queue
- Stream: `im:push:stream`
- DLQ: `im:push:dlq`

## Verification
1) `make im-up` + `make im-migrate`
2) Register token
3) Send message via gateway while receiver offline
4) Observe worker logs or DLQ

# IM Gateway

## WS Endpoint
- `ws://localhost:8081/ws`

## Auth
- Only accepts Bearer access token signed by `AUTH_JWT_SECRET`

## Protocol
### auth
```json
{"type":"auth","token":"<access_token>","trace_id":"t1"}
```
Response:
```json
{"type":"auth_ok","user_id":"<uuid>","trace_id":"t1"}
```

### sub
```json
{"type":"sub","thread_id":"<thread_id>","trace_id":"t2"}
```
Response:
```json
{"type":"sub_ok","thread_id":"<thread_id>","trace_id":"t2"}
```

### msg
```json
{"type":"msg","thread_id":"<thread_id>","client_msg_id":"<uuid>","msg_type":"text","content":{"text":"hi"},"trace_id":"t3"}
```
Response:
```json
{"type":"ack","client_msg_id":"<uuid>","msg_id":"<uuid>","seq":12,"trace_id":"t3"}
```

### read
```json
{"type":"read","thread_id":"<thread_id>","last_read_seq":12,"trace_id":"t4"}
```
Response:
```json
{"type":"read_ok","thread_id":"<thread_id>","trace_id":"t4"}
```

## Metrics
- `/metrics` exposes Prometheus metrics

# IM Thread Model

## Thread Types
- `match`: one thread per `match_session_id`
- `order`: one thread per `order_id`
- `support`: internal support thread (no binding)

## Uniqueness Rules
- `match_session_id` is unique across threads
- `order_id` is unique across threads
- `support` threads have no external binding

## Lifecycle
- `active`: normal messaging
- `frozen`: temporary lock (e.g. dispute)
- `closed`: archived, no new messages

## Membership
- Members are stored in `chat_thread_members`
- `last_read_seq` is monotonic and updated via `/chat/threads/:id/read`
- Non-members must be rejected with `403`

## Auth
- IM APIs require Bearer access token (`AUTH_JWT_SECRET`)
- Legacy LeanCloud session tokens are not accepted for IM

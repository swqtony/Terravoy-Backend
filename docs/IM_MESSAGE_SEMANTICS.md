# IM Message Semantics

## Delivery Model
- At-least-once delivery from gateway to API.
- Client must de-duplicate by `client_msg_id`.

## Ordering
- `seq` is the canonical order within a thread.
- `seq` increments strictly via DB transaction on write.

## Idempotency
- Unique constraint: `(sender_id, client_msg_id)`.
- Retries return the existing `msg_id` and `seq`.

## Write Before Fanout
- Messages are committed to DB before fanout to recipients.
- Offline clients pull via `afterSeq`.

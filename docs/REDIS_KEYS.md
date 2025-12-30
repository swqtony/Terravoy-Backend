# Redis Key Spec (IM)

## Presence
- `im:online:{user_id}`
  - Type: string or hash (gateway managed)
  - TTL: 75s
  - Refresh: every 30s by gateway
  - Purpose: online presence check + push decision

## Rate Limit
- `im:rate:user:{user_id}`
  - Type: zset (sliding window)
  - TTL: windowMs + 1s
  - Default: 20 messages / 10s
  - Purpose: per-user send rate limit

- `im:rate:thread:{thread_id}`
  - Type: zset (sliding window)
  - TTL: windowMs + 1s
  - Default: 30 messages / 10s
  - Purpose: per-thread send rate limit

## Capacity Estimate
- Presence keys: ~active_online_users
- Rate-limit keys: ~active_senders within window (user + thread)
- Memory: each zset member is a timestamp; for 20-30 entries per key in 10s window

## Cleanup Strategy
- TTL-based cleanup only; no manual sweep required.
- Presence can be lost on restart and will self-heal via refresh.

# Observability

## Logs
- Server: JSON in production, pretty in dev.
- Gateway: JSON in production, pretty in dev.
- Trace ID: `x-trace-id` response header + `traceId` in JSON body.

## Server Metrics
- `http_request_duration_ms{method,route,status}`
- Default Node metrics via `prom-client`
- `/metrics` endpoint

## Gateway Metrics
- `im_gateway_connections`
- `im_gateway_msg_send_total`
- `im_gateway_msg_send_errors_total`
- `im_gateway_write_db_latency_ms`
- `/metrics` endpoint

## Troubleshooting
- Correlate API and gateway using `traceId`.
- Check Redis availability for rate limit/presence.
- Check push worker logs for DLQ activity (`im:push:dlq`).

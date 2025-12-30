# Observability (Go IM)

## Logs
- im-api/im-worker/im-gateway: JSON in production, pretty in dev
- Trace ID: `X-Trace-Id` header is propagated by im-api

## Metrics
- im-api: `im_api_http_duration_ms` + default Go metrics
- im-gateway: `im_gateway_connections`, `im_gateway_msg_send_total`, `im_gateway_msg_send_errors_total`, `im_gateway_write_db_latency_ms`
- im-api `/metrics`, im-gateway `/metrics`

## Troubleshooting
- Push failures: inspect `im:push:dlq`
- Rate limit: check Redis availability

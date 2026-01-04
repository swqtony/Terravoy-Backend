#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-im/docker-compose.im.yml}"

echo "Checking im-api metrics..."
docker compose -f "${COMPOSE_FILE}" exec -T im-api sh -c "wget -qO- http://localhost:8090/metrics | grep -E '^(db_write_latency_ms|messages_written_total)'" >/dev/null

echo "Checking im-gateway metrics..."
docker compose -f "${COMPOSE_FILE}" exec -T im-gateway sh -c "wget -qO- http://localhost:8081/metrics | grep -E '^(ws_connections|msg_in_total|msg_out_total|errors_total)'" >/dev/null

echo "PR7 verify done."

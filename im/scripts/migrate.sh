#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-im/docker-compose.im.yml}"
DB_SERVICE="${DB_SERVICE:-im-db}"

echo "Running IM migrations on ${DB_SERVICE}..."
docker compose -f "${COMPOSE_FILE}" exec -T "${DB_SERVICE}" psql \
  -U "${POSTGRES_USER:-terravoy}" \
  -d "${POSTGRES_DB:-terravoy}" \
  -f /migrations/0021_chat_threads.sql
docker compose -f "${COMPOSE_FILE}" exec -T "${DB_SERVICE}" psql \
  -U "${POSTGRES_USER:-terravoy}" \
  -d "${POSTGRES_DB:-terravoy}" \
  -f /migrations/0022_chat_messages.sql
docker compose -f "${COMPOSE_FILE}" exec -T "${DB_SERVICE}" psql \
  -U "${POSTGRES_USER:-terravoy}" \
  -d "${POSTGRES_DB:-terravoy}" \
  -f /migrations/0023_device_tokens.sql
echo "IM migrations done."

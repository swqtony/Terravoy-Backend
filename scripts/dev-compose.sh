#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${ROOT_DIR}" ]]; then
  ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
COMPOSE_BIN="docker compose"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Error: docker-compose.yml not found at ${COMPOSE_FILE}" >&2
  exit 1
fi

services="$(${COMPOSE_BIN} -f "${COMPOSE_FILE}" config --services 2>/dev/null || true)"
if [[ -z "${services}" ]]; then
  echo "Error: unable to read compose services. Is Docker running?" >&2
  exit 1
fi

require_service() {
  local name="$1"
  if ! echo "${services}" | grep -qx "${name}"; then
    echo "Error: compose service '${name}' not found in ${COMPOSE_FILE}" >&2
    exit 1
  fi
}

usage() {
  cat <<'EOF'
Usage: scripts/dev-compose.sh <command>

Commands:
  up        Build and start containers (detached)
  logs      Follow API/DB logs
  down      Stop and remove containers
  reset-db  Remove volumes and start fresh
  psql      Open psql inside DB container
EOF
}

cmd="${1:-}"
case "${cmd}" in
  up)
    require_service db
    require_service api
    ${COMPOSE_BIN} -f "${COMPOSE_FILE}" up -d --build
    ;;
  logs)
    require_service db
    require_service api
    ${COMPOSE_BIN} -f "${COMPOSE_FILE}" logs -f api db
    ;;
  down)
    ${COMPOSE_BIN} -f "${COMPOSE_FILE}" down
    ;;
  reset-db)
    require_service db
    require_service api
    ${COMPOSE_BIN} -f "${COMPOSE_FILE}" down -v
    ${COMPOSE_BIN} -f "${COMPOSE_FILE}" up -d --build
    echo "DB reset complete. If this is a fresh DB, run: ${COMPOSE_BIN} -f \"${COMPOSE_FILE}\" run --rm api npm run db:migrate"
    ;;
  psql)
    require_service db
    POSTGRES_USER="${POSTGRES_USER:-terravoy}"
    POSTGRES_DB="${POSTGRES_DB:-terravoy}"
    ${COMPOSE_BIN} -f "${COMPOSE_FILE}" exec db psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"
    ;;
  *)
    usage
    exit 1
    ;;
esac

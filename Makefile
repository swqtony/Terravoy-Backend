IM_COMPOSE=im/docker-compose.im.yml

.PHONY: im-up im-down im-migrate im-smoke

im-up:
\tdocker compose -f $(IM_COMPOSE) up -d --build

im-down:
\tdocker compose -f $(IM_COMPOSE) down

im-migrate:
\tIM_COMPOSE=$(IM_COMPOSE) im/scripts/migrate.sh

im-smoke:
\t@echo "Smoke tests are added in Phase 6"

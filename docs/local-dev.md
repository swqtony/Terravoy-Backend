Local Dev (Docker Compose)

Prereqs
- Docker Desktop or Docker Engine + Compose plugin

Quick start (after code changes)
- Build and start: `docker compose up --build`
- Detached (background): `docker compose up -d --build`

Worker (recommended: separate service)
- Start API + worker: `docker compose up -d --build api worker`
- Worker logs: `docker logs terravoy-worker --tail 200`
- Worker selfcheck: `docker exec terravoy-worker node scripts/worker_selfcheck.js`
- Local selfcheck (host): `node scripts/worker_selfcheck.js`
- Single-container mode (not recommended): set `ENABLE_MATCH_WORKER=1` for `api`

Worker verification (end-to-end)
- Trigger matching on two devices to create a pending session.
- Confirm worker logs include `worker.attached`.
- Verify DB: `select id, status, conversation_id from match_sessions order by created_at desc limit 5;`
- Confirm match-poll returns `conversationId` and frontend navigates to chat.

Database migrations
- Migrations live in `db/migrations`
- Apply migrations (container running): `docker compose exec api npm run db:migrate`

Why `--build`
- `--build` forces Docker to rebuild the API image, so code changes are included in the container.

Foreground vs background
- `docker compose up` attaches logs and occupies the terminal.
- `docker compose up -d` starts containers in the background and returns control to your shell.

Clean DB (remove volume)
- `docker compose down -v`
- This deletes the Postgres data volume `terravoy_pg`, so all local data is lost.
- After a reset, re-apply migrations before starting the API: `docker compose run --rm api npm run db:migrate`

Helper script
- `scripts/dev-compose.sh up`
- `scripts/dev-compose.sh logs`
- `scripts/dev-compose.sh down`
- `scripts/dev-compose.sh reset-db`
- `scripts/dev-compose.sh psql`

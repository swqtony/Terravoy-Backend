# DB Fix: NULL Composite Return From try_match/start_match

## Problem

`try_match` and `start_match` return a composite type (`match_sessions`).
When they `RETURN NULL`, `SELECT * FROM try_match(...)` yields **one row with all NULL columns**.
Node sees `rows[0]` as a truthy object, leading to `invalid_or_self_match` and waiting loops.

## Fix

- Change `try_match` to `RETURNS SETOF match_sessions`.
- Change `start_match` to `RETURNS SETOF match_sessions` and return the `try_match` result directly.
- Replace `RETURN NULL` with `RETURN;` (no rows).

Behavior after fix:
- No match: **0 rows** returned.
- Match: **1 row** with non-null `id`/profiles.

## Compatibility

Existing calls still work:

- `select * from public.try_match($1)`
- `select * from public.start_match(...)`

`rows.length` will be 0 when no match, 1 when matched.

## Rollback

Run `db/migrations/rollback_try_match_setof.sql` to restore previous definitions.

## Rollback Steps

1. `docker exec terravoy-db psql -U terravoy -d terravoy -f /path/to/rollback_try_match_setof.sql`
2. Confirm with `\df+ public.try_match` / `\df+ public.start_match`.

## How to apply migration

1. Apply `db/migrations/0006_try_match_setof_up.sql`:
   `docker exec terravoy-db psql -U terravoy -d terravoy -f /path/to/db/migrations/0006_try_match_setof_up.sql`
2. Verify with `db/verify/0006_try_match_setof_verify.sql`:
   `docker exec terravoy-db psql -U terravoy -d terravoy -f /path/to/db/verify/0006_try_match_setof_verify.sql`

## How to rollback

1. Apply `db/migrations/0006_try_match_setof_down.sql`:
   `docker exec terravoy-db psql -U terravoy -d terravoy -f /path/to/db/migrations/0006_try_match_setof_down.sql`
2. (Optional) Re-run verification SQL with expected legacy behavior.

## How to verify

- `try_match(non-waiting)` returns 0 rows.
- `start_match(A)` returns 0 rows when no peer is waiting.
- `start_match(B)` returns 1 row when a peer is waiting.
- Latest `match_sessions` has `conversation_id` once chat is attached.

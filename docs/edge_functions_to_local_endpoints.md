# Edge Functions → Local Endpoints

| Supabase Function | Local Method/Path | Handler File |
| --- | --- | --- |
| auth-supabase-login | POST `/functions/v1/auth-supabase-login` | server/src/routes/supabaseAuth.js |
| terra-auth | POST `/functions/v1/terra-auth` | server/src/routes/supabaseAuth.js |
| profile-bootstrap | POST `/functions/v1/profile-bootstrap` | server/src/routes/profile.js |
| profile-update | POST `/functions/v1/profile-update` | server/src/routes/profile.js |
| trip-card-create | POST `/functions/v1/trip-card-create` | server/src/routes/profile.js |
| match-start | POST `/functions/v1/match-start` | server/src/routes/match.js |
| match-poll | POST `/functions/v1/match-poll` | server/src/routes/match.js |
| match-cancel | POST `/functions/v1/match-cancel` | server/src/routes/match.js |
| match-attach-conversation | POST `/functions/v1/match-attach-conversation` | server/src/routes/match.js |
| match-get-partner | POST `/functions/v1/match-get-partner` | server/src/routes/match.js |
| preferences-update | POST `/functions/v1/preferences-update` (returns 501; schema缺失) | server/src/routes/profile.js |
| preferences-fetch | POST `/functions/v1/preferences-fetch` (returns 501; schema缺失) | server/src/routes/profile.js |
| orders (multiplex) | `/functions/v1/orders` with x-route/x-path，或直接 `/orders/...` | server/src/routes/orders.js |

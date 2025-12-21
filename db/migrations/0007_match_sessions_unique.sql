-- Ensure each request only appears in one session.

CREATE UNIQUE INDEX IF NOT EXISTS match_sessions_request_a_unique
  ON public.match_sessions (request_a_id)
  WHERE request_a_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS match_sessions_request_b_unique
  ON public.match_sessions (request_b_id)
  WHERE request_b_id IS NOT NULL;

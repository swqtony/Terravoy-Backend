ALTER TABLE public.match_sessions
  ADD COLUMN IF NOT EXISTS thread_id uuid;

CREATE INDEX IF NOT EXISTS match_sessions_thread_id_idx
  ON public.match_sessions (thread_id);

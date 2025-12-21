CREATE TABLE IF NOT EXISTS public.user_preferences (
  leancloud_user_id text PRIMARY KEY,
  match_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO api_role;

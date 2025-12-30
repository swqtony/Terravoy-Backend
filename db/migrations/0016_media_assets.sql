CREATE TABLE IF NOT EXISTS media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  mime_type text,
  size integer,
  owner_user_id text,
  scope text,
  visibility text NOT NULL DEFAULT 'public',
  provider text NOT NULL DEFAULT 'lean',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_assets_owner_idx
  ON media_assets (owner_user_id, created_at DESC);

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS ext text,
  ADD COLUMN IF NOT EXISTS mime text,
  ADD COLUMN IF NOT EXISTS size_bytes bigint,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE media_assets
  ADD CONSTRAINT IF NOT EXISTS media_assets_scope_check
    CHECK (scope IN ('post', 'experience', 'avatar', 'kyc')) NOT VALID,
  ADD CONSTRAINT IF NOT EXISTS media_assets_visibility_check
    CHECK (visibility IN ('public', 'private')) NOT VALID,
  ADD CONSTRAINT IF NOT EXISTS media_assets_status_check
    CHECK (status IN ('active', 'rejected')) NOT VALID,
  ADD CONSTRAINT IF NOT EXISTS media_assets_object_key_present
    CHECK (object_key IS NOT NULL) NOT VALID,
  ADD CONSTRAINT IF NOT EXISTS media_assets_owner_present
    CHECK (owner_user_id IS NOT NULL) NOT VALID,
  ADD CONSTRAINT IF NOT EXISTS media_assets_ext_present
    CHECK (ext IS NOT NULL) NOT VALID,
  ADD CONSTRAINT IF NOT EXISTS media_assets_mime_present
    CHECK (mime IS NOT NULL) NOT VALID,
  ADD CONSTRAINT IF NOT EXISTS media_assets_size_bytes_present
    CHECK (size_bytes IS NOT NULL) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS media_assets_object_key_unique
  ON media_assets (object_key);

CREATE INDEX IF NOT EXISTS media_assets_owner_scope_idx
  ON media_assets (owner_user_id, scope);

CREATE TABLE IF NOT EXISTS media_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  ip text,
  action text NOT NULL CHECK (action IN ('upload_url', 'complete', 'admin_read_url')),
  object_key text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

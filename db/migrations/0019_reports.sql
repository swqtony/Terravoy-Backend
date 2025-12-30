CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('chat', 'post', 'experience', 'user')),
  target_id text NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('spam', 'scam', 'harassment', 'illegal', 'other')),
  description text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'resolved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reports_target_idx
  ON reports (target_type, target_id);

CREATE INDEX IF NOT EXISTS reports_reporter_idx
  ON reports (reporter_id, created_at DESC);

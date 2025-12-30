CREATE TABLE IF NOT EXISTS host_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('draft', 'submitted', 'reviewing', 'approved', 'rejected')),
  version integer NOT NULL DEFAULT 1,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_id text,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS host_certifications_status_submitted_idx
  ON host_certifications (status, submitted_at);

CREATE INDEX IF NOT EXISTS host_certifications_user_idx
  ON host_certifications (user_id);

CREATE TABLE IF NOT EXISTS host_certification_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL,
  actor_id text,
  action text NOT NULL CHECK (
    action IN (
      'draft_saved',
      'submitted',
      'set_reviewing',
      'approved',
      'rejected',
      'doc_added',
      'doc_removed'
    )
  ),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS host_certification_audit_logs_cert_idx
  ON host_certification_audit_logs (certification_id, created_at);

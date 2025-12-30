-- Experience + Discover tables

CREATE TABLE IF NOT EXISTS experiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  host_user_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  meeting_point text NOT NULL DEFAULT '',
  languages jsonb NOT NULL DEFAULT '[]'::jsonb,
  category text NOT NULL DEFAULT '',
  duration_minutes integer NOT NULL DEFAULT 120,
  availability jsonb NOT NULL DEFAULT '[]'::jsonb,
  min_guests integer NOT NULL DEFAULT 1,
  max_guests integer NOT NULL DEFAULT 8,
  min_advance_hours integer NOT NULL DEFAULT 24,
  cutoff_hours integer NOT NULL DEFAULT 12,
  price_per_guest integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'CNY',
  cancellation_policy text NOT NULL DEFAULT 'flexible',
  cover_image_url text NOT NULL DEFAULT '',
  gallery_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  safety_notes text NOT NULL DEFAULT '',
  meetup_notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  rejection_reason text,
  completed_orders integer NOT NULL DEFAULT 0,
  has_active_orders boolean NOT NULL DEFAULT false,
  rating double precision NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0,
  score double precision NOT NULL DEFAULT 0,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  host_name text NOT NULL DEFAULT '',
  host_avatar_url text NOT NULL DEFAULT '',
  host_verified boolean NOT NULL DEFAULT false,
  host_cert_status text,
  age_restriction jsonb
);

CREATE INDEX IF NOT EXISTS experiences_host_user_updated_idx
  ON experiences (host_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS experiences_status_city_score_updated_idx
  ON experiences (status, city, score DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS experiences_status_updated_idx
  ON experiences (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS discover_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id text NOT NULL,
  author_name text NOT NULL DEFAULT '',
  author_avatar_url text NOT NULL DEFAULT '',
  city text,
  content text NOT NULL DEFAULT '',
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  video jsonb,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  like_count integer NOT NULL DEFAULT 0,
  comment_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'published',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discover_posts_created_id_idx
  ON discover_posts (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS discover_post_likes (
  post_id uuid NOT NULL REFERENCES discover_posts(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS discover_post_likes_post_idx
  ON discover_post_likes (post_id);

CREATE TABLE IF NOT EXISTS discover_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES discover_posts(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  author_name text NOT NULL DEFAULT '',
  author_avatar_url text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'published',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discover_comments_post_created_idx
  ON discover_comments (post_id, created_at ASC, id ASC);

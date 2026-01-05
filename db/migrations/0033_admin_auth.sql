-- Admin auth tables
create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references admin_users(id) on delete cascade,
  refresh_token_hash text not null,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz,
  ip text,
  ua text,
  device_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_sessions_refresh_hash on admin_sessions(refresh_token_hash);
create index if not exists idx_admin_sessions_admin_user_id on admin_sessions(admin_user_id);

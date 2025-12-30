-- Auth SMS + sessions (self-hosted)
create table if not exists auth_users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  created_at timestamptz not null default now(),
  status int not null default 1
);

create table if not exists auth_sms_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists auth_sms_codes_phone_created_at_idx
  on auth_sms_codes (phone, created_at desc);

create index if not exists auth_sms_codes_phone_expires_at_idx
  on auth_sms_codes (phone, expires_at);

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth_users(id),
  refresh_token_hash text not null,
  refresh_expires_at timestamptz not null,
  device_id text null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create index if not exists auth_sessions_user_id_revoked_idx
  on auth_sessions (user_id, revoked_at);

create index if not exists auth_sessions_refresh_token_hash_idx
  on auth_sessions (refresh_token_hash);

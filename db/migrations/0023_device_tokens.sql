create table if not exists device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  platform text not null,
  token text not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists device_tokens_platform_token_idx
  on device_tokens (platform, token);

create unique index if not exists device_tokens_user_platform_idx
  on device_tokens (user_id, platform);

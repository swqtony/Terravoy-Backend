-- Store profile avatar for self-hosted profile bootstrap/update
alter table if exists public.profiles
  add column if not exists avatar_url text;

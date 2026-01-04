-- Persist match profile interests for self-hosted profile bootstrap/update
alter table if exists public.profiles
  add column if not exists interests text[];

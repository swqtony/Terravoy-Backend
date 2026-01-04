-- Persist communicable languages list for match profile
alter table if exists public.profiles
  add column if not exists communicable_languages text[];

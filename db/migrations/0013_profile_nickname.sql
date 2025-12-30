-- Add nickname to profiles for self-hosted auth profile updates
alter table if exists public.profiles
  add column if not exists nickname text;

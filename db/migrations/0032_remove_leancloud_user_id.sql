begin;

delete from public.user_preferences
where leancloud_user_id is not null
  and leancloud_user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

alter table public.user_preferences
  rename column leancloud_user_id to user_id;

alter table public.user_preferences
  alter column user_id type uuid using user_id::uuid;

alter table public.profiles
  drop constraint if exists profiles_leancloud_user_id_key;

drop index if exists public.profiles_leancloud_user_id_unique;

alter table public.profiles
  drop column if exists leancloud_user_id;

drop function if exists public.ensure_profile_v2(text, uuid);

create function public.ensure_profile_v2(p_user_id text, p_supabase_user_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  existing_id uuid;
  target_id uuid;
begin
  if p_supabase_user_id is not null then
    target_id := p_supabase_user_id;
  else
    if p_user_id is null or length(trim(p_user_id)) = 0 then
      raise exception 'USER_ID_REQUIRED';
    end if;
    begin
      target_id := p_user_id::uuid;
    exception when others then
      raise exception 'USER_ID_REQUIRED';
    end;
  end if;

  select id into existing_id
  from public.profiles
  where id = target_id
  limit 1;
  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.profiles (id, is_completed)
  values (target_id, false)
  on conflict (id) do update
    set id = excluded.id
  returning id into existing_id;

  return existing_id;
end;
$$;

comment on function public.ensure_profile_v2(p_user_id text, p_supabase_user_id uuid)
  is 'Ensure a profile exists for the given user id (supabase uuid); returns profile id with is_completed unchanged.';

commit;

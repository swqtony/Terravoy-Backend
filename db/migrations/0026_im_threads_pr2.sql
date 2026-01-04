alter table chat_threads
  drop constraint if exists chat_threads_match_order_check,
  drop constraint if exists chat_threads_type_check,
  drop constraint if exists chat_threads_status_check,
  drop constraint if exists chat_threads_sync_policy_check;

alter table chat_thread_members
  drop constraint if exists chat_thread_members_role_check;

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'chat_threads' and column_name = 'type') then
    if exists (select 1 from information_schema.columns where table_name = 'chat_threads' and column_name = 'type' and udt_name = 'chat_thread_type') then
      alter table chat_threads alter column type type text using type::text;
    end if;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'chat_threads' and column_name = 'status') then
    if exists (select 1 from information_schema.columns where table_name = 'chat_threads' and column_name = 'status' and udt_name = 'chat_thread_status') then
      alter table chat_threads alter column status type text using status::text;
    end if;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'chat_thread_members' and column_name = 'role') then
    if exists (select 1 from information_schema.columns where table_name = 'chat_thread_members' and column_name = 'role' and udt_name = 'chat_member_role') then
      alter table chat_thread_members alter column role type text using role::text;
    end if;
  end if;
end$$;

alter table chat_threads
  add column if not exists retention_days int,
  add column if not exists sync_policy text;

update chat_threads
set retention_days = case
  when type = 'match' then 14
  when type = 'order' then 180
  else 14
end
where retention_days is null;

update chat_threads
set sync_policy = 'local_first'
where sync_policy is null;

alter table chat_threads
  alter column retention_days set not null,
  alter column sync_policy set not null;

alter table chat_threads
  add constraint chat_threads_type_check check (type in ('match', 'order')),
  add constraint chat_threads_status_check check (status in ('active', 'frozen', 'closed')),
  add constraint chat_threads_sync_policy_check check (sync_policy in ('local_first', 'server_authoritative')),
  add constraint chat_threads_match_order_check check (
    (type = 'match' and match_session_id is not null and order_id is null) or
    (type = 'order' and order_id is not null and match_session_id is null)
  );

alter table chat_thread_members
  add constraint chat_thread_members_role_check check (role in ('traveler', 'host'));

alter table chat_thread_members
  drop column if exists updated_at;

alter table chat_threads
  alter column status set default 'active';

drop type if exists chat_thread_type;
drop type if exists chat_thread_status;
drop type if exists chat_member_role;

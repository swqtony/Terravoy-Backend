do $$
begin
  if not exists (select 1 from pg_type where typname = 'chat_thread_type') then
    create type chat_thread_type as enum ('match', 'order', 'support');
  end if;
  if not exists (select 1 from pg_type where typname = 'chat_thread_status') then
    create type chat_thread_status as enum ('active', 'frozen', 'closed');
  end if;
  if not exists (select 1 from pg_type where typname = 'chat_member_role') then
    create type chat_member_role as enum ('traveler', 'host');
  end if;
end$$;

create table if not exists chat_threads (
  id uuid primary key default gen_random_uuid(),
  type chat_thread_type not null,
  match_session_id uuid unique,
  order_id uuid unique,
  status chat_thread_status not null default 'active',
  last_seq bigint not null default 0,
  last_message_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_threads_match_order_check check (
    (type = 'match' and match_session_id is not null and order_id is null) or
    (type = 'order' and order_id is not null and match_session_id is null) or
    (type = 'support' and order_id is null and match_session_id is null)
  )
);

create index if not exists chat_threads_match_session_id_idx
  on chat_threads (match_session_id);

create index if not exists chat_threads_order_id_idx
  on chat_threads (order_id);

create table if not exists chat_thread_members (
  thread_id uuid not null references chat_threads(id) on delete cascade,
  user_id uuid not null,
  role chat_member_role not null,
  last_read_seq bigint not null default 0,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists chat_thread_members_user_id_idx
  on chat_thread_members (user_id);

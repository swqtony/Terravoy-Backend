do $$
begin
  if not exists (select 1 from pg_type where typname = 'chat_message_type') then
    create type chat_message_type as enum ('text', 'image', 'system', 'order_event');
  end if;
end$$;

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  sender_id uuid not null,
  client_msg_id uuid not null,
  seq bigint not null,
  type chat_message_type not null,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists chat_messages_sender_client_idx
  on chat_messages (sender_id, client_msg_id);

create index if not exists chat_messages_thread_seq_idx
  on chat_messages (thread_id, seq desc);

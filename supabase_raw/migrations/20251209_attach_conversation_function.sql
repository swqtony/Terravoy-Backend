-- Drop any legacy overloads to avoid duplicate name conflicts.
do $$
declare
  sig text;
begin
  for sig in
    select oid::regprocedure::text
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'attach_conversation_to_session'
  loop
    execute 'drop function if exists ' || sig;
  end loop;
end $$;

-- Create/replace RPC used by edge function `match-attach-conversation`.
create or replace function public.attach_conversation_to_session(
  p_session_id uuid,
  p_conversation_id text,
  p_force boolean default false
)
returns match_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  result match_sessions;
begin
  update match_sessions
  set conversation_id = case
    when p_force then p_conversation_id
    else coalesce(conversation_id, p_conversation_id)
  end
  where id = p_session_id
  returning * into result;

  if result is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  return result;
end;
$$;

comment on function public.attach_conversation_to_session(uuid, text, boolean) is
  'Attach (or reuse existing) conversation_id to a match_session and return the row.';

-- 0006_try_match_setof_verify.sql
-- Replace the UUIDs below with real values from your environment.

-- 1) try_match with a non-waiting request should return 0 rows.
-- Example uses a matched request.
select id, profile_a_id
from public.try_match('f3472ccf-a068-4ef8-a562-71b413bb5e07');

-- 2) start_match(A) should return 0 rows when no peer is waiting.
-- Replace with valid profile_id + trip_card_id.
select id, profile_a_id, profile_b_id
from public.start_match(
  '90df8b66-802a-43cb-b413-1672e1d02d43',
  '0ddaaa60-16c2-4d81-8b85-d5f8a33c8d10',
  NULL, NULL, NULL, NULL, 'Strict'
);

-- 3) start_match(B) should return 1 row with non-null ids when a peer is waiting.
select id, profile_a_id, profile_b_id, request_a_id, request_b_id
from public.start_match(
  '82bc70e3-2d9d-4b90-9eb9-ffc0f14e3672',
  '092c76c7-b3fa-48e8-947d-0c5c6bf3327d',
  NULL, NULL, NULL, NULL, 'Strict'
);

-- 4) Latest match sessions should have conversation_id once chat is attached.
select id, status, conversation_id
from public.match_sessions
order by created_at desc
limit 5;

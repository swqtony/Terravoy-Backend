-- 0006_try_match_setof_up.sql
-- Convert try_match/start_match to SETOF to avoid NULL composite rows.

DROP FUNCTION IF EXISTS public.start_match(uuid, uuid, text, integer, integer, text[], text);
DROP FUNCTION IF EXISTS public.try_match(uuid);

CREATE OR REPLACE FUNCTION public.try_match(p_request_id uuid)
RETURNS SETOF public.match_sessions
LANGUAGE plpgsql
AS $$
DECLARE
  req_a   public.match_requests%rowtype;
  trip_a  public.trip_cards%rowtype;
  prof_a  public.profiles%rowtype;

  req_b   public.match_requests%rowtype;
  trip_b  public.trip_cards%rowtype;
  prof_b  public.profiles%rowtype;

  sess    public.match_sessions%rowtype;
BEGIN
  -- Expire stale waiting requests.
  UPDATE public.match_requests
  SET status = 'expired',
      expired_at = now()
  WHERE status = 'waiting'
    AND expires_at < now();

  -- Load A request if still fresh.
  SELECT *
  INTO req_a
  FROM public.match_requests
  WHERE id = p_request_id
    AND status = 'waiting'
    AND expires_at >= now();

  IF req_a.id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO trip_a FROM public.trip_cards WHERE id = req_a.trip_card_id;
  SELECT * INTO prof_a FROM public.profiles WHERE id = req_a.profile_id;

  -- Find B: fresh waiting request, ordered by most recent heartbeat.
  SELECT mr.*
  INTO req_b
  FROM public.match_requests mr
  JOIN public.trip_cards tc ON tc.id = mr.trip_card_id
  JOIN public.profiles pf ON pf.id = mr.profile_id
  WHERE
    mr.status = 'waiting'
    AND mr.expires_at >= now()
    AND mr.id <> req_a.id
    AND mr.profile_id <> req_a.profile_id
    AND tc.destination_city = trip_a.destination_city
    AND daterange(tc.start_date, tc.end_date, '[]')
        && daterange(trip_a.start_date, trip_a.end_date, '[]')
    AND (
      req_a.preferred_gender IS NULL
      OR req_a.preferred_gender = 'any'
      OR req_a.preferred_gender = pf.gender
    )
    AND (
      req_a.preferred_age_min IS NULL
      OR pf.age IS NULL
      OR pf.age >= req_a.preferred_age_min
    )
    AND (
      req_a.preferred_age_max IS NULL
      OR pf.age IS NULL
      OR pf.age <= req_a.preferred_age_max
    )
    AND (
      mr.preferred_gender IS NULL
      OR mr.preferred_gender = 'any'
      OR mr.preferred_gender = prof_a.gender
    )
    AND (
      mr.preferred_age_min IS NULL
      OR prof_a.age IS NULL
      OR prof_a.age >= mr.preferred_age_min
    )
    AND (
      mr.preferred_age_max IS NULL
      OR prof_a.age IS NULL
      OR prof_a.age <= mr.preferred_age_max
    )
  ORDER BY mr.last_seen_at DESC, mr.created_at DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF req_b.id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO trip_b FROM public.trip_cards WHERE id = req_b.trip_card_id;
  SELECT * INTO prof_b FROM public.profiles WHERE id = req_b.profile_id;

  INSERT INTO public.match_sessions (
    profile_a_id, profile_b_id,
    request_a_id, request_b_id,
    trip_card_a_id, trip_card_b_id,
    status
  ) VALUES (
    req_a.profile_id, req_b.profile_id,
    req_a.id, req_b.id,
    req_a.trip_card_id, req_b.trip_card_id,
    'pending'
  )
  RETURNING * INTO sess;

  UPDATE public.match_requests
  SET status = 'matched',
      matched_at = now()
  WHERE id IN (req_a.id, req_b.id);

  RETURN NEXT sess;
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_match(
  p_profile_id uuid,
  p_trip_card_id uuid,
  p_preferred_gender text DEFAULT NULL::text,
  p_preferred_age_min integer DEFAULT NULL::integer,
  p_preferred_age_max integer DEFAULT NULL::integer,
  p_preferred_languages text[] DEFAULT NULL::text[],
  p_city_scope_mode text DEFAULT 'Strict'::text
) RETURNS SETOF public.match_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  req public.match_requests%rowtype;
BEGIN
  -- 0. Cancel any previous waiting requests for this profile.
  UPDATE public.match_requests
  SET status = 'cancelled',
      cancelled_at = now()
  WHERE profile_id = p_profile_id
    AND status = 'waiting';

  -- 1. Create a new match request with fresh heartbeat.
  INSERT INTO public.match_requests (
    profile_id,
    trip_card_id,
    preferred_gender,
    preferred_age_min,
    preferred_age_max,
    preferred_languages,
    city_scope_mode,
    last_seen_at,
    expires_at
  ) VALUES (
    p_profile_id,
    p_trip_card_id,
    p_preferred_gender,
    p_preferred_age_min,
    p_preferred_age_max,
    p_preferred_languages,
    COALESCE(p_city_scope_mode, 'Strict'),
    now(),
    now() + interval '60 seconds'
  )
  RETURNING * INTO req;

  -- 2. Try match immediately; return its rows.
  RETURN QUERY SELECT * FROM public.try_match(req.id);
END;
$$;

GRANT ALL ON FUNCTION public.try_match(uuid) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.start_match(uuid, uuid, text, integer, integer, text[], text) TO anon, authenticated, service_role;

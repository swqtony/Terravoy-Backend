-- Resolve ensure_profile overload conflicts by introducing a single RPC name.

-- Drop legacy ensure_profile overloads to avoid PGRST203 ambiguity.
DROP FUNCTION IF EXISTS public.ensure_profile();
DROP FUNCTION IF EXISTS public.ensure_profile(text);
DROP FUNCTION IF EXISTS public.ensure_profile(uuid);
DROP FUNCTION IF EXISTS public.ensure_profile(uuid, text);
DROP FUNCTION IF EXISTS public.ensure_profile(text, uuid);
DROP FUNCTION IF EXISTS public.ensure_profile(text, uuid, text);

-- Keep leancloud_user_id unique for deterministic lookups.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_leancloud_user_id_key'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_leancloud_user_id_key UNIQUE (leancloud_user_id);
  END IF;
END $$;

-- New canonical RPC: ensure_profile_v2
CREATE OR REPLACE FUNCTION public.ensure_profile_v2(
  p_leancloud_user_id text,
  p_supabase_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_id uuid;
BEGIN
  IF p_leancloud_user_id IS NULL OR length(trim(p_leancloud_user_id)) = 0 THEN
    RAISE EXCEPTION 'LEAN_USER_ID_REQUIRED';
  END IF;

  SELECT id INTO existing_id
  FROM public.profiles
  WHERE leancloud_user_id = p_leancloud_user_id
  LIMIT 1;
  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  IF p_supabase_user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET leancloud_user_id = p_leancloud_user_id
    WHERE id = p_supabase_user_id
    RETURNING id INTO existing_id;
    IF existing_id IS NOT NULL THEN
      RETURN existing_id;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, leancloud_user_id, is_completed)
  VALUES (COALESCE(p_supabase_user_id, gen_random_uuid()), p_leancloud_user_id, false)
  ON CONFLICT (leancloud_user_id) DO UPDATE
    SET leancloud_user_id = EXCLUDED.leancloud_user_id
  RETURNING id INTO existing_id;

  RETURN existing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile_v2(text, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.ensure_profile_v2(text, uuid) IS
  'Ensure a profile exists for the given LeanCloud user; returns profile id with is_completed unchanged (defaults false).';

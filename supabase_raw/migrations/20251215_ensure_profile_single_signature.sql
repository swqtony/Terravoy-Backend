-- Normalize ensure_profile to a single signature returning uuid and enforce leancloud_user_id uniqueness.

-- Drop any legacy overloads to avoid PGRST203 ambiguity.
DROP FUNCTION IF EXISTS public.ensure_profile();
DROP FUNCTION IF EXISTS public.ensure_profile(text);
DROP FUNCTION IF EXISTS public.ensure_profile(uuid);
DROP FUNCTION IF EXISTS public.ensure_profile(uuid, text);
DROP FUNCTION IF EXISTS public.ensure_profile(text, uuid);
DROP FUNCTION IF EXISTS public.ensure_profile(text, uuid, text);

-- Ensure unique constraint on leancloud_user_id for deterministic lookups.
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

-- Create the single canonical ensure_profile signature.
CREATE OR REPLACE FUNCTION public.ensure_profile(
  p_leancloud_user_id text,
  p_supabase_user_id uuid DEFAULT NULL
)
RETURNS uuid
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

  -- Prefer existing profile keyed by LeanCloud id.
  SELECT id INTO existing_id
  FROM public.profiles
  WHERE leancloud_user_id = p_leancloud_user_id
  LIMIT 1;
  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  -- If a Supabase user exists, bind the LeanCloud id to that row.
  IF p_supabase_user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET leancloud_user_id = p_leancloud_user_id
    WHERE id = p_supabase_user_id
    RETURNING id INTO existing_id;
    IF existing_id IS NOT NULL THEN
      RETURN existing_id;
    END IF;
  END IF;

  -- Insert a new profile otherwise.
  INSERT INTO public.profiles (id, leancloud_user_id)
  VALUES (COALESCE(p_supabase_user_id, gen_random_uuid()), p_leancloud_user_id)
  ON CONFLICT (leancloud_user_id) DO UPDATE
    SET leancloud_user_id = EXCLUDED.leancloud_user_id
  RETURNING id INTO existing_id;

  RETURN existing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile(text, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.ensure_profile(text, uuid) IS
  'Ensure a profile exists for the given LeanCloud user id and optionally tie it to a Supabase user id. Returns profile id.';

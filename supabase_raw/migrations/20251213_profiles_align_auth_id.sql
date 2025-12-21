-- Align profiles schema with auth.users by using profiles.id = auth.users.id (Scheme A)
-- and ensure ensure_profile uses the correct columns.

-- Ensure leancloud_user_id column exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'leancloud_user_id'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN leancloud_user_id text;
  END IF;
END $$;

-- Ensure primary key on id and foreign key to auth.users (id).
DO $$
BEGIN
  -- Make sure id column exists.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'id'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN id uuid DEFAULT gen_random_uuid();
  END IF;

  -- Ensure primary key on id.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.profiles ADD PRIMARY KEY (id);
  END IF;

  -- Drop any legacy FK so we can clean and reapply.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
  END IF;
END $$;

-- Clean orphan profiles (ids not in auth.users) before re-adding FK.
DELETE FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users u WHERE u.id = p.id
);

-- Re-apply FK to auth.users(id).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND confrelid = 'auth.users'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_id_fkey
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Ensure unique constraint on leancloud_user_id for idempotent upsert.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'u'
      AND conname = 'profiles_leancloud_user_id_key'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_leancloud_user_id_key UNIQUE (leancloud_user_id);
  END IF;
END $$;

-- ensure_profile RPC: create or reuse profile keyed by leancloud_user_id and/or supabase user id.
CREATE OR REPLACE FUNCTION public.ensure_profile(
  p_leancloud_user_id text,
  p_supabase_user_id uuid DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prof public.profiles%rowtype;
  target_id uuid;
BEGIN
  IF p_leancloud_user_id IS NULL OR length(trim(p_leancloud_user_id)) = 0 THEN
    RAISE EXCEPTION 'LEAN_USER_ID_REQUIRED';
  END IF;

  -- Prefer existing profile by leancloud_user_id.
  SELECT * INTO prof
  FROM public.profiles
  WHERE leancloud_user_id = p_leancloud_user_id
  LIMIT 1;

  -- If not found, try by supplied supabase user id (for profiles already created via auth).
  IF prof.id IS NULL AND p_supabase_user_id IS NOT NULL THEN
    SELECT * INTO prof
    FROM public.profiles
    WHERE id = p_supabase_user_id
    LIMIT 1;
  END IF;

  target_id := COALESCE(prof.id, p_supabase_user_id, gen_random_uuid());

  -- Insert or update leancloud_user_id to target profile id.
  INSERT INTO public.profiles (id, leancloud_user_id)
  VALUES (target_id, p_leancloud_user_id)
  ON CONFLICT (leancloud_user_id) DO UPDATE
    SET leancloud_user_id = EXCLUDED.leancloud_user_id
  RETURNING * INTO prof;

  -- If the row existed by leancloud_user_id but id differs from supplied user id,
  -- keep the existing id to avoid breaking FKs.

  RETURN prof;
END;
$$;

COMMENT ON FUNCTION public.ensure_profile(text, uuid) IS
  'Ensure a profile exists for the given LeanCloud user; uses profiles.id = auth.users.id (Scheme A).';

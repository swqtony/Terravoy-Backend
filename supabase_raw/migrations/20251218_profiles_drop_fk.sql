-- Decouple profiles.id from auth.users to allow LeanCloud-only profiles.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Ensure profiles.id still auto-generates when not provided.
ALTER TABLE public.profiles
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

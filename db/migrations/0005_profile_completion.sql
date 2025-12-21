-- Deduplicate profiles by leancloud_user_id (keep most recent by created_at)
WITH ranked AS (
  SELECT id,
         leancloud_user_id,
         ROW_NUMBER() OVER (
           PARTITION BY leancloud_user_id
           ORDER BY created_at DESC
         ) AS rn
  FROM public.profiles
)
DELETE FROM public.profiles
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Ensure unique leancloud_user_id (data-level guard)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_leancloud_user_id_unique
  ON public.profiles (leancloud_user_id);

-- Enforce completion consistency when is_completed is true
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_completed_fields_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_completed_fields_check
      CHECK (
        is_completed = false OR (
          gender IS NOT NULL AND btrim(gender) <> '' AND
          age IS NOT NULL AND age >= 18 AND age <= 120 AND
          first_language IS NOT NULL AND btrim(first_language) <> '' AND
          second_language IS NOT NULL AND btrim(second_language) <> '' AND
          home_city IS NOT NULL AND btrim(home_city) <> ''
        )
      );
  END IF;
END $$;

-- Validate questionnaire updates and set completion flag consistently.
CREATE OR REPLACE FUNCTION public.update_profile_from_questionnaire(
  p_profile_id uuid,
  p_gender text,
  p_age integer,
  p_first_language text,
  p_second_language text,
  p_home_city text
) RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  prof public.profiles%rowtype;
  v_gender text := btrim(coalesce(p_gender, ''));
  v_first text := btrim(coalesce(p_first_language, ''));
  v_second text := btrim(coalesce(p_second_language, ''));
  v_home text := btrim(coalesce(p_home_city, ''));
BEGIN
  IF v_gender = '' THEN
    RAISE EXCEPTION 'INVALID_FIELD:gender';
  END IF;
  IF p_age IS NULL OR p_age < 18 OR p_age > 120 THEN
    RAISE EXCEPTION 'INVALID_FIELD:age';
  END IF;
  IF v_first = '' THEN
    RAISE EXCEPTION 'INVALID_FIELD:firstLanguage';
  END IF;
  IF v_second = '' THEN
    RAISE EXCEPTION 'INVALID_FIELD:secondLanguage';
  END IF;
  IF v_home = '' THEN
    RAISE EXCEPTION 'INVALID_FIELD:homeCity';
  END IF;

  UPDATE public.profiles
  SET
    gender = v_gender,
    age = p_age,
    first_language = v_first,
    second_language = v_second,
    home_city = v_home,
    is_completed = true
  WHERE id = p_profile_id
  RETURNING * INTO prof;

  RETURN prof;
END;
$$;

GRANT ALL ON FUNCTION public.update_profile_from_questionnaire(uuid, text, integer, text, text, text) TO anon, authenticated, service_role;

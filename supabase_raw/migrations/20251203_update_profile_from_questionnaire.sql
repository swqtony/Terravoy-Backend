-- Create or replace function to update a profile from questionnaire responses.
create or replace function public.update_profile_from_questionnaire(
  p_profile_id uuid,
  p_gender text,
  p_age integer,
  p_first_language text,
  p_second_language text,
  p_home_city text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  prof public.profiles%rowtype;
begin
  update public.profiles
  set
    gender = p_gender,
    age = p_age,
    first_language = p_first_language,
    second_language = p_second_language,
    home_city = p_home_city,
    is_completed = true
  where id = p_profile_id
  returning * into prof;

  return prof;
end;
$$;

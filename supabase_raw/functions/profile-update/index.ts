import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { supabase } from "../_shared/supabaseClient.ts";
import {
  badRequest,
  handleOptions,
  jsonResponse,
  serverError,
} from "../_shared/responses.ts";

type ProfileRow = {
  id: string;
};

serve(async (req: Request) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return badRequest("Method not allowed", 405);
  }

  try {
    const {
      profileId,
      gender,
      age,
      firstLanguage,
      secondLanguage,
      homeCity,
    } = await req.json();

    if (!profileId || typeof profileId !== "string") {
      return badRequest("profileId is required");
    }

    if (!gender || typeof gender !== "string") {
      return badRequest("gender is required");
    }

    if (typeof age !== "number") {
      return badRequest("age is required");
    }

    if (!firstLanguage || typeof firstLanguage !== "string") {
      return badRequest("firstLanguage is required");
    }

    if (!secondLanguage || typeof secondLanguage !== "string") {
      return badRequest("secondLanguage is required");
    }

    if (!homeCity || typeof homeCity !== "string") {
      return badRequest("homeCity is required");
    }

    const { data, error } = await supabase.rpc(
      "update_profile_from_questionnaire",
      {
        p_profile_id: profileId,
        p_gender: gender,
        p_age: age,
        p_first_language: firstLanguage,
        p_second_language: secondLanguage,
        p_home_city: homeCity,
      },
    );

    if (error) {
      return serverError(error);
    }

    const updated = data as ProfileRow | null;

    return jsonResponse({
      success: true,
      data: {
        profileId: updated?.id ?? profileId,
      },
    });
  } catch (err) {
    return serverError(err);
  }
});


import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { supabase } from "../_shared/supabaseClient.ts";
import {
  badRequest,
  handleOptions,
  jsonResponse,
  serverError,
} from "../_shared/responses.ts";

serve(async (req: Request) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return badRequest("Method not allowed", 405);
  }

  try {
    const {
      profileId,
      destinationCity,
      destinationCountry = null,
      startDate,
      endDate,
    } = await req.json();

    if (!profileId || typeof profileId !== "string") {
      return badRequest("profileId is required");
    }
    if (!destinationCity || typeof destinationCity !== "string") {
      return badRequest("destinationCity is required");
    }
    if (!startDate || typeof startDate !== "string") {
      return badRequest("startDate is required (ISO string)");
    }
    if (!endDate || typeof endDate !== "string") {
      return badRequest("endDate is required (ISO string)");
    }

    const { data, error } = await supabase
      .from("trip_cards")
      .insert({
        profile_id: profileId,
        destination_city: destinationCity,
        destination_country: destinationCountry,
        start_date: startDate,
        end_date: endDate,
      })
      .select()
      .single();

    if (error) {
      return serverError(error);
    }

    return jsonResponse({ success: true, data });
  } catch (err) {
    return serverError(err);
  }
});

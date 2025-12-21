import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { supabase } from "../_shared/supabaseClient.ts";
import {
  badRequest,
  handleOptions,
  jsonResponse,
  serverError,
} from "../_shared/responses.ts";
import {
  issueTerraToken,
  TERRA_TOKEN_TTL_SECONDS,
  TerraRole,
} from "../_shared/terra.ts";

serve(async (req: Request) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return badRequest("Method not allowed", 405);
  }

  try {
    const {
      leancloudUserId,
      role,
      phone = null,
      sessionToken = null,
      expiresInSeconds = TERRA_TOKEN_TTL_SECONDS,
    } = await req.json();

    if (!leancloudUserId || typeof leancloudUserId !== "string") {
      return badRequest("leancloudUserId is required");
    }

    if (role !== "traveler" && role !== "host") {
      return badRequest("role must be traveler or host");
    }

    if (
      phone !== null &&
      phone !== undefined &&
      typeof phone !== "string"
    ) {
      return badRequest("phone must be string when provided");
    }

    if (
      expiresInSeconds !== undefined &&
      expiresInSeconds !== null &&
      typeof expiresInSeconds !== "number"
    ) {
      return badRequest("expiresInSeconds must be a number");
    }

    const { error: ensureError } = await supabase.rpc("ensure_profile_v2", {
      p_leancloud_user_id: leancloudUserId,
    });
    if (ensureError) {
      return serverError(ensureError);
    }

    // sessionToken reserved for future LeanCloud validation.
    const issued = await issueTerraToken({
      leancloudUserId,
      role: role as TerraRole,
      phone: typeof phone === "string" ? phone : null,
      expiresInSeconds: expiresInSeconds ?? TERRA_TOKEN_TTL_SECONDS,
    });

    return jsonResponse({
      success: true,
      data: {
        terraToken: issued.token,
        expiresIn: issued.expiresIn,
        issuedAt: issued.issuedAt,
        role,
        phone: typeof phone === "string" ? phone : null,
        sessionToken: sessionToken ?? null,
      },
    });
  } catch (err) {
    return serverError(err);
  }
});

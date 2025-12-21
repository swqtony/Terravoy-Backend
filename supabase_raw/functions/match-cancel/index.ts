import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { supabase } from "../_shared/supabaseClient.ts";
import {
  badRequest,
  handleOptions,
  jsonResponse,
  serverError,
} from "../_shared/responses.ts";
import { requireTerraUser } from "../_shared/terra.ts";

function resolveProfileId(value: unknown): string | null {
  if (typeof value === "string") return value;
  const maybe = value as { id?: string } | null;
  return typeof maybe?.id === "string" ? maybe.id : null;
}

serve(async (req: Request) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return badRequest("Method not allowed", 405);
  }

  try {
    const authResult = await requireTerraUser(req);
    if ("error" in authResult) return authResult.error;
    const terraUser = authResult.user;
    if (terraUser.role !== "traveler") {
      return badRequest("Traveler role required", 403);
    }

    const { requestId } = await req.json();

    if (!requestId || typeof requestId !== "string") {
      return badRequest("requestId is required");
    }

    const { data: ensuredProfile, error: ensureError } = await supabase.rpc(
      "ensure_profile_v2",
      { p_leancloud_user_id: terraUser.leancloudUserId },
    );
    if (ensureError) {
      return serverError(ensureError);
    }
    const profileId = resolveProfileId(ensuredProfile);
    if (!profileId) {
      return badRequest("Profile not found for Terra user", 403);
    }

    const { data: ownerRow, error: ownerError } = await supabase
      .from("match_requests")
      .select("profile_id")
      .eq("id", requestId)
      .maybeSingle();
    if (ownerError) {
      return serverError(ownerError);
    }
    const ownerProfileId = (ownerRow as { profile_id?: string } | null)
      ?.profile_id ?? null;
    if (!ownerProfileId) {
      return badRequest("request not found", 404);
    }
    if (ownerProfileId !== profileId) {
      return badRequest("Request does not belong to the user", 403);
    }

    const { error } = await supabase.rpc("cancel_match", {
      p_request_id: requestId,
    });

    if (error) {
      return serverError(error);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    return serverError(err);
  }
});

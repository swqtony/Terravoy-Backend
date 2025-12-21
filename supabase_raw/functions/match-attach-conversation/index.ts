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

    const { sessionId, conversationId, force = false } = await req.json();

    if (!sessionId || typeof sessionId !== "string") {
      return badRequest("sessionId is required");
    }

    if (!conversationId || typeof conversationId !== "string") {
      return badRequest("conversationId is required");
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

    const { data: sessionRow, error: sessionError } = await supabase
      .from("match_sessions")
      .select("profile_a_id, profile_b_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError) {
      return serverError(sessionError);
    }
    const sessionProfiles = sessionRow as {
      profile_a_id?: string | null;
      profile_b_id?: string | null;
    } | null;
    if (!sessionProfiles) {
      return badRequest("Session not found", 404);
    }
    if (
      sessionProfiles.profile_a_id !== profileId &&
      sessionProfiles.profile_b_id !== profileId
    ) {
      return badRequest("Session does not belong to the user", 403);
    }

    const { data, error } = await supabase.rpc(
      "attach_conversation_to_session",
      {
        p_session_id: sessionId,
        p_conversation_id: conversationId,
        p_force: Boolean(force),
      },
    );

    if (error) {
      return serverError(error);
    }

    return jsonResponse({
      success: true,
      data: data ?? null,
    });
  } catch (err) {
    return serverError(err);
  }
});

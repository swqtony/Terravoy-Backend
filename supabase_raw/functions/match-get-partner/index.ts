import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { supabase } from "../_shared/supabaseClient.ts";
import {
  badRequest,
  handleOptions,
  jsonResponse,
  serverError,
} from "../_shared/responses.ts";
import { requireTerraUser } from "../_shared/terra.ts";

type MatchSessionRow = {
  id: string;
  profile_a_id: string | null;
  profile_b_id: string | null;
  request_a_id?: string | null;
  request_b_id?: string | null;
  conversation_id?: string | null;
};

type ProfileLeancloudRow = {
  id: string;
  leancloud_user_id: string | null;
};

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

    const {
      sessionId,
      selfProfileId = null,
      leancloudUserId = null,
    } = await req.json();

    if (!sessionId || typeof sessionId !== "string") {
      return badRequest("sessionId is required");
    }

    const leancloudId = typeof leancloudUserId === "string" &&
        leancloudUserId.length > 0
      ? leancloudUserId
      : terraUser.leancloudUserId;
    if (leancloudId !== terraUser.leancloudUserId) {
      return badRequest("leancloudUserId does not match Terra token", 403);
    }

    const { data: ensuredProfile, error: ensureError } = await supabase.rpc(
      "ensure_profile_v2",
      { p_leancloud_user_id: terraUser.leancloudUserId },
    );
    if (ensureError) {
      return serverError(ensureError);
    }
    const ensuredProfileId = resolveProfileId(ensuredProfile);
    if (!ensuredProfileId) {
      return badRequest("Profile not found for Terra user", 403);
    }

    const { data: session, error: sessionError } = await supabase
      .from("match_sessions")
      .select(
        "id, profile_a_id, profile_b_id, request_a_id, request_b_id, conversation_id",
      )
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError) {
      return serverError(sessionError);
    }

    if (!session) {
      return badRequest("Session not found", 404);
    }

    const sessionRow = session as MatchSessionRow;
    if (
      sessionRow.profile_a_id !== ensuredProfileId &&
      sessionRow.profile_b_id !== ensuredProfileId
    ) {
      return badRequest("Session does not belong to this user", 403);
    }

    let selfId = typeof selfProfileId === "string" ? selfProfileId : null;
    if (selfId && selfId !== ensuredProfileId) {
      return badRequest("Profile does not match Terra token", 403);
    }
    if (!selfId) selfId = ensuredProfileId;
    const requestId = sessionRow.request_a_id ?? sessionRow.request_b_id ?? null;

    let otherProfileId: string | null = null;
    if (selfId && sessionRow.profile_a_id === selfId) {
      otherProfileId = sessionRow.profile_b_id ?? null;
    } else if (selfId && sessionRow.profile_b_id === selfId) {
      otherProfileId = sessionRow.profile_a_id ?? null;
    } else {
      otherProfileId = sessionRow.profile_a_id ?? sessionRow.profile_b_id ?? null;
    }

    if (!otherProfileId) {
      return jsonResponse({
        success: true,
        data: {
          status: "waiting",
          sessionId: sessionRow.id,
          requestId,
          conversationId: sessionRow.conversation_id ?? null,
          otherProfileId: null,
          otherLeancloudUserId: null,
        },
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, leancloud_user_id")
      .eq("id", otherProfileId)
      .maybeSingle();

    if (profileError) {
      return serverError(profileError);
    }

    const otherRow = profile as ProfileLeancloudRow | null;

    if (!otherRow) {
      return jsonResponse({
        success: true,
        data: {
          status: "waiting",
          sessionId: sessionRow.id,
          requestId,
          conversationId: sessionRow.conversation_id ?? null,
          otherProfileId,
          otherLeancloudUserId: null,
        },
      });
    }

    return jsonResponse({
      success: true,
      data: {
        status: "matched",
        sessionId: sessionRow.id,
        requestId,
        conversationId: sessionRow.conversation_id ?? null,
        otherProfileId: otherRow.id,
        otherLeancloudUserId: otherRow.leancloud_user_id,
      },
    });
  } catch (err) {
    return serverError(err);
  }
});

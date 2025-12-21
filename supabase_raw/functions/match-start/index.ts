import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { supabase } from "../_shared/supabaseClient.ts";
import {
  badRequest,
  handleOptions,
  jsonResponse,
  serverError,
} from "../_shared/responses.ts";
import { createLeanConversation } from "../_shared/leancloud.ts";
import { requireTerraUser } from "../_shared/terra.ts";
import { requireSupabaseUser } from "../_shared/user.ts";

type MatchSessionRow = {
  id: string;
  profile_a_id: string;
  profile_b_id: string;
  conversation_id?: string | null;
  [key: string]: unknown;
};

type MatchRequestRow = {
  id: string;
  profile_id: string;
  trip_card_id: string;
};

type ProfileLeancloudRow = {
  id: string;
  leancloud_user_id: string | null;
  is_completed?: boolean | null;
};

function resolveProfileId(value: unknown): string | null {
  if (typeof value === "string") return value;
  const maybe = value as { id?: string } | null;
  return typeof maybe?.id === "string" ? maybe.id : null;
}

async function ensureConversationForSession(params: {
  session: MatchSessionRow;
  selfLeancloudUserId: string | null;
  otherLeancloudUserId: string | null;
}): Promise<string | null> {
  const { session, selfLeancloudUserId, otherLeancloudUserId } = params;
  if (session.conversation_id) return session.conversation_id;
  if (!selfLeancloudUserId || !otherLeancloudUserId) return null;

  const convId = await createLeanConversation({
    members: [selfLeancloudUserId, otherLeancloudUserId],
    name: "Match Chat",
    attributes: {
      type: "matchChat",
      category: "matchChat",
      sessionId: session.id,
      participantMeta: {
        [selfLeancloudUserId]: { role: "traveler" },
        [otherLeancloudUserId]: { role: "traveler" },
      },
    },
  });

  const { error: attachError } = await supabase.rpc(
    "attach_conversation_to_session",
    {
      p_session_id: session.id,
      p_conversation_id: convId,
      p_force: true,
    },
  );
  if (attachError) throw attachError;
  return convId;
}

serve(async (req: Request) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return badRequest("Method not allowed", 405);
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    console.log("[match-start] headers", {
      hasAuthHeader: Boolean(authHeader),
      authPrefix: authHeader ? authHeader.slice(0, 12) : null,
    });
    const authResult = await requireTerraUser(req);
    if ("error" in authResult) return authResult.error;
    const terraUser = authResult.user;
    if (terraUser.role !== "traveler") {
      return badRequest("Traveler role required", 403);
    }

    const supabaseAuth = await requireSupabaseUser(req);
    if ("error" in supabaseAuth) return supabaseAuth.error;
    const supabaseUserId = supabaseAuth.user.id;

    const {
      tripCardId,
      preferredGender = null,
      preferredAgeMin = null,
      preferredAgeMax = null,
      preferredLanguages = null,
      cityScopeMode = "Strict",
    } = await req.json();

    const leancloudUserId = terraUser.leancloudUserId;

    if (!tripCardId || typeof tripCardId !== "string") {
      return badRequest("tripCardId is required");
    }

    const languages = Array.isArray(preferredLanguages) &&
        preferredLanguages.every((item) => typeof item === "string") &&
        preferredLanguages.length > 0
      ? preferredLanguages
      : null;

    if (
      preferredAgeMin !== null &&
      preferredAgeMin !== undefined &&
      typeof preferredAgeMin !== "number"
    ) {
      return badRequest("preferredAgeMin must be a number or null");
    }

    if (
      preferredAgeMax !== null &&
      preferredAgeMax !== undefined &&
      typeof preferredAgeMax !== "number"
    ) {
      return badRequest("preferredAgeMax must be a number or null");
    }

    if (preferredGender !== null && typeof preferredGender !== "string") {
      return badRequest("preferredGender must be a string or null");
    }

    const cityScope = typeof cityScopeMode === "string"
      ? cityScopeMode
      : "Strict";

    const { data: ensuredProfile, error: ensureError } = await supabase.rpc(
      "ensure_profile_v2",
      {
        p_leancloud_user_id: leancloudUserId,
        p_supabase_user_id: supabaseUserId,
      },
    );

    if (ensureError) {
      return serverError(ensureError);
    }

    const profileId = resolveProfileId(ensuredProfile);
    if (!profileId) {
      return serverError("Failed to ensure profile");
    }

    const { data: selfProfile, error: selfProfileError } = await supabase
      .from("profiles")
      .select("id, leancloud_user_id, is_completed")
      .eq("id", profileId)
      .maybeSingle();
    if (selfProfileError) {
      return serverError(selfProfileError);
    }

    const selfProfileRow = selfProfile as ProfileLeancloudRow | null;
    if (!selfProfileRow) {
      return serverError("Profile not found for user");
    }
    if (selfProfileRow.is_completed !== true) {
      return jsonResponse({
        success: false,
        code: "PROFILE_INCOMPLETE",
        message: "Profile is not completed",
      });
    }

    // Defensive: cancel any stale waiting requests for this profile before starting a new match,
    // so a previous "abandoned" waiting record will not be reused or matched later.
    const { data: staleRequests, error: staleError } = await supabase
      .from("match_requests")
      .select("id")
      .eq("profile_id", profileId)
      .eq("status", "waiting");
    if (staleError) {
      return serverError(staleError);
    }
    if (Array.isArray(staleRequests)) {
      for (const row of staleRequests as Array<{ id?: string | null }>) {
        const rid = row.id;
        if (typeof rid === "string" && rid.length > 0) {
          await supabase.rpc("cancel_match", { p_request_id: rid });
        }
      }
    }

    const { data: session, error: startError } = await supabase.rpc(
      "start_match",
      {
        p_profile_id: profileId,
        p_trip_card_id: tripCardId,
        p_preferred_gender: preferredGender,
        p_preferred_age_min: preferredAgeMin,
        p_preferred_age_max: preferredAgeMax,
        p_preferred_languages: languages,
        p_city_scope_mode: cityScope,
      },
    );

    if (startError) {
      return serverError(startError);
    }

    let sessionRow = session as MatchSessionRow | null;
    let requestId = (sessionRow as any)?.request_a_id ??
      (sessionRow as any)?.request_b_id ??
      null;
    console.log(
      "[match-start] start_match result",
      { profileId, sessionPresent: Boolean(sessionRow), requestId },
    );

    // If start_match returns null or request id is missing, try to recover from active request or existing sessions.
    if (!sessionRow) {
      const { data: activeRequest, error: requestError } = await supabase.rpc(
        "get_active_match_request",
        { p_profile_id: profileId },
      );

      if (requestError) {
        return serverError(requestError);
      }

      const request = activeRequest as MatchRequestRow | null;
      requestId = request?.id ?? requestId;
      console.log(
        "[match-start] active_request fallback",
        { profileId, requestId },
      );

      // If this request has already been matched into a session elsewhere, reuse it.
      if (requestId) {
        const { data: existingSession, error: existingError } = await supabase
          .from("match_sessions")
          .select("*")
          .or(`request_a_id.eq.${requestId},request_b_id.eq.${requestId}`)
          .in("status", ["pending", "matched"])
          .limit(1)
          .maybeSingle();
        if (existingError) {
          return serverError(existingError);
        }
        sessionRow = existingSession as MatchSessionRow | null;
        console.log(
          "[match-start] reuse session by request",
          { profileId, requestId, sessionId: sessionRow?.id },
        );
      }

      // Last resort: find any pending/matched session that already includes this profile.
      if (!sessionRow) {
        const { data: existingByProfile, error: existingByProfileError } =
          await supabase
            .from("match_sessions")
            .select("*")
            .or(`profile_a_id.eq.${profileId},profile_b_id.eq.${profileId}`)
            .in("status", ["pending", "matched"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (existingByProfileError) {
          return serverError(existingByProfileError);
        }
        sessionRow = existingByProfile as MatchSessionRow | null;
        console.log(
          "[match-start] reuse session by profile",
          { profileId, sessionId: sessionRow?.id },
        );
      }

      if (!sessionRow) {
        if (!requestId) {
          return serverError("No active match request found");
        }
        console.log(
          "[match-start] no session found, return waiting",
          { profileId, requestId },
        );
        return jsonResponse({
          success: true,
          data: {
            status: "waiting",
            profileId,
            requestId,
            tripCardId: request?.trip_card_id ?? tripCardId,
          },
        });
      }
    }

    // If requestId was still empty but we now have a session, fill from session.
    if (!requestId) {
      requestId = (sessionRow as any)?.request_a_id ??
        (sessionRow as any)?.request_b_id ??
        null;
    }

    const isA = sessionRow.profile_a_id === profileId;
    const selfProfileId = profileId;
    const otherProfileId = isA
      ? sessionRow.profile_b_id
      : sessionRow.profile_a_id;
    const conversationIdFromSession = sessionRow.conversation_id ?? null;

    // Some start_match results do not return request id; fallback to current active request.
    if (!requestId) {
      const { data: activeRequest, error: requestError } = await supabase.rpc(
        "get_active_match_request",
        { p_profile_id: profileId },
      );
      if (requestError) {
        return serverError(requestError);
      }
      const reqRow = activeRequest as MatchRequestRow | null;
      requestId = reqRow?.id ?? null;
      console.log(
        "[match-start] filled requestId from active_request",
        { profileId, requestId },
      );
    }

    // Last resort: fetch the most recent *waiting* request for this profile to avoid null requestId.
    if (!requestId) {
      const { data: latestRequest, error: latestError } = await supabase
        .from("match_requests")
        .select("id")
        .eq("profile_id", profileId)
        .eq("status", "waiting")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) {
        return serverError(latestError);
      }
      requestId = (latestRequest as { id?: string } | null)?.id ?? null;
      console.log(
        "[match-start] filled requestId from latest waiting request",
        { profileId, requestId },
      );
    }
    if (!otherProfileId) {
      // If the session already carries a conversation, treat as matched so the client can jump to chat.
      const status = conversationIdFromSession ? "matched" : "waiting";
      return jsonResponse({
        success: true,
        data: {
          status,
          session: sessionRow,
          sessionId: sessionRow.id,
          profileId,
          requestId,
          tripCardId,
          otherProfileId: null,
          otherLeancloudUserId: null,
          conversationId: conversationIdFromSession,
        },
      });
    }

    const { data: otherProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, leancloud_user_id")
      .eq("id", otherProfileId)
      .maybeSingle();

    if (profileError) {
      return serverError(profileError);
    }

    const otherRow = otherProfile as ProfileLeancloudRow | null;
    if (!otherRow) {
      // Profile row missing but session exists. If we already have conversation_id, still return matched so UI can proceed.
      const status = conversationIdFromSession ? "matched" : "waiting";
      return jsonResponse({
        success: true,
        data: {
          status,
          session: sessionRow,
          sessionId: sessionRow.id,
          profileId,
          requestId,
          tripCardId,
          otherProfileId,
          otherLeancloudUserId: null,
          conversationId: conversationIdFromSession,
        },
      });
    }

    const conversationId = await ensureConversationForSession({
      session: sessionRow,
      selfLeancloudUserId:
        selfProfileRow.leancloud_user_id ?? leancloudUserId,
      otherLeancloudUserId: otherRow.leancloud_user_id,
    });

    return jsonResponse({
      success: true,
      data: {
        status: "matched",
        session: sessionRow,
        sessionId: sessionRow.id,
        requestId,
        selfProfileId,
        otherProfileId,
        otherLeancloudUserId: otherRow?.leancloud_user_id ?? null,
        conversationId: conversationId ?? sessionRow.conversation_id ?? null,
      },
    });
  } catch (err) {
    return serverError(err);
  }
});

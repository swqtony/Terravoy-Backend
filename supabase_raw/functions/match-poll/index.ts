import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import {
  badRequest,
  handleOptions,
  jsonResponse,
  serverError,
} from "../_shared/responses.ts";
import { supabase } from "../_shared/supabaseClient.ts";
import { createLeanConversation } from "../_shared/leancloud.ts";
import { requireTerraUser } from "../_shared/terra.ts";
import { requireSupabaseUser } from "../_shared/user.ts";

type MatchSessionRow = {
  id: string;
  profile_a_id: string;
  profile_b_id: string;
  request_a_id?: string | null;
  request_b_id?: string | null;
  conversation_id?: string | null;
  [key: string]: unknown;
};

type MatchRequestRow = {
  profile_id: string;
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
  if (!selfLeancloudUserId || !otherLeancloudUserId) {
    throw new Error("Missing leancloud user id to create conversation");
  }

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
  if (attachError) {
    throw attachError;
  }

  return convId;
}

async function respondWithSession(params: {
  session: MatchSessionRow;
  profileId: string;
  requestId?: string | null;
  selfProfile: ProfileLeancloudRow | null;
  leancloudUserId: string;
}): Promise<Response> {
  const { session, requestId, leancloudUserId } = params;
  let { profileId, selfProfile } = params;
  const requestIdFromSession = requestId ??
    (session as { request_a_id?: string | null }).request_a_id ??
    (session as { request_b_id?: string | null }).request_b_id ??
    null;

  const sessionRequestIds = [
    (session as { request_a_id?: string | null }).request_a_id ?? null,
    (session as { request_b_id?: string | null }).request_b_id ?? null,
  ].filter((id): id is string => Boolean(id));

  if (
    requestId &&
    sessionRequestIds.length > 0 &&
    !sessionRequestIds.includes(requestId)
  ) {
    return badRequest("Session does not belong to this request", 403);
  }

  const isA = session.profile_a_id === profileId;
  const isB = session.profile_b_id === profileId;
  if (!isA && !isB) {
    // Graceful fallback: if session profiles map to the same LeanCloud user, adopt that profile.
    const profileIds = [
      session.profile_a_id,
      session.profile_b_id,
    ].filter((id): id is string => Boolean(id));
    if (profileIds.length > 0) {
      const { data: rows, error: listError } = await supabase
        .from("profiles")
        .select("id, leancloud_user_id")
        .in("id", profileIds);
      if (!listError && Array.isArray(rows)) {
        const matched = (rows as ProfileLeancloudRow[]).find((row) =>
          row.leancloud_user_id === leancloudUserId
        );
        if (matched) {
          profileId = matched.id;
          selfProfile = matched;
        }
      }
    }
  }

  const nowIsA = session.profile_a_id === profileId;
  const nowIsB = session.profile_b_id === profileId;
  if (!nowIsA && !nowIsB) {
    console.warn("[match-poll] session mismatch", {
      sessionId: session.id,
      requestId,
      profileId,
      sessionProfiles: {
        profile_a_id: session.profile_a_id,
        profile_b_id: session.profile_b_id,
      },
      leancloudUserId,
    });
    // Graceful fallback: mark as waiting so client can continue polling or restart.
    return jsonResponse({
      success: true,
      data: {
        status: "waiting",
        requestId: requestIdFromSession,
        sessionId: session.id,
        selfProfileId: profileId,
        otherProfileId: null,
        otherLeancloudUserId: null,
        conversationId: session.conversation_id ?? null,
      },
    }, { status: 200 });
  }

  const otherProfileId = nowIsA ? session.profile_b_id : session.profile_a_id;
  if (!otherProfileId) {
    const status = session.conversation_id ? "matched" : "waiting";
    return jsonResponse({
      success: true,
      data: {
        status,
        session,
        sessionId: session.id,
        requestId: requestIdFromSession,
        selfProfileId: profileId,
        otherProfileId: null,
        otherLeancloudUserId: null,
        conversationId: session.conversation_id ?? null,
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
    const status = session.conversation_id ? "matched" : "waiting";
    return jsonResponse({
      success: true,
      data: {
        status,
        session,
        sessionId: session.id,
        requestId: requestIdFromSession,
        selfProfileId: profileId,
        otherProfileId,
        otherLeancloudUserId: null,
        conversationId: session.conversation_id ?? null,
      },
    });
  }

  let conversationId: string | null = null;
  try {
    conversationId = await ensureConversationForSession({
      session,
      selfLeancloudUserId:
        (selfProfile as ProfileLeancloudRow | null)?.leancloud_user_id ??
          leancloudUserId,
      otherLeancloudUserId: otherRow.leancloud_user_id ?? null,
    });
  } catch (error) {
    console.error("[match-poll] ensureConversationForSession error", {
      sessionId: session.id,
      requestId: requestIdFromSession,
      profileId,
      error,
    });
    return serverError(error);
  }

  return jsonResponse({
    success: true,
    data: {
      status: "matched",
      session,
      sessionId: session.id,
      requestId: requestIdFromSession,
      selfProfileId: profileId,
      otherProfileId,
      otherLeancloudUserId: otherRow.leancloud_user_id ?? null,
      conversationId: conversationId ?? session.conversation_id ?? null,
    },
  });
}

serve(async (req: Request) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return badRequest("Method not allowed", 405);
  }
  const logContext: Record<string, unknown> = {};
  const authHeader = req.headers.get("authorization") || "";
  console.log("[match-poll] headers", {
    hasAuthHeader: Boolean(authHeader),
    authPrefix: authHeader ? authHeader.slice(0, 12) : null,
  });

  const markRequestFailed = async (requestId: string | null | undefined) => {
    if (!requestId) return;
    await supabase
      .from("match_requests")
      .update({ status: "failed" })
      .eq("id", requestId);
  };

  const businessError = (
    code: string,
    message: string,
    extra?: Record<string, unknown>,
  ) => {
    const payload = { success: false, code, message };
    console.error("[match-poll] business error", {
      ...logContext,
      code,
      message,
      ...extra,
    });
    return jsonResponse(payload, { status: 200 });
  };

  try {
    const authResult = await requireTerraUser(req);
    if ("error" in authResult) return authResult.error;
    const terraUser = authResult.user;
    if (terraUser.role !== "traveler") {
      return businessError("FORBIDDEN", "Traveler role required");
    }

    const { requestId } = await req.json();
    logContext.userId = terraUser.leancloudUserId;
    logContext.requestId = requestId;
    const leancloudUserId = terraUser.leancloudUserId;

    const supabaseAuth = await requireSupabaseUser(req);
    if ("error" in supabaseAuth) return supabaseAuth.error;
    const supabaseUserId = supabaseAuth.user.id;

    if (!requestId || typeof requestId !== "string") {
      return businessError("INVALID_REQUEST_ID", "requestId is required");
    }

    // If this request already belongs to an existing session, short-circuit to matched.
    const { data: existingSession, error: existingSessionError } = await supabase
      .from("match_sessions")
      .select("*")
      .or(`request_a_id.eq.${requestId},request_b_id.eq.${requestId}`)
      .in("status", ["pending", "matched"])
      .maybeSingle();
    if (existingSessionError) {
      return businessError(
        "SESSION_QUERY_FAILED",
        "Failed to query session",
        { error: existingSessionError },
      );
    }

    const { data: ensuredProfile, error: ensureError } = await supabase.rpc(
      "ensure_profile_v2",
      {
        p_leancloud_user_id: terraUser.leancloudUserId,
        p_supabase_user_id: supabaseUserId,
      },
    );

    if (ensureError) {
      return businessError(
        "ENSURE_PROFILE_FAILED",
        "Failed to ensure profile",
        { error: ensureError },
      );
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
      return businessError(
        "PROFILE_QUERY_FAILED",
        "Failed to fetch profile",
        { error: selfProfileError },
      );
    }

    const selfProfileRow = selfProfile as ProfileLeancloudRow | null;

    if (!selfProfileRow) {
      return businessError(
        "PROFILE_NOT_FOUND",
        "Profile not found for user",
      );
    }

    if (selfProfileRow.is_completed !== true) {
      return businessError(
        "PROFILE_INCOMPLETE",
        "Profile is not completed",
      );
    }

    const { data: requestOwner, error: requestOwnerError } = await supabase
      .from("match_requests")
      .select("profile_id, status")
      .eq("id", requestId)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (requestOwnerError) {
      await markRequestFailed(requestId as string | null | undefined);
      return businessError(
        "REQUEST_QUERY_FAILED",
        "Failed to fetch match request",
        { error: requestOwnerError },
      );
    }

    const ownerRow = requestOwner as (MatchRequestRow & {
      status?: string | null;
    }) | null;

    if (!ownerRow) {
      await markRequestFailed(requestId as string | null | undefined);
      return businessError(
        "REQUEST_NOT_FOUND",
        "Match request not found or not owned by user",
      );
    }

    // If the request is already cancelled/expired, short-circuit so it won't be reused.
    const requestStatus = ownerRow?.status ?? null;
    if (requestStatus && requestStatus !== "waiting") {
      return businessError(
        "REQUEST_NOT_WAITING",
        `Request already ${requestStatus}`,
        { status: requestStatus },
      );
    }

    const sessionFromRequest = existingSession as MatchSessionRow | null;
    if (sessionFromRequest) {
      return await respondWithSession({
        session: sessionFromRequest,
        profileId,
        requestId,
        selfProfile: selfProfileRow,
        leancloudUserId,
      });
    }

    const { data: session, error: matchError } = await supabase.rpc(
      "try_match",
      { p_request_id: requestId },
    );

    if (matchError) {
      return businessError(
        "TRY_MATCH_FAILED",
        "Failed to execute try_match",
        { error: matchError },
      );
    }

    if (!session) {
      return jsonResponse({
        success: true,
        data: {
          status: "waiting",
          requestId,
        },
      });
    }

    const sessionRow = session as MatchSessionRow;
    return await respondWithSession({
      session: sessionRow,
      profileId,
      requestId,
      selfProfile: selfProfileRow,
      leancloudUserId,
    });
  } catch (err) {
    const error = err as Error;
    await markRequestFailed(logContext.requestId as string | null | undefined);
    console.error("[match-poll] unhandled error", {
      ...logContext,
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    });
    return jsonResponse({
      success: false,
      code: "UNEXPECTED_ERROR",
      message: "match-poll unexpected error",
    }, { status: 200 });
  }
});

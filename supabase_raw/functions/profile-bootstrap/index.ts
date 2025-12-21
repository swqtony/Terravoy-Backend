import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { supabase } from "../_shared/supabaseClient.ts";
import {
  badRequest,
  handleOptions,
  jsonResponse,
  serverError,
} from "../_shared/responses.ts";
import { requireSupabaseUser } from "../_shared/user.ts";

type ProfileRow = {
  id: string;
  is_completed: boolean;
};

serve(async (req: Request) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return badRequest("Method not allowed", 405);
  }

  try {
    const authResult = await requireSupabaseUser(req);
    if ("error" in authResult) return authResult.error;
    const supabaseUserId = authResult.user.id;

    const { leancloudUserId } = await req.json();

    if (!leancloudUserId || typeof leancloudUserId !== "string") {
      return badRequest("leancloudUserId is required");
    }

    const { data: ensuredId, error } = await supabase.rpc("ensure_profile_v2", {
      p_leancloud_user_id: leancloudUserId,
      p_supabase_user_id: supabaseUserId,
    });

    if (error) {
      return serverError(error);
    }

    const profileId = typeof ensuredId === "string"
      ? ensuredId
      : (ensuredId as { id?: string } | null)?.id ?? null;

    if (!profileId) {
      return serverError("Failed to ensure profile");
    }

    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("id, is_completed")
      .eq("id", profileId)
      .maybeSingle();

    if (profileError) {
      return serverError(profileError);
    }

    const profile = profileRow as ProfileRow | null;
    if (!profile) {
      return serverError("Profile not found after ensure_profile_v2");
    }

    return jsonResponse({
      success: true,
      data: {
        profileId: profile.id,
        isCompleted: profile.is_completed,
      },
    });
  } catch (err) {
    return serverError(err);
  }
});

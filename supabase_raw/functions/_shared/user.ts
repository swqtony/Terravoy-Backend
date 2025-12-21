import { supabase } from "./supabaseClient.ts";
import { badRequest } from "./responses.ts";

export async function requireSupabaseUser(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length)
    : authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;
  if (!token) {
    return { error: badRequest("Authorization header missing", 401) };
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { error: badRequest("Unauthorized", 401) };
  }
  return { user: data.user, token };
}

import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import { corsHeaders, handleOptions } from "../_shared/responses.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const passwordSecret =
  Deno.env.get("SUPABASE_LEAN_PASSWORD_SECRET") ||
  Deno.env.get("LEAN_PASSWORD_SECRET") ||
  "TerraVoy#LeanUser@2025";

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

const buildResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const ok = (
  data: Record<string, unknown>,
  requestId: string,
  status = 200,
) => buildResponse({ ok: true, data, requestId }, status);

const err = (
  code: string,
  message: string,
  detail: unknown,
  requestId: string,
  status = 500,
) => {
  console.error(
    `[auth-supabase-login][${requestId}] ${code}: ${message}`,
    detail,
  );
  return buildResponse({ ok: false, code, message, detail, requestId }, status);
};

const deriveEmail = (leancloudUserId: string) =>
  `${leancloudUserId}@lc.terravoy.local`;

async function derivePassword(leancloudUserId: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passwordSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(leancloudUserId),
  );
  const hash = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Stable, policy-friendly password string.
  return hash.substring(0, Math.max(16, hash.length));
}

async function adminCreateUser(
  email: string,
  password: string,
  leancloudUserId: string,
  requestId: string,
) {
  const url = `${supabaseUrl}/auth/v1/admin/users`;
  const headers = {
    apikey: supabaseServiceRoleKey!,
    Authorization: `Bearer ${supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
  };
  console.log(
    `[auth-supabase-login][${requestId}] admin create POST ${url} hasAuthHeader=${
      headers.Authorization.startsWith("Bearer ")
    } hasApiKey=${Boolean(headers.apikey)}`,
  );
  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { leancloudUserId },
      app_metadata: { leancloudUserId },
    }),
  });

  const bodyText = await resp.text();
  let parsed: unknown = bodyText;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch (_) {
    parsed = bodyText;
  }

  console.log(
    `[auth-supabase-login][${requestId}] admin create status=${resp.status} url=${url}`,
  );
  if (resp.status === 422) {
    console.error(
      `[auth-supabase-login][${requestId}] admin create 422 body=${bodyText}`,
    );
  }

  return { ok: resp.ok || resp.status === 422, status: resp.status, body: parsed };
}

async function signInWithPassword(
  email: string,
  password: string,
  requestId: string,
) {
  const signInClient = createClient(
    supabaseUrl!,
    supabaseAnonKey || supabaseServiceRoleKey!,
  );
  console.log(
    `[auth-supabase-login][${requestId}] signInWithPassword start email=${email}`,
  );
  const { data, error } = await signInClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    console.error(
      `[auth-supabase-login][${requestId}] signInWithPassword error=${error.message}`,
    );
    return { session: null, error };
  }
  return { session: data?.session ?? null, error: null };
}

serve(async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;

  const requestId = crypto.randomUUID();

  if (req.method !== "POST") {
    return err("METHOD_NOT_ALLOWED", "Method not allowed", null, requestId, 405);
  }

  try {
    const payload = await req.json();
    const leancloudUserId = payload?.leancloudUserId as string | undefined;
    if (!leancloudUserId || typeof leancloudUserId !== "string") {
      return err(
        "INVALID_REQUEST",
        "leancloudUserId is required",
        payload,
        requestId,
        400,
      );
    }

    const email = deriveEmail(leancloudUserId);
    const password = await derivePassword(leancloudUserId);

    console.log(
      `[auth-supabase-login][${requestId}] start leancloudUserId=${leancloudUserId} email=${email}`,
    );

    let { session } = await signInWithPassword(email, password, requestId);

    if (!session) {
      const created = await adminCreateUser(
        email,
        password,
        leancloudUserId,
        requestId,
      );
      if (!created.ok) {
        return err(
          "ADMIN_CREATE_FAILED",
          "Failed to create Supabase user",
          created.body,
          requestId,
          created.status || 500,
        );
      }

      const retry = await signInWithPassword(email, password, requestId);
      session = retry.session;
      if (!session) {
        return err(
          "SIGN_IN_FAILED",
          "Failed to obtain Supabase session after create/login",
          retry.error?.message ?? retry.error,
          requestId,
          500,
        );
      }
    }

    const {
      access_token,
      refresh_token,
      expires_in,
      expires_at,
      token_type,
      user,
    } = session;

    console.log(
      `[auth-supabase-login][${requestId}] success supabaseUserId=${user?.id ?? "unknown"} hasRefresh=${
        Boolean(refresh_token)
      }`,
    );

    return ok(
      {
        access_token,
        refresh_token,
        expires_in,
        expires_at,
        token_type,
        supabaseUserId: user?.id ?? null,
        email,
      },
      requestId,
    );
  } catch (error) {
    return err("UNEXPECTED", "Unexpected error", error, requestId, 500);
  }
});

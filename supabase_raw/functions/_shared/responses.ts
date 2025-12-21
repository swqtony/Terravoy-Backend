export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-route, x-path, x-cron-secret, x-leancloud-user-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return null;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = {
    "Content-Type": "application/json",
    ...corsHeaders,
    ...(init.headers ?? {}),
  };

  return new Response(JSON.stringify(body), { ...init, headers });
}

export function badRequest(error: string, status = 400): Response {
  return jsonResponse({ success: false, error }, { status });
}

export function serverError(error: unknown, status = 500): Response {
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else {
    try {
      message = JSON.stringify(error);
    } catch (_) {
      message = String(error);
    }
  }
  return jsonResponse({ success: false, error: message }, { status });
}

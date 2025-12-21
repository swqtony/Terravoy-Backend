// @ts-nocheck
import {
  create,
  getNumericDate,
  verify,
} from "https://deno.land/x/djwt@v2.9.1/mod.ts";
import { corsHeaders } from "./responses.ts";

const jwtSecret = Deno.env.get("TERRA_JWT_SECRET");
if (!jwtSecret) {
  throw new Error("TERRA_JWT_SECRET must be set");
}

const terraDevToken = Deno.env.get("TERRA_DEV_TOKEN") ||
  Deno.env.get("TERRA_TOKEN");

const signingKeyPromise = crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(jwtSecret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"],
);

export type TerraRole = "traveler" | "host";

export type TerraTokenPayload = {
  sub: string;
  role: TerraRole;
  phone?: string | null;
  iat: number;
  exp: number;
};

export type TerraUser = {
  leancloudUserId: string;
  role: TerraRole;
  phone?: string | null;
  token: string;
};

const DEFAULT_TERRA_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function issueTerraToken(params: {
  leancloudUserId: string;
  role: TerraRole;
  phone?: string | null;
  expiresInSeconds?: number;
}): Promise<{ token: string; expiresIn: number; issuedAt: number }> {
  const { leancloudUserId, role, phone = null } = params;
  const expiresInSeconds = params.expiresInSeconds ?? DEFAULT_TERRA_TTL_SECONDS;
  const key = await signingKeyPromise;
  const iat = getNumericDate(0);
  const exp = getNumericDate(expiresInSeconds);
  const payload: TerraTokenPayload = {
    sub: leancloudUserId,
    role,
    phone: phone ?? undefined,
    iat,
    exp,
  };

  const token = await create({ alg: "HS256", typ: "JWT" }, payload, key);
  return { token, expiresIn: expiresInSeconds, issuedAt: iat };
}

function unauthorized(message: string, status = 401): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization") ||
    req.headers.get("Authorization");
  if (!authHeader) return null;
  const value = authHeader.trim();
  if (value.toLowerCase().startsWith("bearer ")) {
    return value.slice("bearer ".length).trim();
  }
  return value.length > 0 ? value : null;
}

export async function parseTerraToken(
  token: string,
): Promise<TerraTokenPayload | null> {
  const key = await signingKeyPromise;
  let payload: unknown;
  try {
    payload = await verify(token, key);
  } catch (_err) {
    return null;
  }

  const data = payload as Record<string, unknown>;
  if (!data || typeof data.sub !== "string") return null;
  const role = data.role;
  const iat = typeof data.iat === "number" ? data.iat : null;
  const exp = typeof data.exp === "number" ? data.exp : null;
  if (role !== "traveler" && role !== "host") return null;
  if (iat === null || exp === null) return null;

  return {
    sub: data.sub,
    role,
    phone: typeof data.phone === "string"
      ? data.phone
      : data.phone === null
      ? null
      : undefined,
    iat,
    exp,
  };
}

export async function requireTerraUser(
  req: Request,
): Promise<{ user: TerraUser } | { error: Response }> {
  const headerToken = req.headers.get("x-terra-token");
  if (headerToken) {
    // Dev token path: exact match against env.
    if (terraDevToken && headerToken === terraDevToken) {
      const headerUserId = req.headers.get("x-leancloud-user-id") ??
        req.headers.get("x-leancloud-userid") ?? "unknown";
      const roleHeader = (req.headers.get("x-terra-role") ?? "").toLowerCase();
      const role = roleHeader === "host" ? "host" : "traveler";
      return {
        user: {
          leancloudUserId: headerUserId,
          role,
          phone: null,
          token: headerToken,
        },
      };
    }
    // If not dev token, try parsing as Terra JWT.
    const parsedHeader = await parseTerraToken(headerToken);
    if (!parsedHeader) {
      console.error(
        `[terra] invalid x-terra-token provided (neither dev token nor valid JWT)`,
      );
      return { error: unauthorized("Invalid Terra token", 401) };
    }
    return {
      user: {
        leancloudUserId: parsedHeader.sub,
        role: parsedHeader.role,
        phone: parsedHeader.phone ?? null,
        token: headerToken,
      },
    };
  }

  const token = extractBearerToken(req);
  if (!token) {
    return { error: unauthorized("Missing Terra token", 401) };
  }
  const payload = await parseTerraToken(token);
  if (!payload) {
    return { error: unauthorized("Invalid Terra token", 401) };
  }
  return {
    user: {
      leancloudUserId: payload.sub,
      role: payload.role,
      phone: payload.phone ?? null,
      token,
    },
  };
}

export const TERRA_TOKEN_TTL_SECONDS = DEFAULT_TERRA_TTL_SECONDS;

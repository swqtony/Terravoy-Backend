// @ts-nocheck
import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { supabase } from "../_shared/supabaseClient.ts";
import { corsHeaders } from "../_shared/responses.ts";
import { requireTerraUser, TerraUser } from "../_shared/terra.ts";

type JsonBody = Record<string, unknown>;

type OrderStatus =
  | "PENDING_HOST_CONFIRM"
  | "CONFIRMED"
  | "IN_SERVICE"
  | "COMPLETED"
  | "CANCELLED_REFUNDED"
  | "CANCELLED_BY_TRAVELER"
  | "DISPUTED";

type PaymentStatus = "UNPAID" | "PAID" | "REFUNDING" | "REFUNDED";

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...headers,
    },
  });
}

function success(data?: unknown, status = 200): Response {
  return jsonResponse({ success: true, data }, status);
}

function error(code: string, message: string, status = 400): Response {
  return jsonResponse({ success: false, error: { code, message } }, status);
}

async function requireJson(req: Request): Promise<JsonBody | Response> {
  try {
    return (await req.json()) as JsonBody;
  } catch (_err) {
    return error("INVALID_JSON", "Invalid JSON body", 400);
  }
}

function requirePathId(pathname: string): number | null {
  const match = pathname.match(/^\/(\d+)(\/.*)?$/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

function generateOrderNo(): string {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  return `ORD${ts}${rand}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function resolveProfileId(value: unknown): string | null {
  if (typeof value === "string") return value;
  const maybe = value as { id?: string } | null;
  return typeof maybe?.id === "string" ? maybe.id : null;
}

async function resolveProfileIdFromLeancloud(
  leancloudUserId: string,
): Promise<string | null> {
  const { data, error: ensureError } = await supabase.rpc("ensure_profile_v2", {
    p_leancloud_user_id: leancloudUserId,
  });
  if (ensureError) {
    throw ensureError;
  }
  return resolveProfileId(data);
}

async function requireActorIdentity(
  req: Request,
): Promise<{ user: TerraUser; profileId: string } | Response> {
  const authResult = await requireTerraUser(req);
  if ("error" in authResult) return authResult.error;

  const user = authResult.user;
  try {
    const profileId = await resolveProfileIdFromLeancloud(
      user.leancloudUserId,
    );
    if (!profileId) {
      return error("UNAUTHORIZED", "Unknown Terra user", 401);
    }
    return { user, profileId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error("DB_ERROR", message, 500);
  }
}

async function resolveHostProfileId(hostId: string): Promise<string | null> {
  if (isUuid(hostId)) return hostId;

  return await resolveProfileIdFromLeancloud(hostId);
}

async function fetchOrder(orderId: number) {
  const { data, error: dbError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (dbError) throw dbError;
  return data as Record<string, unknown> | null;
}

function assertOrderAccess(
  order: Record<string, unknown>,
  userId: string,
  roles: Array<"traveler" | "host">,
): boolean {
  const travelerId = order.traveler_id as string | undefined;
  const hostId = order.host_id as string | undefined;

  if (roles.includes("traveler") && travelerId === userId) return true;
  if (roles.includes("host") && hostId === userId) return true;
  return false;
}

async function handleCreateOrder(req: Request): Promise<Response> {
  const bodyOrError = await requireJson(req);
  if (bodyOrError instanceof Response) return bodyOrError;
  const body = bodyOrError;

  const {
    experienceId,
    hostId,
    startTime,
    endTime,
    peopleCount,
    totalAmount,
    currency = "CNY",
    travelerNote = null,
  } = body;

  if (!experienceId || typeof experienceId !== "string") {
    return error("INVALID_INPUT", "experienceId is required", 400);
  }
  if (!hostId || typeof hostId !== "string") {
    return error("INVALID_INPUT", "hostId is required", 400);
  }
  if (!startTime || typeof startTime !== "string") {
    return error("INVALID_INPUT", "startTime is required", 400);
  }
  if (!endTime || typeof endTime !== "string") {
    return error("INVALID_INPUT", "endTime is required", 400);
  }
  if (!Number.isFinite(peopleCount as number) || (peopleCount as number) <= 0) {
    return error("INVALID_INPUT", "peopleCount must be > 0", 400);
  }
  if (
    !Number.isFinite(totalAmount as number) ||
    (totalAmount as number) <= 0
  ) {
    return error("INVALID_INPUT", "totalAmount must be > 0", 400);
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (!(start < end)) {
    return error("INVALID_INPUT", "startTime must be before endTime", 400);
  }

  const identity = await requireActorIdentity(req);
  if (identity instanceof Response) return identity;
  const { user: terraUser, profileId: travelerProfileId } = identity;
  if (terraUser.role !== "traveler") {
    return error("FORBIDDEN", "Traveler role required", 403);
  }

  let hostProfileId: string | null = null;
  try {
    hostProfileId = typeof hostId === "string"
      ? await resolveHostProfileId(hostId)
      : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error("DB_ERROR", message, 500);
  }
  if (!hostProfileId) return error("INVALID_INPUT", "Invalid hostId", 400);

  const orderNo = generateOrderNo();

  // Idempotency: return existing order for same traveler/experience/start_time.
  const { data: existingOrder, error: existingError } = await supabase
    .from("orders")
    .select("*")
    .eq("traveler_id", travelerProfileId)
    .eq("host_id", hostProfileId)
    .eq("experience_id", experienceId)
    .eq("start_time", start.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) return error("DB_ERROR", existingError.message, 500);
  if (existingOrder) {
    return success(existingOrder);
  }

  const { data: order, error: insertError } = await supabase
    .from("orders")
    .insert({
      order_no: orderNo,
      traveler_id: travelerProfileId,
      host_id: hostProfileId,
      experience_id: experienceId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      people_count: peopleCount,
      status: "PENDING_HOST_CONFIRM",
      payment_status: "PAID",
      total_amount: totalAmount,
      currency,
      traveler_note: travelerNote,
      paid_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) return error("DB_ERROR", insertError.message, 500);

  const { error: logError } = await supabase.from("order_status_logs").insert({
    order_id: order.id,
    from_status: null,
    to_status: "PENDING_HOST_CONFIRM",
    actor_id: travelerProfileId,
    actor_role: "TRAVELER",
  });

  if (logError) return error("DB_ERROR", logError.message, 500);

  return success(order, 201);
}

async function handleMarkPaid(
  req: Request,
  orderId: number,
): Promise<Response> {
  const identity = await requireActorIdentity(req);
  if (identity instanceof Response) return identity;
  const { user: terraUser, profileId: userId } = identity;
  if (terraUser.role !== "traveler") {
    return error("FORBIDDEN", "Traveler role required", 403);
  }

  const order = await fetchOrder(orderId);
  if (!order) return error("NOT_FOUND", "Order not found", 404);

  if (!assertOrderAccess(order, userId, ["traveler"])) {
    return error("FORBIDDEN", "Only traveler can mark paid", 403);
  }

  const status = order.status as OrderStatus;
  const paymentStatus = order.payment_status as PaymentStatus;

  if (paymentStatus !== "UNPAID") {
    return error("INVALID_STATUS_TRANSITION", "Order already paid", 400);
  }
  if (status === "CANCELLED_REFUNDED" || status === "CANCELLED_BY_TRAVELER") {
    return error("INVALID_STATUS_TRANSITION", "Order cancelled", 400);
  }

  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({
      payment_status: "PAID",
      status: "PENDING_HOST_CONFIRM",
      paid_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select()
    .single();

  if (updateError) return error("DB_ERROR", updateError.message, 500);

  const { error: logError } = await supabase.from("order_status_logs").insert({
    order_id: orderId,
    from_status: status,
    to_status: "PENDING_HOST_CONFIRM",
    actor_id: userId,
    actor_role: "TRAVELER",
  });

  if (logError) return error("DB_ERROR", logError.message, 500);

  return success(updated);
}

async function handleAcceptOrder(
  req: Request,
  orderId: number,
): Promise<Response> {
  const identity = await requireActorIdentity(req);
  if (identity instanceof Response) return identity;
  const { user: terraUser, profileId: userId } = identity;
  if (terraUser.role !== "host") {
    return error("FORBIDDEN", "Host role required", 403);
  }

  const order = await fetchOrder(orderId);
  if (!order) return error("NOT_FOUND", "Order not found", 404);

  if (!assertOrderAccess(order, userId, ["host"])) {
    return error("FORBIDDEN", "Not order host", 403);
  }

  if (order.status !== "PENDING_HOST_CONFIRM") {
    return error(
      "INVALID_STATUS_TRANSITION",
      "Order not pending host confirm",
      400,
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({
      status: "CONFIRMED",
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select()
    .single();

  if (updateError) return error("DB_ERROR", updateError.message, 500);

  const { error: logError } = await supabase.from("order_status_logs").insert({
    order_id: orderId,
    from_status: "PENDING_HOST_CONFIRM",
    to_status: "CONFIRMED",
    actor_id: userId,
    actor_role: "HOST",
  });

  if (logError) return error("DB_ERROR", logError.message, 500);

  return success(updated);
}

async function handleRejectOrder(
  req: Request,
  orderId: number,
): Promise<Response> {
  const identity = await requireActorIdentity(req);
  if (identity instanceof Response) return identity;
  const { user: terraUser, profileId: userId } = identity;
  if (terraUser.role !== "host") {
    return error("FORBIDDEN", "Host role required", 403);
  }

  const order = await fetchOrder(orderId);
  if (!order) return error("NOT_FOUND", "Order not found", 404);

  if (!assertOrderAccess(order, userId, ["host"])) {
    return error("FORBIDDEN", "Not order host", 403);
  }

  if (order.status !== "PENDING_HOST_CONFIRM") {
    return error(
      "INVALID_STATUS_TRANSITION",
      "Order not pending host confirm",
      400,
    );
  }

  const bodyOrError = await requireJson(req);
  if (bodyOrError instanceof Response) return bodyOrError;
  const body = bodyOrError;
  const reason = typeof body.reason === "string" ? body.reason : null;

  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({
      status: "CANCELLED_REFUNDED",
      payment_status: "REFUNDED",
      cancelled_at: new Date().toISOString(),
      cancelled_by: "HOST",
      cancelled_reason: reason,
    })
    .eq("id", orderId)
    .select()
    .single();

  if (updateError) return error("DB_ERROR", updateError.message, 500);

  const { error: logError } = await supabase.from("order_status_logs").insert({
    order_id: orderId,
    from_status: "PENDING_HOST_CONFIRM",
    to_status: "CANCELLED_REFUNDED",
    actor_id: userId,
    actor_role: "HOST",
    reason: reason ?? undefined,
  });

  if (logError) return error("DB_ERROR", logError.message, 500);

  return success(updated);
}

async function handleCancelOrder(
  req: Request,
  orderId: number,
): Promise<Response> {
  const identity = await requireActorIdentity(req);
  if (identity instanceof Response) return identity;
  const { user: terraUser, profileId: userId } = identity;
  if (terraUser.role !== "traveler") {
    return error("FORBIDDEN", "Traveler role required", 403);
  }

  const order = await fetchOrder(orderId);
  if (!order) return error("NOT_FOUND", "Order not found", 404);

  if (!assertOrderAccess(order, userId, ["traveler"])) {
    return error("FORBIDDEN", "Only traveler can cancel", 403);
  }

  const status = order.status as OrderStatus;
  if (
    status === "COMPLETED" ||
    status === "IN_SERVICE" ||
    status === "CANCELLED_BY_TRAVELER" ||
    status === "CANCELLED_REFUNDED"
  ) {
    return error("INVALID_STATUS_TRANSITION", "Order cannot be cancelled", 400);
  }

  const bodyOrError = await requireJson(req);
  if (bodyOrError instanceof Response) return bodyOrError;
  const body = bodyOrError;
  const reason = typeof body.reason === "string" ? body.reason : null;

  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({
      status: "CANCELLED_BY_TRAVELER",
      payment_status: "REFUNDED",
      cancelled_at: new Date().toISOString(),
      cancelled_by: "TRAVELER",
      cancelled_reason: reason,
    })
    .eq("id", orderId)
    .select()
    .single();

  if (updateError) return error("DB_ERROR", updateError.message, 500);

  const { error: logError } = await supabase.from("order_status_logs").insert({
    order_id: orderId,
    from_status: status,
    to_status: "CANCELLED_BY_TRAVELER",
    actor_id: userId,
    actor_role: "TRAVELER",
    reason: reason ?? undefined,
  });

  if (logError) return error("DB_ERROR", logError.message, 500);

  return success(updated);
}

async function handleStartService(
  req: Request,
  orderId: number,
): Promise<Response> {
  const identity = await requireActorIdentity(req);
  if (identity instanceof Response) return identity;
  const { user: terraUser, profileId: userId } = identity;

  const order = await fetchOrder(orderId);
  if (!order) return error("NOT_FOUND", "Order not found", 404);

  if (!assertOrderAccess(order, userId, ["host", "traveler"])) {
    return error("FORBIDDEN", "No access to order", 403);
  }

  if (order.status !== "CONFIRMED") {
    return error(
      "INVALID_STATUS_TRANSITION",
      "Order not confirmed",
      400,
    );
  }

  const actorRole = order.host_id === userId ? "HOST" : "TRAVELER";
  if (actorRole === "HOST" && terraUser.role !== "host") {
    return error("FORBIDDEN", "Host role required", 403);
  }
  if (actorRole === "TRAVELER" && terraUser.role !== "traveler") {
    return error("FORBIDDEN", "Traveler role required", 403);
  }

  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({
      status: "IN_SERVICE",
      started_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select()
    .single();

  if (updateError) return error("DB_ERROR", updateError.message, 500);

  const { error: logError } = await supabase.from("order_status_logs").insert({
    order_id: orderId,
    from_status: "CONFIRMED",
    to_status: "IN_SERVICE",
    actor_id: userId,
    actor_role: actorRole,
  });

  if (logError) return error("DB_ERROR", logError.message, 500);

  const { error: serviceLogError } = await supabase.from("service_logs").insert({
    order_id: orderId,
    event_type: "START",
    actor_id: userId,
    actor_role: actorRole,
  });

  if (serviceLogError) return error("DB_ERROR", serviceLogError.message, 500);

  return success(updated);
}

async function handleEndService(
  req: Request,
  orderId: number,
): Promise<Response> {
  const identity = await requireActorIdentity(req);
  if (identity instanceof Response) return identity;
  const { user: terraUser, profileId: userId } = identity;

  const order = await fetchOrder(orderId);
  if (!order) return error("NOT_FOUND", "Order not found", 404);

  if (!assertOrderAccess(order, userId, ["host", "traveler"])) {
    return error("FORBIDDEN", "No access to order", 403);
  }

  if (order.status !== "IN_SERVICE") {
    return error(
      "INVALID_STATUS_TRANSITION",
      "Order not in service",
      400,
    );
  }

  const actorRole = order.host_id === userId ? "HOST" : "TRAVELER";
  if (actorRole === "HOST" && terraUser.role !== "host") {
    return error("FORBIDDEN", "Host role required", 403);
  }
  if (actorRole === "TRAVELER" && terraUser.role !== "traveler") {
    return error("FORBIDDEN", "Traveler role required", 403);
  }

  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({
      status: "COMPLETED",
      completed_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select()
    .single();

  if (updateError) return error("DB_ERROR", updateError.message, 500);

  const { error: logError } = await supabase.from("order_status_logs").insert({
    order_id: orderId,
    from_status: "IN_SERVICE",
    to_status: "COMPLETED",
    actor_id: userId,
    actor_role: actorRole,
  });

  if (logError) return error("DB_ERROR", logError.message, 500);

  const { error: serviceLogError } = await supabase.from("service_logs").insert({
    order_id: orderId,
    event_type: "END",
    actor_id: userId,
    actor_role: actorRole,
  });

  if (serviceLogError) return error("DB_ERROR", serviceLogError.message, 500);

  return success(updated);
}

async function handleCreateReview(
  req: Request,
  orderId: number,
): Promise<Response> {
  const identity = await requireActorIdentity(req);
  if (identity instanceof Response) return identity;
  const { user: terraUser, profileId: userId } = identity;
  if (terraUser.role !== "traveler") {
    return error("FORBIDDEN", "Traveler role required", 403);
  }

  const order = await fetchOrder(orderId);
  if (!order) return error("NOT_FOUND", "Order not found", 404);

  if (!assertOrderAccess(order, userId, ["traveler"])) {
    return error("FORBIDDEN", "Only traveler can review", 403);
  }

  if (order.status !== "COMPLETED") {
    return error("INVALID_STATUS_TRANSITION", "Order not completed", 400);
  }

  const bodyOrError = await requireJson(req);
  if (bodyOrError instanceof Response) return bodyOrError;
  const body = bodyOrError;

  const rating = body.rating as number;
  const comment = typeof body.comment === "string" ? body.comment : null;

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return error("INVALID_INPUT", "rating must be 1-5", 400);
  }

  const { data: existing, error: existingError } = await supabase
    .from("reviews")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();

  if (existingError) return error("DB_ERROR", existingError.message, 500);
  if (existing) return error("DUPLICATE", "Review already exists", 400);

  const { error: insertError } = await supabase.from("reviews").insert({
    order_id: orderId,
    from_user_id: userId,
    to_user_id: order.host_id,
    rating,
    comment,
  });

  if (insertError) return error("DB_ERROR", insertError.message, 500);

  return success({ orderId, rating, comment });
}

async function handleGetMyOrders(
  req: Request,
  urlOverride?: URL,
): Promise<Response> {
  const identity = await requireActorIdentity(req);
  if (identity instanceof Response) return identity;
  const { user: terraUser, profileId: userId } = identity;
  if (terraUser.role !== "traveler") {
    return error("FORBIDDEN", "Traveler role required", 403);
  }

  const url = urlOverride ?? new URL(req.url);
  const status = url.searchParams.get("status");

  let query = supabase.from("orders")
    .select("id, experience_id, host_id, start_time, status, total_amount, currency, created_at")
    .eq("traveler_id", userId)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error: queryError } = await query;
  if (queryError) return error("DB_ERROR", queryError.message, 500);

  return success(data);
}

async function handleGetHostOrders(
  req: Request,
  urlOverride?: URL,
): Promise<Response> {
  const identity = await requireActorIdentity(req);
  if (identity instanceof Response) return identity;
  const { user: terraUser, profileId: userId } = identity;
  if (terraUser.role !== "host") {
    return error("FORBIDDEN", "Host role required", 403);
  }

  const url = urlOverride ?? new URL(req.url);
  const status = url.searchParams.get("status");

  let query = supabase.from("orders")
    .select("id, experience_id, traveler_id, start_time, status, total_amount, currency, created_at")
    .eq("host_id", userId)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error: queryError } = await query;
  if (queryError) return error("DB_ERROR", queryError.message, 500);

  return success(data);
}

async function handleGetOrderDetail(
  req: Request,
  orderId: number,
): Promise<Response> {
  const identity = await requireActorIdentity(req);
  if (identity instanceof Response) return identity;
  const { user: terraUser, profileId: userId } = identity;

  const order = await fetchOrder(orderId);
  if (!order) return error("NOT_FOUND", "Order not found", 404);

  if (!assertOrderAccess(order, userId, ["host", "traveler"])) {
    return error("FORBIDDEN", "No access to order", 403);
  }
  const actorRole = order.host_id === userId ? "HOST" : "TRAVELER";
  if (actorRole === "HOST" && terraUser.role !== "host") {
    return error("FORBIDDEN", "Host role required", 403);
  }
  if (actorRole === "TRAVELER" && terraUser.role !== "traveler") {
    return error("FORBIDDEN", "Traveler role required", 403);
  }

  const { data: serviceLogs, error: serviceError } = await supabase
    .from("service_logs")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (serviceError) return error("DB_ERROR", serviceError.message, 500);

  const { data: review, error: reviewError } = await supabase
    .from("reviews")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();

  if (reviewError) return error("DB_ERROR", reviewError.message, 500);

  return success({
    order,
    serviceLogs,
    review,
  });
}

async function handleCronAutoClose(req: Request): Promise<Response> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret) {
    const header = req.headers.get("x-cron-secret");
    if (header !== cronSecret) {
      return error("UNAUTHORIZED", "Invalid cron secret", 401);
    }
  }

  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000)
    .toISOString();

  const { data: pendingOrders, error: fetchError } = await supabase
    .from("orders")
    .select("*")
    .eq("status", "PENDING_HOST_CONFIRM")
    .lt("created_at", twelveHoursAgo);

  if (fetchError) return error("DB_ERROR", fetchError.message, 500);

  for (const order of pendingOrders ?? []) {
    const orderId = order.id as number;
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: "CANCELLED_REFUNDED",
        payment_status: "REFUNDED",
        cancelled_at: new Date().toISOString(),
        cancelled_by: "SYSTEM",
        cancelled_reason: "AUTO_TIMEOUT",
      })
      .eq("id", orderId);

    if (updateError) continue;

    await supabase.from("order_status_logs").insert({
      order_id: orderId,
      from_status: "PENDING_HOST_CONFIRM",
      to_status: "CANCELLED_REFUNDED",
      actor_role: "SYSTEM",
      reason: "AUTO_TIMEOUT",
    });
  }

  return success({ processed: pendingOrders?.length ?? 0 });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const routeOverride = url.searchParams.get("route") ??
    req.headers.get("x-route") ??
    req.headers.get("x-path");

  // If client provided a virtual route (e.g. via x-route: /orders/my?status=CONFIRMED),
  // parse it as a URL so we can correctly extract pathname + query params.
  let effectiveUrl = url;
  if (routeOverride) {
    // Prepend a dummy host to satisfy URL parsing when only a path is given.
    const parsed = new URL(
      routeOverride.startsWith("http")
        ? routeOverride
        : `http://local${routeOverride}`,
    );
    effectiveUrl = parsed;
  }

  let pathname = effectiveUrl.pathname;
  // Normalize to a prefix-less route so both `/orders/create` and `/create` work.
  while (pathname.startsWith("/orders")) {
    pathname = pathname.replace(/^\/orders/, "");
  }
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;

  if (req.method === "POST" && pathname === "/create") {
    return await handleCreateOrder(req);
  }

  if (req.method === "POST" && pathname.match(/^\/\d+\/mark_paid$/)) {
    const orderId = requirePathId(pathname);
    if (!orderId) return error("INVALID_INPUT", "Invalid order id", 400);
    return await handleMarkPaid(req, orderId);
  }

  if (req.method === "POST" && pathname.match(/^\/\d+\/accept$/)) {
    const orderId = requirePathId(pathname);
    if (!orderId) return error("INVALID_INPUT", "Invalid order id", 400);
    return await handleAcceptOrder(req, orderId);
  }

  if (req.method === "POST" && pathname.match(/^\/\d+\/reject$/)) {
    const orderId = requirePathId(pathname);
    if (!orderId) return error("INVALID_INPUT", "Invalid order id", 400);
    return await handleRejectOrder(req, orderId);
  }

  if (req.method === "POST" && pathname.match(/^\/\d+\/cancel$/)) {
    const orderId = requirePathId(pathname);
    if (!orderId) return error("INVALID_INPUT", "Invalid order id", 400);
    return await handleCancelOrder(req, orderId);
  }

  if (req.method === "POST" && pathname.match(/^\/\d+\/start$/)) {
    const orderId = requirePathId(pathname);
    if (!orderId) return error("INVALID_INPUT", "Invalid order id", 400);
    return await handleStartService(req, orderId);
  }

  if (req.method === "POST" && pathname.match(/^\/\d+\/end$/)) {
    const orderId = requirePathId(pathname);
    if (!orderId) return error("INVALID_INPUT", "Invalid order id", 400);
    return await handleEndService(req, orderId);
  }

  if (req.method === "POST" && pathname.match(/^\/\d+\/review$/)) {
    const orderId = requirePathId(pathname);
    if (!orderId) return error("INVALID_INPUT", "Invalid order id", 400);
    return await handleCreateReview(req, orderId);
  }

  if (req.method === "GET" && pathname === "/my") {
    return await handleGetMyOrders(req, effectiveUrl);
  }

  if (req.method === "GET" && pathname === "/host/orders") {
    return await handleGetHostOrders(req, effectiveUrl);
  }

  if (req.method === "GET" && pathname.match(/^\/\d+$/)) {
    const orderId = requirePathId(pathname);
    if (!orderId) return error("INVALID_INPUT", "Invalid order id", 400);
    return await handleGetOrderDetail(req, orderId);
  }

  if (req.method === "POST" && pathname === "/cron/auto_close_unconfirmed") {
    return await handleCronAutoClose(req);
  }

  return error("NOT_FOUND", "Unknown route", 404);
});

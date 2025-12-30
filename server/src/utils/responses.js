function traceId(reply) {
  return reply?.request?.id || reply?.request?.traceId || null;
}

export function ok(reply, data = {}, status = 200) {
  return reply.code(status).send({ success: true, data, traceId: traceId(reply) });
}

export function error(reply, code, message, status = 400, detail) {
  return reply
    .code(status)
    .send({
      success: false,
      code,
      message,
      detail: detail ?? null,
      traceId: traceId(reply),
    });
}

export function contentBlocked(reply, reasons = []) {
  const normalized = Array.isArray(reasons) ? reasons : [];
  return reply.code(422).send({
    ok: false,
    reasons: normalized,
    message: 'content_not_allowed',
    success: false,
    code: 'CONTENT_BLOCKED',
    detail: { reasons: normalized },
    traceId: traceId(reply),
  });
}

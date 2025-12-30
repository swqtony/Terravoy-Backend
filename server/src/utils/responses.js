export function ok(reply, data = {}, status = 200) {
  return reply.code(status).send({ success: true, data });
}

export function error(reply, code, message, status = 400, detail) {
  return reply
    .code(status)
    .send({ success: false, code, message, detail: detail ?? null });
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
  });
}

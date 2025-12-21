export function ok(reply, data = {}, status = 200) {
  return reply.code(status).send({ success: true, data });
}

export function error(reply, code, message, status = 400, detail) {
  return reply
    .code(status)
    .send({ success: false, code, message, detail: detail ?? null });
}

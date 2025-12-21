export default async function healthRoutes(app) {
  app.get('/health', async (_req, reply) => reply.send({ ok: true }));
}

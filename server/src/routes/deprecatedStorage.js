import { error } from '../utils/responses.js';

function gone(reply) {
  return error(reply, 'GONE', 'Legacy storage endpoints are deprecated', 410);
}

export default async function deprecatedStorageRoutes(app) {
  app.post('/storage/upload-url', async (_req, reply) => gone(reply));
  app.post('/functions/v1/storage/upload-url', async (_req, reply) => gone(reply));

  app.post('/storage/complete', async (_req, reply) => gone(reply));
  app.post('/functions/v1/storage/complete', async (_req, reply) => gone(reply));

  app.post('/storage/read-url', async (_req, reply) => gone(reply));
  app.post('/functions/v1/storage/read-url', async (_req, reply) => gone(reply));
}

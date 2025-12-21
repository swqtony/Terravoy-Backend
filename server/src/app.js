import Fastify from 'fastify';
import pino from 'pino';
import { config } from './config.js';
import { pool } from './db/pool.js';
import registerRoutes from './routes/index.js';
import { startJobs } from './jobs/index.js';
import cors from '@fastify/cors';
import { checkDbCapabilities } from './services/capability.js';

const logger = pino({ transport: { target: 'pino-pretty' } });
const app = Fastify({
  logger,
});

// Decorate with db
app.decorate('pg', { pool });

// CORS for future frontend switch
await app.register(cors, {
  origin: true,
});

app.log.info({
  event: 'leancloud.config.loaded',
  server: config.lean.server || '[unset]',
  appIdPrefix: (config.lean.appId || '').slice(0, 8),
}, 'LeanCloud config loaded');

// Log actor per request
app.addHook('preHandler', async (req, _reply) => {
  const actor =
    req.headers['x-leancloud-user-id'] ||
    req.headers['x-leancloud-userid'] ||
    'anonymous';
  req.log = req.log.child({ actor, path: req.url, method: req.method, reqId: req.id });
});

await checkDbCapabilities(pool);

registerRoutes(app);
registerRoutes(app, '/api/v1'); // stable base path for future frontend
startJobs();

const start = async () => {
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`API listening on ${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

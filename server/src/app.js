import Fastify from 'fastify';
import pino from 'pino';
import { config } from './config.js';
import { pool } from './db/pool.js';
import registerRoutes from './routes/index.js';
import { startJobs } from './jobs/index.js';
import cors from '@fastify/cors';
import { checkDbCapabilities } from './services/capability.js';
import { verifyAccessToken } from './plugins/authBearer.js';
import jwt from 'jsonwebtoken';

const logger = pino({ transport: { target: 'pino-pretty' } });
const app = Fastify({
  logger,
});

// Decorate with db
app.decorate('pg', { pool });

// CORS for frontend/admin; restrict via CORS_ORIGINS when set
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
await app.register(cors, {
  origin: corsOrigins.length > 0 ? corsOrigins : true,
});

app.log.info({
  event: 'oss.config.loaded',
  endpoint: config.oss.endpoint || '',
  bucketPublic: config.oss.bucketPublic || '',
  bucketPrivate: config.oss.bucketPrivate || '',
  ready: Boolean(
    config.oss.endpoint &&
      config.oss.bucketPublic &&
      config.oss.bucketPrivate
  ),
}, 'OSS config loaded (non-secret)');

if (config.oss.useOssUploader) {
  const missing = [];
  if (!config.oss.endpoint) missing.push('OSS_ENDPOINT');
  if (!config.oss.bucketPublic) missing.push('OSS_BUCKET_PUBLIC');
  if (!config.oss.bucketPrivate) missing.push('OSS_BUCKET_PRIVATE');
  if (!config.oss.accessKeyId) missing.push('OSS_ACCESS_KEY_ID');
  if (!config.oss.accessKeySecret) missing.push('OSS_ACCESS_KEY_SECRET');
  if (missing.length > 0) {
    throw new Error(`OSS config missing: ${missing.join(', ')}`);
  }
}

app.log.info(
  { event: 'auth.sms.mode', mode: config.auth.smsMode },
  'Auth SMS mode loaded'
);

// Log actor per request
app.addHook('preHandler', async (req, _reply) => {
  let actor = 'anonymous';
  const auth = req.headers.authorization || req.headers.Authorization;
  if (auth) {
    const [scheme, token] = auth.split(' ');
    if (token && scheme.toLowerCase() === 'bearer') {
      const access = verifyAccessToken(token);
      if (access?.sub) {
        actor = access.sub;
      } else {
        try {
          const decoded = jwt.verify(token, config.auth.localJwtSecret);
          actor = decoded?.sub || actor;
        } catch (_err) {
          // keep anonymous on invalid token
        }
      }
    }
  }
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

import healthRoutes from './health.js';
import matchRoutes from './match.js';
import profileRoutes from './profile.js';
import ordersRoutes from './orders.js';
import paymentsRoutes from './payments.js';
import authRoutes from './supabaseAuth.js';
import authSmsRoutes from './authSms.js';
import preferencesRoutes from './preferences.js';
import storageRoutes from './storage.js';
import experienceRoutes from './experiences.js';
import discoverPlazaRoutes from './discoverPlaza.js';
import mediaRoutes from './media.js';
import deprecatedStorageRoutes from './deprecatedStorage.js';
import safetyRoutes from './safety.js';
import reportsRoutes from './reports.js';
import hostCertificationsRoutes from './hostCertifications.js';
import kycRoutes from './kyc.js';
import geoRoutes from './geo.js';
import userRoutes from './user.js';
import { config } from '../config.js';

export default function registerRoutes(app, prefix = '') {
  app.register(healthRoutes, { prefix });
  app.register(authRoutes, { prefix });
  app.register(authSmsRoutes, { prefix });
  app.register(profileRoutes, { prefix });
  app.register(matchRoutes, { prefix });
  app.register(ordersRoutes, { prefix });
  app.register(paymentsRoutes, { prefix });
  app.register(preferencesRoutes, { prefix });
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (!isProd && config.flags.allowLegacyStorage) {
    app.register(storageRoutes, { prefix });
  } else {
    app.register(deprecatedStorageRoutes, { prefix });
  }
  app.register(experienceRoutes, { prefix });
  app.register(discoverPlazaRoutes, { prefix });
  app.register(mediaRoutes, { prefix });
  app.register(userRoutes, { prefix });
  app.register(safetyRoutes, { prefix });
  app.register(reportsRoutes, { prefix });
  app.register(hostCertificationsRoutes, { prefix });
  app.register(kycRoutes, { prefix });
  app.register(geoRoutes, { prefix });
}

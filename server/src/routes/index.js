import healthRoutes from './health.js';
import matchRoutes from './match.js';
import profileRoutes from './profile.js';
import ordersRoutes from './orders.js';
import authRoutes from './supabaseAuth.js';
import preferencesRoutes from './preferences.js';
import storageRoutes from './storage.js';

export default function registerRoutes(app, prefix = '') {
  app.register(healthRoutes, { prefix });
  app.register(authRoutes, { prefix });
  app.register(profileRoutes, { prefix });
  app.register(matchRoutes, { prefix });
  app.register(ordersRoutes, { prefix });
  app.register(preferencesRoutes, { prefix });
  app.register(storageRoutes, { prefix });
}

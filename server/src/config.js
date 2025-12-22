import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });
dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 3000,
  db: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT) || 5432,
    user: process.env.POSTGRES_USER || 'terravoy',
    password: process.env.POSTGRES_PASSWORD || 'terravoy_dev',
    database: process.env.POSTGRES_DB || 'terravoy',
  },
  terra: {
    jwtSecret: process.env.TERRA_JWT_SECRET || 'dev_terra_secret_change_me',
    devToken: process.env.TERRA_DEV_TOKEN || 'dev_terra_token',
  },
  auth: {
    localJwtSecret: process.env.LOCAL_JWT_SECRET || 'dev_local_jwt_secret',
    localJwtTtlMin: Number(process.env.LOCAL_JWT_TTL_MIN) || 10,
  },
  lean: {
    appId: process.env.LEAN_APP_ID || '',
    appKey: process.env.LEAN_APP_KEY || '',
    server: process.env.LEAN_SERVER || '',
    masterKey: process.env.LEAN_MASTER_KEY || '',
  },
  flags: {
    devAuthBypass: process.env.DEV_AUTH_BYPASS === '1',
  },
};

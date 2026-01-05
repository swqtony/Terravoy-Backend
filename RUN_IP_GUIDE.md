# RUN_IP_GUIDE (Backend)

## 1) Environment overview
- Local dev (direct run).
- Staging container (port 3100).
- Production container (port 3000).

## 2) Ports & bindings
- Prod backend: http://39.105.212.81:3000
- Staging backend: http://39.105.212.81:3100

## 3) How to run locally (examples)
```bash
npm install
npm run dev
```

If running directly:
```bash
node server/src/app.js
```

If using Docker Compose (document-only):
```bash
docker compose up -d
```

## 4) Environment variables checklist
- NODE_ENV
- PORT
- POSTGRES_HOST / POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD
- REDIS_URL
- CORS_ORIGINS
- IM_API_BASE_URL
- PUBLIC_MEDIA_BASE_URL

## 5) Notes
- Pre-ICP: no TLS / no certbot / no domains.
- IP-based access is expected and correct.

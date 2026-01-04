# TerraVoy Backend

IM WS smoke: `node scripts/im_smoke_ws.js`

## Media Upload (OSS)

### Environment
- `PUBLIC_MEDIA_BASE_URL` (CDN base URL for public assets)
- `ADMIN_READ_URL_KEY` (optional admin key for private read-url)
- `OSS_ENDPOINT`
- `OSS_BUCKET_PUBLIC`
- `OSS_BUCKET_PRIVATE`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `OSS_UPLOAD_EXPIRES_SECONDS` (upload URL TTL, seconds)
- `ALLOW_LEGACY_STORAGE` (non-prod only; default false)
- `SAFETY_CHECK_RL_USER_PER_MIN` (content safety check per user/min)
- `SAFETY_CHECK_RL_IP_USER_PER_MIN` (content safety check per ip+user/min)

### Rate Limits
- `POST /v1/media/upload-url`: per user 30/min, per ip+user 60/min
- `scope=kyc`: 10/min
- `POST /v1/safety/check-text`: per user 120/min, per ip+user 240/min

### API
#### POST /v1/safety/check-text
```json
{ "scene": "chat|post|experience", "text": "...", "locale": "zh-CN" }
```
Response:
```json
{ "ok": true }
```
or
```json
{
  "ok": false,
  "reasons": ["URL","PHONE","WECHAT","SENSITIVE_WORD"],
  "message": "content_not_allowed",
  "success": false,
  "code": "CONTENT_BLOCKED",
  "detail": { "reasons": ["URL","PHONE","WECHAT","SENSITIVE_WORD"] }
}
```

Logging (blocked content only):
- event: `content_blocked`
- fields: `traceId`, `userId`, `ip`, `scene`, `reasons`, `source`, `textPreview`

#### POST /v1/reports
```json
{ "targetType": "chat|post|experience|user", "targetId": "...", "reasonCode": "spam|scam|harassment|illegal|other", "description": "..." }
```
Response:
```json
{ "id": "uuid", "status": "pending" }
```
Used by app report entry points for chat, posts, and experiences.

#### POST /v1/media/upload-url
```json
{
  "scope": "post|experience|avatar|kyc",
  "visibility": "public|private",
  "ext": "jpg|jpeg|png|webp|gif|mp4",
  "size": 12345,
  "mime": "image/jpeg"
}
```
Response:
```json
{
  "objectKey": "public/post/u_123/2025/12/uuid.webp",
  "uploadUrl": "https://...",
  "expiresAt": "2025-12-01T00:00:00.000Z",
  "requiredHeaders": { "Content-Type": "image/webp" }
}
```

#### POST /v1/media/complete
```json
{
  "objectKey": "public/post/u_123/2025/12/uuid.webp",
  "declaredSize": 12345,
  "declaredMime": "image/webp"
}
```
Response (public only):
```json
{
  "id": "uuid",
  "objectKey": "public/post/u_123/2025/12/uuid.webp",
  "visibility": "public",
  "scope": "post",
  "mime": "image/webp",
  "size": 12345,
  "publicUrl": "https://cdn.example.com/public/post/u_123/2025/12/uuid.webp"
}
```

#### POST /v1/admin/media/read-url
Admin-only short-lived GET URL for private assets.
Requires a signed terra token with role=admin or `ADMIN_READ_URL_KEY`.
```json
{ "objectKey": "private/kyc/u_123/2025/12/uuid.webp" }
```

### Verification
Run `scripts/verify_media_upload.sh` to exercise upload-url -> PUT -> complete,
plus a few failure cases. Example:
```bash
FILE=./path/to/image.jpg MIME=image/jpeg EXT=jpg scripts/verify_media_upload.sh
```

Step 5 verification:
```bash
FILE=./path/to/image.jpg MIME=image/jpeg EXT=jpg scripts/verify_step5.sh
```

Step 6 verification:
```bash
scripts/verify_step6.sh
```

Step 7 verification:
```bash
FILE=./path/to/image.jpg MIME=image/jpeg EXT=jpg \
HOST_USER=host_user HOST_SESSION=host_session ADMIN_API_KEY=your_admin_key \
scripts/verify_step7.sh
```

### Step 7: Host Certification (KYC)
Flow:
1) Draft: `PUT /v1/host-certifications/draft`
2) Upload docs: `POST /v1/media/upload-url` -> PUT -> `POST /v1/media/complete`
3) Submit: `POST /v1/host-certifications/submit`
4) Review: `POST /v1/admin/host-certifications/:id/review`
5) Result: `GET /v1/host-certifications/me`

Notes:
- C-end never receives private URLs; admins must use `POST /v1/admin/media/read-url` with `ADMIN_READ_URL_KEY` or admin terra token.
- Admin review endpoints require a valid auth session plus `ADMIN_API_KEY` (or a terra token with role=admin).
- In production, role headers (like `x-terra-role`) are ignored; roles come from signed tokens only.

Common errors:
- `HOST_CERT_REQUIRED` (403): host certification not approved for gated actions.
- `MISSING_DOCUMENTS` (422): required doc types missing at submit.
- `INVALID_DOCUMENT` (422): media asset not owned or not `scope=kyc`/`private`.
- `INVALID_STATUS` (409): invalid state transition.

Legacy `/storage/*` endpoints are deprecated and return 410 unless explicitly
enabled in non-production.

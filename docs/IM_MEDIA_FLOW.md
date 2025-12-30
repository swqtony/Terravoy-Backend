# IM Media Flow

## Scope
- Use `scope=im_message` for IM image uploads.
- Supported ext: `jpg|jpeg|png|webp|gif`.
- Visibility: `public` recommended for image messages.

## Flow
1) Call `POST /v1/media/upload-url` with:
   - `scope=im_message`, `visibility`, `ext`, `mime`, `size`
2) Upload file to returned `uploadUrl`
3) Call `POST /v1/media/complete` with:
   - `objectKey`, `declaredSize`, `declaredMime`
4) Send IM message with `type=image` and content:
   - `url`, `mime`, `size`, `width`, `height` (optional)

## Notes
- IM uses access token auth (`AUTH_JWT_SECRET`).
- Storage must be enabled with OSS config in `.env`.

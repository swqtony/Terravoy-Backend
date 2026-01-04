# TerraVoy Local API

快速验证（任何时刻 clone 后可跑通）：
```
docker compose up -d --build
docker compose exec api npm run db:migrate
bash tools/curl_smoke_test.sh
```

鉴权/授权模型详见：`docs/auth_and_authorization.md`（新增 SMS Auth + 短期 JWT）。

## 环境
- Node.js 20+
- Docker (用于 `docker compose up`)
- Postgres 16（compose 内置）

复制 `.env.example` 为 `.env`，可按需调整端口和数据库参数。

新增 Auth v0.1 配置：
- `AUTH_JWT_SECRET`
- `AUTH_ACCESS_TTL_SECONDS` (default 3600)
- `AUTH_REFRESH_TTL_SECONDS` (default 2592000)
- `AUTH_SMS_EXPIRES_SECONDS` (default 300)
- `AUTH_SMS_COOLDOWN_SECONDS` (default 60)
- `AUTH_DEBUG_SMS` (default false; dev only)
- `AUTH_SMS_MODE` (`mock` | `gateway`, default `mock`)
- `AUTH_SMS_PROVIDER` (e.g. `aliyun|tencent|twilio`, default empty)
- `AUTH_SMS_PROVIDER_KEY`
- `AUTH_SMS_PROVIDER_SECRET`
- `AUTH_SMS_PROVIDER_SIGN`
- `AUTH_SMS_PROVIDER_TEMPLATE_LOGIN`
- `AUTH_SMS_PROVIDER_TEMPLATE_REGISTER`

注意：`NODE_ENV=production` 时必须使用 `AUTH_SMS_MODE=gateway`，否则服务会在启动时直接退出。

## SMS Gateway 接入 TODO（必做 / 建议做）

### 必做（上线前）
- Provider 发送接口：必须可实际发送短信，否则无法登录。
- 模板映射（login / register）：不同模板对应不同风控/合规审核，必须区分。
- 失败重试 + 明确错误码：处理网关超时常态，且便于排查用户投诉。
- 审计日志（不打 code）：可追溯“未收到短信”问题，避免记录明文验证码。

### 建议做（上线后 1–2 周）
- 回执 / 状态查询：用于送达率统计。
- 黑名单 / 高级风控：规模增长后再做。
- 国际号码规范化（E.164）：国际化前再完善。

## 一键启动
```bash
docker compose up -d --build
```

## 数据库迁移
（容器内或本机均可）
```bash
# 确保数据库已启动
npm run db:migrate --prefix server
```
迁移文件位于 `db/migrations/0001_supabase_schema.sql`，来源于 Supabase dump。

## 路由概览
- 健康检查：`GET /health` -> `{ ok: true }`
- Auth v0.1（自建 SMS）：
  - `POST /functions/v1/auth/sms/send`
  - `POST /functions/v1/auth/sms/verify`
  - `POST /functions/v1/auth/refresh`
  - `POST /functions/v1/auth/logout`
- Legacy：
  - `POST /functions/v1/auth-supabase-login`
  - `POST /functions/v1/terra-auth`
- Supabase 兼容：
  - `POST /functions/v1/profile-bootstrap`
  - `POST /functions/v1/profile-update`
  - `POST /functions/v1/trip-card-create`
  - `POST /functions/v1/match-start`
  - `POST /functions/v1/match-poll`
  - `POST /functions/v1/match-cancel`
  - `POST /functions/v1/match-attach-conversation`
  - `POST /functions/v1/match-get-partner`
  - `POST /functions/v1/preferences-update|preferences-fetch`（返回 501，原项目未提供实现）
  - 订单多路复用：`/functions/v1/orders`（支持 x-route/x-path 兼容 supabase edge，或直接调用 `/orders/create`, `/orders/{id}/accept|reject|cancel|start|end|mark_paid|review`, `/orders/my`, `/host/orders`, `/orders/{id}`）
- 偏好持久化：`GET|PUT|DELETE /api/v1/preferences/match`（任意 JSON 按原样存储/读取；`match-start` 在缺省时会自动复用）
- Storage 占位：`/storage/*` 与 `/functions/v1/storage/*` 统一返回 501（文件上传/UGC/认证材料走对象存储）

所有需要用户身份的接口使用 `Authorization: Bearer <accessToken>`（Auth v0.1）。

### Profile 说明（Self-hosted）
- `POST /functions/v1/profile-bootstrap`：仅 Bearer，`{}` 空 body，返回 `profileId`/`isCompleted`。
- `POST /functions/v1/profile-update`：支持 partial update，body 形如 `{ profileId, payload }`，只更新 payload 中出现的字段；允许仅更新 `nickname`。

## 定时任务
- 内置作业：每 10 分钟自动关闭超 12 小时未确认的订单（等价 Supabase cron 逻辑）。启动时自动运行。

## 冒烟测试
```bash
bash tools/curl_smoke_test.sh
```
覆盖 /health、基本匹配/订单流程（需先跑迁移）。

## Profile 手动验证（示例 curl）
```bash
# 1) nickname-only 更新成功（200）
curl -X POST "$BASE_URL/functions/v1/profile-update" \\
  -H "Authorization: Bearer $ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"profileId":"'$PROFILE_ID'","payload":{"nickname":"TerraUser"}}'

# 2) nickname 为空（400 INVALID_NICKNAME）
curl -X POST "$BASE_URL/functions/v1/profile-update" \\
  -H "Authorization: Bearer $ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"profileId":"'$PROFILE_ID'","payload":{"nickname":"  "}}'

# 3) 画像全量字段更新成功（200）
curl -X POST "$BASE_URL/functions/v1/profile-update" \\
  -H "Authorization: Bearer $ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"profileId":"'$PROFILE_ID'","payload":{"gender":"female","age":26,"firstLanguage":"en","secondLanguage":"zh","homeCity":"SHA"}}'

# 4) 越权 profileId（403）
curl -X POST "$BASE_URL/functions/v1/profile-update" \\
  -H "Authorization: Bearer $ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"profileId":"'$OTHER_PROFILE_ID'","payload":{"nickname":"TerraUser"}}'
```
